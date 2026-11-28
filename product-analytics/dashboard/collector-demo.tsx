import { render } from '@solidjs/web';
import { startAnalytics } from '../examples/browser.ts';
import experimentAssigned from '../events/experiment_assigned.json' with { type: 'json' };
import experimentExposed from '../events/experiment_exposed.json' with { type: 'json' };
import './style.css';

function Demo() {
  const collector = new URL(location.href).searchParams.get('collector') ?? 'http://127.0.0.1:8787';
  const analytics = startAnalytics('demo', collector);
  analytics.page('Home');
  const variant = { experiment_id: 'layout', variant: 'control' };

  function openPricing() {
    const route = new URL(location.href);
    route.pathname = '/pricing';
    history.pushState({}, '', route);
    analytics.page('Pricing');
    analytics.track('iglu:com.example.demo/pricing_opened/jsonschema/1-0-0', { plan: 'plus' });
    analytics.track(experimentAssigned.$id, variant);
    analytics.track(experimentExposed.$id, variant);
  }

  return (
    <main>
      <header class="top"><h1>イベント収集の例</h1></header>
      <p>匿名 ID <code data-testid="anonymous-id">{analytics.anonymousId()}</code></p>
      <p>セッション ID <code data-testid="session-id">{analytics.sessionId()}</code></p>
      <button type="button" onClick={openPricing}>料金画面を開く</button>
      <button type="button" onClick={() => analytics.flush()}>バッファーを送信</button>
      <p><a href="/">分析画面へ移動</a></p>
    </main>
  );
}

const app = document.getElementById('app');
if (app) render(() => <Demo />, app);
