import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { init, use, type ComposeOption, type EChartsType } from 'echarts/core';
import { BarChart, LineChart, type BarSeriesOption, type LineSeriesOption } from 'echarts/charts';
import { GridComponent, MarkLineComponent, TooltipComponent, type GridComponentOption, type TooltipComponentOption } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { Period, Snapshot } from './snapshot.ts';

use([BarChart, LineChart, GridComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

const labels = { dau: '日間アクティブユーザー', page_views: 'ページビュー' };
type Metric = keyof typeof labels | 'sources';
type ChartOptions = ComposeOption<BarSeriesOption | LineSeriesOption | GridComponentOption | TooltipComponentOption>;
const format = new Intl.NumberFormat('ja-JP').format;
const demoGoals = { dau: 30, page_views: 40 };
const axisFormat = new Intl.NumberFormat('ja-JP', { notation: 'compact' }).format;

function sourceLabel(source: Period['sources'][number]) {
  return [source.source === '(direct)' ? '直接流入' : source.source, source.utm_medium, source.utm_campaign]
    .filter(Boolean).join(' · ');
}

function sourceOptions(sources: Period['sources']): ChartOptions {
  return {
    animation: false,
    grid: { top: 10, bottom: 28, left: 107, right: 44 },
    tooltip: {
      trigger: 'item', renderMode: 'richText', confine: true,
      formatter(params) {
        const item = Array.isArray(params) ? params[0] : params;
        const source = item && sources[item.dataIndex];
        return source ? [
          sourceLabel(source),
          `セッション ${format(source.sessions)}`,
          `利用者 ${format(source.users)}`,
          `PV ${format(source.page_views)}`,
        ].join('\n') : '';
      },
    },
    xAxis: {
      type: 'value', min: 0, minInterval: 1, splitNumber: 4,
      axisLabel: { formatter: axisFormat, color: '#50637b' },
      splitLine: { lineStyle: { color: '#e5ebf3' } },
    },
    yAxis: {
      type: 'category', inverse: true, data: sources.map(sourceLabel),
      axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { width: 90, overflow: 'truncate', color: '#50637b' },
    },
    series: [{
      type: 'bar', data: sources.map((source) => source.sessions), barMaxWidth: 19,
      itemStyle: { color: '#385cd0', borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', formatter: ({ value }) => format(Number(value)), color: '#50637b' },
    }],
  };
}

export default function AnalyticsChart(props: { app: string; daily: Snapshot['daily']; sources: Period['sources'] }) {
  const [metric, setMetric] = createSignal<Metric>('dau');
  const [goals, setGoals] = createSignal(new Map<string, number | null>());
  const goalKey = createMemo(() => `product-analytics:goal:${props.app}:${metric()}`);
  const goal = createMemo(() => {
    const current = metric();
    if (current === 'sources') return null;
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
  const sourceSummary = createMemo(() => props.sources
    .map((source) => `${sourceLabel(source)} ${format(source.sessions)} セッション、${format(source.users)} 人`).join('。'));
  const chartLabel = createMemo(() => {
    const current = metric();
    return current === 'sources' ? '流入元別セッションの内訳' : `${labels[current]}の推移`;
  });
  const chartDescription = createMemo(() => {
    if (metric() === 'sources') return sourceSummary();
    const target = goal();
    return target === null ? undefined : `目標 ${format(target)}`;
  });
  let element!: HTMLDivElement;
  let chart: EChartsType | undefined;
  const resize = new ResizeObserver(() => chart?.resize());

  createEffect(
    () => ({ days: props.daily, sources: props.sources, metric: metric(), goal: goal() }),
    ({ days, sources, metric, goal }) => {
      if (!chart) {
        chart = init(element, undefined, { renderer: 'canvas' });
        resize.observe(element);
      }

      if (metric === 'sources') {
        chart.setOption(sourceOptions(sources), { notMerge: true });
        return;
      }
      const values = days.map((day) => day[metric]);
      const highest = Math.max(0, ...values);
      const maximum = goal !== null && goal >= highest ? goal + Math.max(1, Math.ceil(goal / 10)) : undefined;
      const options: ChartOptions = {
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
          name: labels[metric], type: 'line', data: values,
          symbolSize: 6, showSymbol: days.length <= 12,
          lineStyle: { color: '#385cd0', width: 2 },
          itemStyle: { color: '#385cd0' },
          areaStyle: { color: '#eaf0ff' },
          markLine: goal === null ? undefined : {
            silent: true,
            symbol: 'none',
            data: [{ yAxis: goal }],
            lineStyle: { color: '#945108', type: 'dashed', width: 2 },
            label: { position: 'insideEndTop', formatter: `目標 ${format(goal)}`, color: '#945108' },
          },
        }],
      };
      chart.setOption(options, { notMerge: true });
    },
  );
  onCleanup(() => {
    resize.disconnect();
    chart?.dispose();
  });

  return (
    <>
      <div class="chart-heading">
        <h3>{metric() === 'sources' ? '流入元別セッション' : '日次の推移'}</h3>
        <div class="chart-buttons" role="group" aria-label="表示する指標">
          <button type="button" aria-pressed={metric() === 'dau' ? 'true' : 'false'} onClick={() => setMetric('dau')}>DAU</button>
          <button type="button" aria-pressed={metric() === 'page_views' ? 'true' : 'false'} onClick={() => setMetric('page_views')}>PV</button>
          <button type="button" aria-pressed={metric() === 'sources' ? 'true' : 'false'} onClick={() => setMetric('sources')}>流入元</button>
        </div>
      </div>
      <div ref={element} class="daily-chart" role="img" aria-label={chartLabel()}
        aria-description={chartDescription()}
        style={{ height: metric() === 'sources' ? `${Math.max(180, props.sources.length * 29 + 35)}px` : '220px' }} />
      <Show when={metric() === 'sources' && !props.sources.length}>
        <p>この期間に集計できるセッションがありません。</p>
      </Show>
      <Show when={props.daily.length}>
        <div class="chart-footer">
          <Show when={metric() !== 'sources'}>
            <label class="goal-control">目標値
              <input type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" placeholder="未設定"
                value={goal() ?? ''} onChange={(event) => updateGoal(event.currentTarget)} />
            </label>
          </Show>
          <a href={csv()} download="daily-metrics.csv">日別 CSV をダウンロード</a>
        </div>
      </Show>
    </>
  );
}
