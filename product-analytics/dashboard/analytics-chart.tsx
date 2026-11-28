import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { init, use, type ComposeOption, type EChartsType } from 'echarts/core';
import { BarChart, LineChart, type BarSeriesOption, type LineSeriesOption } from 'echarts/charts';
import { GridComponent, MarkLineComponent, TooltipComponent, type GridComponentOption, type TooltipComponentOption } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { Period, Snapshot } from './snapshot.ts';

use([BarChart, LineChart, GridComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

const labels = { dau: '日間アクティブユーザー', page_views: 'ページビュー' };
type Metric = keyof typeof labels;
type ChartOptions = ComposeOption<BarSeriesOption | LineSeriesOption | GridComponentOption | TooltipComponentOption>;
const format = new Intl.NumberFormat('ja-JP').format;
const demoGoals = { dau: 30, page_views: 40 };
const axisFormat = new Intl.NumberFormat('ja-JP', { notation: 'compact' }).format;

function sourceLabel(source: Period['sources'][number]) {
  return [source.source === '(direct)' ? '直接流入' : source.source, source.utm_medium, source.utm_campaign]
    .filter(Boolean).join(' · ');
}

const sourceColors = ['#385cd0', '#127a75', '#a85609', '#804fb0', '#a83c63', '#096999', '#60752b', '#ac463a'];
const percent = new Intl.NumberFormat('ja-JP', { style: 'percent', maximumFractionDigits: 1 }).format;
const share = (sessions: number, total: number) =>
  sessions > 0 && sessions / total < 0.001 ? '0.1%未満' : percent(sessions / total);
type DailySources = NonNullable<Period['dailySources']>;

function TrafficChart(props: { period: Period }) {
  const [showShare, setShowShare] = createSignal(false);
  const sources = createMemo(() => {
    const daily = props.period.dailySources ?? [];
    const rows = props.period.sources.map((source, index) => ({
      label: sourceLabel(source),
      color: sourceColors[index % sourceColors.length],
      sessions: source.sessions,
      byDay: daily.map((row) => row.sessionsBySource[index]),
      details: `期間内の利用者 ${format(source.users)} 人、PV ${format(source.page_views)}`,
    }));
    const other = daily.map((row) => row.otherSessions);
    const otherTotal = other.reduce((sum, value) => sum + value, 0);
    if (otherTotal) rows.push({ label: 'その他', color: '#697991', sessions: otherTotal, byDay: other, details: '' });
    return rows;
  });
  const total = createMemo(() => sources().reduce((sum, source) => sum + source.sessions, 0));
  const options = createMemo(() => sourceOptions(props.period.dailySources ?? [], sources(), showShare()));
  const description = createMemo(() => sources()
    .map((source) => `${source.label} ${format(source.sessions)} セッション（${share(source.sessions, total())}）`)
    .join('。'));

  return (
    <section class="panel" aria-labelledby="traffic-heading">
      <div class="chart-heading">
        <h3 id="traffic-heading">流入元別セッション</h3>
        <Show when={props.period.dailySources && total() > 0}>
          <div class="chart-buttons" role="group" aria-label="流入元グラフの単位">
            <button type="button" aria-pressed={showShare() ? 'false' : 'true'} onClick={() => setShowShare(false)}>件数</button>
            <button type="button" aria-pressed={showShare() ? 'true' : 'false'} onClick={() => setShowShare(true)}>構成比</button>
          </div>
        </Show>
      </div>
      <Show when={total() > 0} fallback={<p class="traffic-empty">この期間に集計できるセッションがありません。</p>}>
        <Show when={props.period.dailySources}
          fallback={<p class="traffic-empty">この集計ファイルには日別の流入元データがありません。</p>}>
          <ChartCanvas options={options()} label="流入元別セッションの日次推移" description={description()} height="220px" />
          <p>期間合計 <strong>{format(total())}</strong> セッション</p>
        </Show>
        <ul class="source-legend" aria-label={props.period.dailySources ? '選択期間の流入元割合' : '流入元別セッション数'}>
          <For each={sources()}>{(source) => (
            <li title={source.details || undefined}>
              <span class="source-color" style={{ background: source.color }} aria-hidden="true" />
              <span>{source.label}</span>
              <strong>{format(source.sessions)}{props.period.dailySources ? `（${share(source.sessions, total())}）` : ''}</strong>
            </li>
          )}</For>
        </ul>
      </Show>
    </section>
  );
}

function sourceOptions(daily: DailySources, sources: { label: string; color: string; byDay: number[] }[], showShare: boolean): ChartOptions {
  const totals = daily.map((_, index) => sources.reduce((sum, source) => sum + source.byDay[index], 0));
  return {
    animation: false,
    grid: { top: 18, bottom: 30, left: 53, right: 14 },
    tooltip: {
      trigger: 'axis', renderMode: 'richText', confine: true,
      formatter(params) {
        const item = Array.isArray(params) ? params[0] : params;
        if (!item) return '';
        const index = item.dataIndex;
        const total = totals[index];
        return [
          daily[index].day,
          `合計 ${format(total)} セッション`,
          ...sources.filter((source) => source.byDay[index] > 0).map((source) =>
            `${source.label}　${format(source.byDay[index])}（${share(source.byDay[index], total)}）`),
        ].join('\n');
      },
    },
    xAxis: {
      type: 'category', data: daily.map(({ day }) => day),
      axisLabel: { formatter: (day: string) => day.slice(5), hideOverlap: true, color: '#50637b' },
    },
    yAxis: {
      type: 'value', max: showShare ? 1 : undefined, minInterval: showShare ? undefined : 1, splitNumber: 4,
      axisLabel: { formatter: showShare ? percent : axisFormat, color: '#50637b' },
      splitLine: { lineStyle: { color: '#e5ebf3' } },
    },
    series: sources.map((source) => ({
      name: source.label, type: 'bar', stack: 'sessions', barMaxWidth: 24,
      data: showShare ? source.byDay.map((sessions, index) => totals[index] ? sessions / totals[index] : 0) : source.byDay,
      itemStyle: { color: source.color },
    })),
  };
}

function ChartCanvas(props: { options: ChartOptions; label: string; description?: string; height: string }) {
  let element!: HTMLDivElement;
  let chart: EChartsType | undefined;
  const resize = new ResizeObserver(() => chart?.resize());

  createEffect(() => props.options, (options) => {
    if (!chart) {
      chart = init(element, undefined, { renderer: 'canvas' });
      resize.observe(element);
    }
    chart.setOption(options, { notMerge: true });
  });
  onCleanup(() => {
    resize.disconnect();
    chart?.dispose();
  });

  return <div ref={element} class="report-chart" role="img" aria-label={props.label}
    aria-description={props.description} style={{ height: props.height }} />;
}

export default function AnalyticsChart(props: { app: string; daily: Snapshot['daily']; period: Period }) {
  const [metric, setMetric] = createSignal<Metric>('dau');
  const [goals, setGoals] = createSignal(new Map<string, number | null>());
  const goalKey = createMemo(() => `product-analytics:goal:${props.app}:${metric()}`);
  const goal = createMemo(() => {
    const current = metric();
    const key = goalKey();
    const changed = goals().get(key);
    if (changed !== undefined) return changed;

    const fallback = props.app === 'demo' ? demoGoals[current] : null;
    try {
      const saved = window.localStorage.getItem(key);
      if (saved === '') return null;
      const parsed = Number(saved);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
    } catch {
      return fallback;
    }
  });

  function updateGoal(input: HTMLInputElement) {
    if (!input.reportValidity()) return;
    const value = input.value === '' ? null : input.valueAsNumber;
    const key = goalKey();
    setGoals((current) => new Map(current).set(key, value));
    try {
      window.localStorage.setItem(key, value === null ? '' : String(value));
    } catch {
      // The edited value remains available for this session.
    }
  }
  const csv = createMemo(() => {
    const lines = ['date,dau,page_views', ...props.daily.map(({ day, dau, page_views }) => `${day},${dau},${page_views}`)];
    return 'data:text/csv;charset=utf-8,' + encodeURIComponent(lines.join('\r\n') + '\r\n');
  });
  const goalDescription = createMemo(() => {
    const target = goal();
    return target === null ? undefined : `目標 ${format(target)}`;
  });
  const trendOptions = createMemo<ChartOptions>(() => {
    const days = props.daily;
    const current = metric();
    const target = goal();
    const values = days.map((day) => day[current]);
    const highest = Math.max(0, ...values);
    const maximum = target !== null && target >= highest ? target + Math.max(1, Math.ceil(target / 10)) : undefined;
    return {
      animation: false,
      grid: { top: 18, bottom: 30, left: 53, right: 14 },
      tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, valueFormatter: (value) => format(Number(value)) },
      xAxis: {
        type: 'category',
        data: days.map((day) => day.day),
        axisLabel: { formatter: (day: string) => day.slice(5), hideOverlap: true, color: '#50637b' },
      },
      yAxis: {
        type: 'value', max: maximum, minInterval: 1, splitNumber: 4,
        axisLabel: { formatter: axisFormat, color: '#50637b' },
        splitLine: { lineStyle: { color: '#e5ebf3' } },
      },
      series: [{
        name: labels[current], type: 'line', data: values,
        symbolSize: 6, showSymbol: days.length <= 12,
        lineStyle: { color: '#385cd0', width: 2 },
        itemStyle: { color: '#385cd0' },
        areaStyle: { color: '#eaf0ff' },
        markLine: target === null ? undefined : {
          silent: true,
          symbol: 'none',
          data: [{ yAxis: target }],
          lineStyle: { color: '#945108', type: 'dashed', width: 2 },
          label: { position: 'insideEndTop', formatter: `目標 ${format(target)}`, color: '#945108' },
        },
      }],
    };
  });

  return (
    <>
      <Show when={props.daily.length}>
        <section class="panel" aria-labelledby="daily-trend-heading">
          <div class="chart-heading">
            <h3 id="daily-trend-heading">日次の推移</h3>
            <div class="chart-buttons" role="group" aria-label="日次の指標">
              <button type="button" aria-pressed={metric() === 'dau' ? 'true' : 'false'} onClick={() => setMetric('dau')}>DAU</button>
              <button type="button" aria-pressed={metric() === 'page_views' ? 'true' : 'false'} onClick={() => setMetric('page_views')}>PV</button>
            </div>
          </div>
          <ChartCanvas options={trendOptions()} label={`${labels[metric()]}の推移`}
            description={goalDescription()} height="220px" />
          <div class="chart-footer">
            <label class="goal-control">目標値
              <input type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" placeholder="未設定"
                value={goal() ?? ''} onChange={(event) => updateGoal(event.currentTarget)} />
            </label>
            <a href={csv()} download="daily-metrics.csv">日別 CSV をダウンロード</a>
          </div>
        </section>
      </Show>
      <TrafficChart period={props.period} />
    </>
  );
}
