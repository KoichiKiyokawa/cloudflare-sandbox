import { createMemo, createSignal, For, lazy, Loading, Show } from 'solid-js';
import { render } from '@solidjs/web';
import { parseSnapshot, type Snapshot } from './snapshot.ts';
import './style.css';

const AnalyticsChart = lazy(() => import('./analytics-chart.tsx'));
const number = new Intl.NumberFormat('ja-JP');
const format = (value: number) => number.format(value);

function Summary(props: { data: Snapshot; availableDays?: number[]; onPeriodChange: (days: number) => void }) {
  const [days, setDays] = createSignal(30);
  const period = createMemo(() => props.data.periods.find((item) => item.days === days()) ?? props.data.periods[0]);
  const periods = createMemo(() => props.availableDays ?? props.data.periods.map((item) => item.days));
  const daily = createMemo(() => props.data.daily.filter((day) => day.day >= period().from && day.day < period().to));
  const latest = createMemo(() => daily().at(-1));
  return (
    <>
      <div class="report-heading">
        <div><h2>{props.data.app}</h2><p>{period().from} から {period().to} 未満 · {props.data.timeZone}</p></div>
        <div class="report-options">
          <Show when={periods().length > 1}>
            <label class="period-select">期間
              <select value={String(period().days)} onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (props.availableDays) props.onPeriodChange(next);
                else setDays(next);
              }}>
                <For each={periods()}>{(item) => <option value={item} selected={item === period().days}>{item === 180 ? '直近半年（180日）' : `直近${item}日`}</option>}</For>
              </select>
            </label>
          </Show>
          <p class="cutoff">最終集計 <time>{new Date(props.data.knownAt).toLocaleString('ja-JP', { timeZone: props.data.timeZone })}</time></p>
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
        <section class="panel">
          <Loading fallback={<p>グラフを読み込んでいます。</p>}>
            <AnalyticsChart app={props.data.app} daily={daily()} sources={period().sources} />
          </Loading>
        </section>
      </Show>
    </>
  );
}

function Dashboard() {
  const [snapshot, setSnapshot] = createSignal<Snapshot>();
  const [status, setStatus] = createSignal('');
  const [fileMode, setFileMode] = createSignal(false);
  let requestNumber = 0;
  const [availableDays, setAvailableDays] = createSignal<number[]>();
  let hasSnapshot = false;

  async function loadPeriod(days: number) {
    const current = ++requestNumber;
    try {
      const url = new URL('api/dashboard', document.baseURI);
      url.searchParams.set('days', String(days));
      const response = await fetch(url);
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('集計 JSON を取得できませんでした。');
      }
      const data = parseSnapshot(await response.json());
      if (current !== requestNumber) return;
      hasSnapshot = true;
      setAvailableDays(data.availableDays);
      setFileMode(false);
      setSnapshot(data);
      setStatus('');
    } catch (error) {
      if (current !== requestNumber) return;
      setStatus(hasSnapshot ? '最新の集計を取得できなかったため、前回の集計を表示しています。'
        : error instanceof Error ? error.message : '集計 JSON を取得できませんでした。');
    }
  }

  async function loadFile(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const current = ++requestNumber;
    try {
      const data = parseSnapshot(JSON.parse(await file.text()));
      if (current !== requestNumber) return;
      hasSnapshot = true;
      setAvailableDays(undefined);
      setFileMode(true);
      setSnapshot(data);
      setStatus('');
    } catch (error) {
      if (current !== requestNumber) return;
      setStatus(error instanceof Error ? error.message : '集計ファイルを読み込めませんでした。');
    }
  }

  void loadPeriod(30);

  return (
    <main>
      <header class="top">
        <h1>プロダクト分析</h1>
        <div class="actions">
          <label class="file-button">集計 JSON を開く<input type="file" accept=".json,application/json" onChange={loadFile} /></label>
        </div>
      </header>
      <Show when={fileMode()}><p class="mode">ローカルファイルを表示中</p></Show>
      <Show when={status()}>{(message) => <p role="alert">{message()}</p>}</Show>
      <Show when={snapshot()} fallback={
        <div class="empty">
          <h2>集計結果を読み込む</h2>
          <p>DuckDB CLI の <code>snapshot</code> コマンドで生成した JSON を選択してください。ファイルはブラウザー内で読み込みます。</p>
        </div>
      }>{(data) => <Summary data={data()} availableDays={availableDays()} onPeriodChange={(days) => void loadPeriod(days)} />}</Show>
    </main>
  );
}

const app = document.getElementById('app');
if (app) render(() => <Dashboard />, app);
