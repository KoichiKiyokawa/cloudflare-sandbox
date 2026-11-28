import { createMemo, createSignal, For, lazy, Loading, onCleanup, Show } from 'solid-js';
import { render } from '@solidjs/web';
import { parseSnapshot, type Snapshot } from './snapshot.ts';
import { cacheRemainingHeader, dashboardPeriods, dashboardReportPath, type DashboardPeriod } from './query-endpoint.ts';
import './style.css';

const AnalyticsChart = lazy(() => import('./analytics-chart.tsx'));
const number = new Intl.NumberFormat('ja-JP');
const format = (value: number) => number.format(value);
const dateTime = (value: string, timeZone: string) => new Date(value).toLocaleString('ja-JP', { timeZone });
const staleAfterMs = 30 * 60 * 60_000;
const pollIntervalMs = 5 * 60_000;
const initialPeriod: DashboardPeriod = 30;

function Summary(props: { data: Snapshot; days: DashboardPeriod; fileMode: boolean; selectDays: (days: DashboardPeriod) => void }) {
  const period = createMemo(() => props.data.periods.find((item) => item.days === props.days) ?? props.data.periods[0]);
  const choices = createMemo(() => props.fileMode
    ? dashboardPeriods.filter((days) => props.data.periods.some((item) => item.days === days))
    : dashboardPeriods);
  const daily = createMemo(() => props.data.daily.filter((day) => day.day >= period().from && day.day < period().to));
  const latest = createMemo(() => daily().at(-1));
  return (
    <>
      <div class="report-heading">
        <div><h2>{props.data.app}</h2><p>{period().from} から {period().to} 未満 · {props.data.timeZone}</p></div>
        <div class="report-options">
          <Show when={choices().length > 1}>
            <label class="period-select">期間
              <select value={String(props.days)} onChange={(event) => {
                const requested = dashboardPeriods.find((days) => String(days) === event.currentTarget.value);
                if (requested !== undefined) props.selectDays(requested);
              }}>
                <For each={choices()}>{(days) => <option value={days} selected={days === props.days}>{days === 180 ? '直近半年（180日）' : `直近${days}日`}</option>}</For>
              </select>
            </label>
          </Show>
          <div class="cutoff">
            <p>最終集計 <time>{dateTime(props.data.knownAt, props.data.timeZone)}</time></p>
            <Show when={props.data.latestReceivedAt}>
              {(latest) => <p>集計対象の最終受信 <time>{dateTime(latest(), props.data.timeZone)}</time></p>}
            </Show>
          </div>
        </div>
      </div>
      <Show when={latest()} fallback={<p class="empty">この期間に観測が完了した日はありません。</p>}>
        {(day) => (
          <>
            <div class="section-title"><h3>直近日の指標</h3><time>{day().day}</time></div>
            <dl class="cards">
              <div><dt>日間アクティブ</dt><dd>{format(day().dau)}</dd></div>
              <div><dt>直近7日アクティブ</dt><dd>{format(day().wau)}</dd></div>
              <div><dt>直近30日アクティブ</dt><dd>{format(day().mau)}</dd></div>
              <div><dt>ページビュー</dt><dd>{format(day().page_views)}</dd></div>
              <div><dt>ページ閲覧者</dt><dd>{format(day().page_users)}</dd></div>
            </dl>
          </>
        )}
      </Show>
      <Show when={daily().length || period().sources.length}>
        <Loading fallback={<p>グラフを読み込んでいます。</p>}>
          <AnalyticsChart app={props.data.app} daily={daily()} period={period()} />
        </Loading>
      </Show>
    </>
  );
}

function Dashboard() {
  const [snapshot, setSnapshot] = createSignal<Snapshot>();
  const [status, setStatus] = createSignal('');
  const [fileMode, setFileMode] = createSignal(false);
  const [days, setDays] = createSignal<DashboardPeriod>(initialPeriod);
  const [now, setNow] = createSignal(Date.now());
  const stale = createMemo(() => {
    const saved = snapshot();
    return !!saved && !fileMode() && now() - Date.parse(saved.knownAt) >= staleAfterMs;
  });
  let requestNumber = 0;
  let usingFile = false;
  let hasSnapshot = false;
  let refreshTimer: number | undefined;

  async function refresh(period = days()) {
    window.clearTimeout(refreshTimer);
    const current = ++requestNumber;
    let nextCheck = pollIntervalMs;
    try {
      const response = await fetch(new URL(dashboardReportPath(period), document.baseURI), { cache: 'no-store' });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('集計 JSON を取得できませんでした。');
      }
      const data = parseSnapshot(await response.json());
      if (current !== requestNumber) return;
      const remaining = Number(response.headers.get(cacheRemainingHeader));
      if (Number.isSafeInteger(remaining) && remaining > 0 && remaining <= 2_147_483_647) nextCheck = remaining;
      hasSnapshot = true;
      setFileMode(false);
      setSnapshot(data);
      setStatus('');
    } catch (error) {
      if (current !== requestNumber) return;
      setStatus(hasSnapshot ? '最新の集計を取得できなかったため、前回の集計を表示しています。'
        : error instanceof Error ? error.message : '集計 JSON を取得できませんでした。');
    } finally {
      if (current === requestNumber && !usingFile) {
        setNow(Date.now());
        refreshTimer = window.setTimeout(() => void refresh(), nextCheck);
      }
    }
  }

  async function loadFile(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const current = ++requestNumber;
    usingFile = true;
    window.clearTimeout(refreshTimer);
    try {
      const data = parseSnapshot(JSON.parse(await file.text()));
      if (current !== requestNumber) return;
      if (!data.periods.some((period) => period.days === days())) {
        const available = dashboardPeriods.find((days) => data.periods.some((period) => period.days === days));
        if (available !== undefined) setDays(available);
      }
      hasSnapshot = true;
      setFileMode(true);
      setSnapshot(data);
      setStatus('');
    } catch (error) {
      if (current !== requestNumber) return;
      setStatus(error instanceof Error ? error.message : '集計ファイルを読み込めませんでした。');
    }
  }

  void refresh(initialPeriod);
  onCleanup(() => {
    window.clearTimeout(refreshTimer);
    requestNumber += 1;
  });

  return (
    <main>
      <header class="top">
        <h1>プロダクト分析</h1>
        <div class="actions">
          <button type="button" onClick={() => { usingFile = false; void refresh(); }}>最新の集計を読む</button>
          <label class="file-button">集計 JSON を開く<input type="file" accept=".json,application/json" onChange={loadFile} /></label>
        </div>
      </header>
      <Show when={fileMode()}><p class="mode">ローカルファイルを表示中</p></Show>
      <Show when={status()}>{(message) => <p role="alert">{message()}</p>}</Show>
      <Show when={stale()}>
        <p class="stale-warning" role="status">最終集計から30時間以上経過しています。</p>
      </Show>
      <Show when={snapshot()} fallback={
        <div class="empty">
          <h2>集計結果を読み込む</h2>
          <p>DuckDB CLI の <code>snapshot</code> コマンドで生成した JSON を選択してください。ファイルはブラウザー内で読み込みます。</p>
        </div>
    }>{(data) => <Summary data={data()} days={days()} fileMode={fileMode()} selectDays={(period) => {
      setDays(period);
      if (!usingFile) void refresh(period);
    }} />}</Show>
    </main>
  );
}

const app = document.getElementById('app');
if (app) render(() => <Dashboard />, app);
