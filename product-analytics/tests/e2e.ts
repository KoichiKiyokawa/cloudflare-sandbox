import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { chromium, type Browser } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { openAnalysis, pack, query, report } from '../analysis/database.ts';
import { sendServerEvents } from '../examples/server.ts';
import { cacheRemainingHeader, dashboardReportPeriod } from '../dashboard/query-endpoint.ts';
import { runDashboardQuery } from '../ops/dashboard-query.ts';
import identitySchema from '../events/identity_linked.json' with { type: 'json' };

const run = promisify(execFile);
const temporary = await mkdtemp(join(tmpdir(), 'product-analytics-e2e-'));
const rawDirectory = join(temporary, 'r2');
const packed = join(temporary, 'events.parquet');
const savedReport = join(temporary, 'dashboard-report.json');
const token = 'demo-local-token-for-integration-only';
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
await mkdir(rawDirectory, { recursive: true });

let worker: Miniflare | undefined;
let vite: ViteDevServer | undefined;
let browser: Browser | undefined;
try {
  await run(process.execPath, [wrangler, 'deploy', '--dry-run', '--outdir', join(temporary, 'worker')]);
  worker = new Miniflare(convertV4MiniflareOptions({
    port: 0, host: '127.0.0.1',
    workers: [{
      name: 'product-analytics', modules: true, script: await readFile(join(temporary, 'worker', 'worker.js'), 'utf8'),
      compatibilityDate: '2026-11-27', bindings: { SERVER_TOKENS: JSON.stringify({ demo: token }) },
      r2Buckets: { RAW_EVENTS: 'product-analytics-e2e' },
      ratelimits: { BROWSER_RATE_LIMIT: { namespace_id: '217110', simple: { limit: 10, period: 60 } } },
    }],
  }));
  const collector = (await worker.ready).origin;
  assert.equal((await fetch(`${collector}/v1/browser/demo`, { method: 'POST', headers: { Origin: 'https://unregistered.example' } })).status, 403);
  assert.equal((await fetch(`${collector}/v1/server/demo`, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(`${collector}/v1/server/demo`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: 'x'.repeat(256 * 1024 + 1),
  })).status, 413);

  vite = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
  await vite.listen();
  browser = await chromium.launch(process.env.CHROME_BIN
    ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' });
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));

  let failedBody = '';
  const requests: string[] = [];
  await page.route(`${collector}/v1/browser/demo`, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    const body = request.postData() ?? '';
    requests.push(body);
    if (failedBody) return route.continue();
    failedBody = body;
    return route.fulfill({
      status: 503, headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:5173' },
    });
  });

  await page.goto(`http://127.0.0.1:5173/collector-demo.html?collector=${encodeURIComponent(collector)}&utm_source=mail&secret=exclude`);
  await page.getByRole('button', { name: '料金画面を開く' }).click();
  const anonymousId = (await page.getByTestId('anonymous-id').textContent()) ?? '';
  const sessionId = (await page.getByTestId('session-id').textContent()) ?? '';
  assert.match(anonymousId, /^[0-9a-f-]{36}$/);
  assert.match(sessionId, /^[0-9a-f-]{36}$/);
  const isPost = (response: { url(): string; request(): { method(): string } }) =>
    response.url() === `${collector}/v1/browser/demo` && response.request().method() === 'POST';
  const failed = page.waitForResponse((response) => isPost(response) && response.status() === 503);
  await page.getByRole('button', { name: 'バッファーを送信' }).click();
  await failed;
  const retried = page.waitForResponse((response) => isPost(response) && response.status() === 204);
  await page.getByRole('button', { name: 'バッファーを送信' }).click();
  await retried;
  assert.equal(requests.length, 2);
  const firstBatch = JSON.parse(failedBody).data;
  const retryBatch = JSON.parse(requests[1]).data;
  assert.deepEqual(retryBatch.map((event: { eid: string }) => event.eid), firstBatch.map((event: { eid: string }) => event.eid));
  assert.equal(retryBatch.length, 5);
  assert.ok(retryBatch.some((event: { e: string; url: string }) => event.e === 'pv' && new URL(event.url).pathname === '/pricing'));
  assert.ok(retryBatch.every((event: { url: string }) => event.url.includes('utm_source=mail') && !event.url.includes('secret=')));
  assert.ok(retryBatch.every((event: { duid: string; sid: string }) => event.duid === anonymousId && event.sid === sessionId));

  // Simulate a response lost after Cloudflare accepted it.
  assert.equal((await fetch(`${collector}/v1/browser/demo`, {
    method: 'POST', headers: { Origin: 'http://127.0.0.1:5173' }, body: requests[1],
  })).status, 204);

  const config = {
    appId: 'demo', collectorOrigin: collector, token, userId: 'alice', anonymousId, sessionId,
  };
  const eventTime = new Date(Math.max(Date.now(), ...retryBatch.map(({ dtm }: { dtm: string }) => Number(dtm) + 1)));
  const serverEvents = [
    { id: randomUUID(), occurredAt: eventTime, schema: identitySchema.$id, data: { anonymous_id: anonymousId } },
    { id: randomUUID(), occurredAt: eventTime, schema: 'iglu:com.example.demo/purchase_completed/jsonschema/1-0-0',
      data: { plan: 'plus', amount: 20 } },
  ];
  await sendServerEvents(config, serverEvents);
  await sendServerEvents(config, serverEvents);

  const bucket = await worker.getR2Bucket('RAW_EVENTS');
  const listing = await bucket.list({ prefix: 'raw/v1/' });
  assert.equal(listing.objects.length, 4);
  for (const entry of listing.objects) {
    const object = await bucket.get(entry.key);
    assert.ok(object);
    await writeFile(join(rawDirectory, entry.key.split('/').at(-1) ?? ''), Buffer.from(await object.arrayBuffer()));
  }

  const source = join(rawDirectory, '*.ndjson.gz');
  await pack([source], packed);
  assert.equal((await readFile(packed)).subarray(0, 4).toString(), 'PAR1');
  const from = new Date(Number(retryBatch[0].dtm)).toISOString().slice(0, 10);
  const to = new Date(Date.parse(from) + 86_400_000).toISOString().slice(0, 10);
  const reportConfig = { app: 'demo', source: packed, timeZone: 'UTC' };
  const times = { observedUntil: `${to}T00:00:00Z`, knownAt: new Date().toISOString() };
  const db = await openAnalysis([packed], {
    app: reportConfig.app, timeZone: reportConfig.timeZone, from, to, ...times,
    steps: ['page_view', 'pricing_opened', 'purchase_completed'], experiment: 'layout', conversion: 'purchase_completed',
  });
  try {
    assert.deepEqual(await report(db, 'active'), [{ day: from, dau: '1', wau: '1', mau: '1', page_views: '2', page_users: '1' }]);
    assert.deepEqual((await report(db, 'funnel')).map((step) => step.users), ['1', '1', '1']);
    assert.equal((await report(db, 'experiment'))[0].conversion_rate, 1);
    assert.deepEqual(await query(db, 'SELECT count(*) AS events, count(DISTINCT user_key) AS users FROM events'),
      [{ events: '7', users: '1' }]);
  } finally {
    db.close();
  }
  const staleTimes = { ...times, knownAt: '2020-01-01T00:00:00Z' };
  await assert.rejects(runDashboardQuery({ ...reportConfig, maxIngestLagHours: 30 }, 30, staleTimes), /Latest eligible receipt/);
  const rangeStart = (days: number) => new Date(Date.parse(to) - days * 86_400_000).toISOString().slice(0, 10);

  let reportsAreCurrent = false;
  let rejectRefresh = false;
  let receivedReport: string | undefined;
  await page.route('http://127.0.0.1:5173/api/dashboard/*', async (route) => {
    if (rejectRefresh) return route.fulfill({ status: 503 });
    const days = dashboardReportPeriod(new URL(route.request().url()).pathname);
    assert.ok(days);
    const body = await runDashboardQuery(reportConfig, days, reportsAreCurrent ? times : staleTimes);
    if (reportsAreCurrent && days === 30) receivedReport = body;
    return route.fulfill({
      body, contentType: 'application/json',
      headers: { [cacheRemainingHeader]: '3600000' },
    });
  });
  await page.clock.install();
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('heading', { name: 'demo' }).waitFor();
  await page.getByText('最終集計から30時間以上経過しています。').waitFor();
  assert.equal(await page.locator('dl.cards dd').first().textContent(), '0');
  reportsAreCurrent = true;
  await page.clock.fastForward(5 * 60_000);
  assert.equal(await page.locator('dl.cards dd').first().textContent(), '0');
  await page.clock.fastForward(55 * 60_000);
  await page.waitForFunction(() => document.querySelector('dl.cards dd')?.textContent === '1');
  await page.getByText('最終集計から30時間以上経過しています。').waitFor({ state: 'hidden' });
  const livePeriod = page.getByRole('combobox', { name: '期間' });
  await livePeriod.selectOption('7');
  await page.getByText(`${rangeStart(7)} から ${to} 未満 · UTC`).waitFor();
  await livePeriod.selectOption('30');
  await page.getByText(`${rangeStart(30)} から ${to} 未満 · UTC`).waitFor();
  assert.equal(await page.locator('dl.cards dd').allTextContents().then((texts) => texts.join(',')), '1,1,1,2,1');
  const dailyPanel = page.getByRole('region', { name: '日次の推移' });
  const sourcePanel = page.getByRole('region', { name: '流入元別セッション' });
  const sourceChart = sourcePanel.getByRole('img', { name: '流入元別セッションの日次推移' });
  await sourceChart.locator('canvas').first().waitFor();
  assert.match((await sourceChart.getAttribute('aria-description')) ?? '', /mail.*1 セッション/);
  assert.match((await sourcePanel.getByRole('list', { name: '選択期間の流入元割合' }).textContent()) ?? '', /mail.*%/);
  const composition = sourcePanel.getByRole('button', { name: '構成比' });
  await composition.click();
  assert.equal(await composition.getAttribute('aria-pressed'), 'true');
  assert.equal(await sourcePanel.getByRole('button', { name: '件数' }).getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await dailyPanel.getByRole('group', { name: '日次の指標' }).getByRole('button').allTextContents(), ['DAU', 'PV']);
  const goal = page.getByRole('spinbutton', { name: '目標値' });
  const dauChart = page.getByRole('img', { name: '日間アクティブユーザーの推移' });
  await goal.waitFor();
  assert.equal(await goal.inputValue(), '30');
  await goal.fill('55');
  await goal.blur();
  assert.equal(await dauChart.getAttribute('aria-description'), '目標 55');
  const pv = page.getByRole('button', { name: 'PV', exact: true });
  await pv.click();
  assert.equal(await pv.getAttribute('aria-pressed'), 'true');
  const pvChart = page.getByRole('img', { name: 'ページビューの推移' });
  await pvChart.locator('canvas').first().waitFor();
  assert.equal(await sourceChart.isVisible(), true);
  assert.equal(await goal.inputValue(), '40');
  assert.equal(await pvChart.getAttribute('aria-description'), '目標 40');
  assert.equal(await page.getByRole('table').count(), 0);
  const period = page.getByRole('combobox', { name: '期間' });
  assert.equal(await period.inputValue(), '30');
  await period.selectOption('7');
  await page.getByText(`${rangeStart(7)} から ${to} 未満 · UTC`).waitFor();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: '日別 CSV をダウンロード' }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'daily-metrics.csv');
  const csv = (await readFile(await download.path(), 'utf8')).trimEnd().split('\r\n');
  assert.equal(csv.length, 8);
  assert.equal(csv[0], 'date,dau,page_views');
  assert.equal(csv[1], `${rangeStart(7)},0,0`);
  assert.equal(csv.at(-1), `${from},1,2`);
  await period.selectOption({ label: '直近半年（180日）' });
  await page.getByText(`${rangeStart(180)} から ${to} 未満 · UTC`).waitFor();
  const halfYearDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: '日別 CSV をダウンロード' }).click();
  const halfYearRows = (await readFile(await (await halfYearDownload).path(), 'utf8')).trimEnd().split('\r\n');
  assert.equal(halfYearRows.length, 181);
  assert.equal(halfYearRows[1], `${rangeStart(180)},0,0`);
  assert.equal(halfYearRows.at(-1), `${from},1,2`);
  assert.equal(await goal.isVisible(), true);
  assert.match((await sourceChart.getAttribute('aria-description')) ?? '', /mail.*1 セッション/);
  await page.setViewportSize({ width: 375, height: 780 });
  await page.waitForFunction(() => {
    const charts = Array.from(document.querySelectorAll('.report-chart'));
    return document.documentElement.scrollWidth <= innerWidth
      && charts.length === 2
      && charts.every((chart) => {
        const canvas = chart.querySelector('canvas');
        return canvas && canvas.getBoundingClientRect().width <= chart.getBoundingClientRect().width + 1;
      });
  });
  await period.selectOption('30');
  await page.getByText(`${rangeStart(30)} から ${to} 未満 · UTC`).waitFor();
  rejectRefresh = true;
  await page.getByRole('button', { name: '最新の集計を読む' }).click();
  await page.getByRole('alert').filter({ hasText: '前回の集計を表示しています' }).waitFor();
  assert.ok(receivedReport);
  await writeFile(savedReport, receivedReport);
  await page.getByLabel('集計 JSON を開く').setInputFiles(savedReport);
  await page.getByText('ローカルファイルを表示中').waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.deepEqual(await page.locator('dl.cards dd').allTextContents(), ['1', '1', '1', '2', '1']);
  rejectRefresh = false;
  await page.reload();
  await goal.waitFor();
  assert.equal(await goal.inputValue(), '55');
  assert.equal(await dauChart.getAttribute('aria-description'), '目標 55');
  assert.deepEqual(browserErrors, []);

  const exitPage = await browser.newPage();
  await exitPage.goto(`http://127.0.0.1:5173/collector-demo.html?collector=${encodeURIComponent(collector)}`);
  const leavingRequest = exitPage.waitForRequest((request) => request.method() === 'POST' && request.url() === `${collector}/v1/browser/demo`, { timeout: 3500 });
  await exitPage.getByRole('link', { name: '分析画面へ移動' }).click();
  const leaving = await leavingRequest;
  assert.match(leaving.headers()['content-type'], /^text\/plain/i);
  const deadline = Date.now() + 3000;
  let savedAfterDeparture = false;
  while (Date.now() < deadline) {
    const stored = await bucket.list({ prefix: 'raw/v1/' });
    if (stored.objects.length > listing.objects.length) {
      savedAfterDeparture = true;
      break;
    }
    await delay(50);
  }
  assert.ok(savedAfterDeparture, `the page departure POST must reach R2 (${leaving.failure()?.errorText ?? 'no browser error'})`);
  await exitPage.close();
  let limited = false;
  for (let attempt = 0; attempt < 13 && !limited; attempt++) {
    const response = await fetch(`${collector}/v1/browser/demo`, {
      method: 'POST', headers: { Origin: 'http://127.0.0.1:5173' }, body: '{}',
    });
    if (response.status === 429) {
      assert.equal(response.headers.get('Retry-After'), '60');
      limited = true;
    } else {
      assert.equal(response.status, 400);
    }
  }
  assert.ok(limited, 'an isolated browser request burst must be limited');
  console.info('E2E passed: browser and Node trackers, Worker, R2, Parquet, DuckDB and Solid 2 dashboard.');
} finally {
  await browser?.close();
  await vite?.close();
  await worker?.dispose();
  await rm(temporary, { recursive: true, force: true });
}
