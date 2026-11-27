import { newTracker, setCustomUrl, setReferrerUrl, trackPageView, trackSelfDescribingEvent } from '@snowplow/browser-tracker';

export function startAnalytics(appId: string, collectorOrigin: string) {
  const tracker = newTracker(appId, collectorOrigin, {
    appId,
    postPath: `/v1/browser/${appId}`,
    eventMethod: 'post',
    encodeBase64: false,
    credentials: 'omit',
    bufferSize: 10,
    maxPostBytes: 20_000,
    keepalive: true,
    customFetch: (request) => {
      const headers = new Headers(request.headers);
      headers.set('Content-Type', 'text/plain;charset=UTF-8');
      return fetch(request, { headers });
    },
    retryFailedRequests: true,
    dontRetryStatusCodes: [413],
    stateStorageStrategy: 'cookieAndLocalStorage',
    maxLocalStorageQueueSize: 1000,
    sessionCookieTimeout: 1800,
    synchronousCookieWrite: true,
    contexts: { webPage: true, session: true },
  });
  if (!tracker) throw new Error('Initialize analytics once per browser page and project');
  const flush = () => tracker.flushBuffer();
  window.setInterval(flush, 5000);
  window.addEventListener('online', flush);

  // Keep the path and marketing parameters. Exclude other query values and the fragment.
  function analyticsUrl(input: string) {
    const original = new URL(input);
    const clean = new URL(original.origin);
    clean.pathname = original.pathname;
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const value = original.searchParams.get(key);
      if (value !== null) clean.searchParams.set(key, value);
    }
    return clean.href;
  }

  return {
    page(title: string) {
      setCustomUrl(analyticsUrl(window.location.href), [appId]);
      setReferrerUrl(document.referrer ? analyticsUrl(document.referrer) : '', [appId]);
      trackPageView({ title }, [appId]);
    },
    track(schema: string, data: Record<string, unknown>) {
      trackSelfDescribingEvent({ event: { schema, data } }, [appId]);
    },
    anonymousId: () => tracker.getDomainUserId(),
    sessionId: () => tracker.getDomainSessionId(),
    login: (userId: string) => tracker.setUserId(userId),
    logout: () => tracker.clearUserData({ preserveSession: false, preserveUser: false }),
    flush,
  };
}
