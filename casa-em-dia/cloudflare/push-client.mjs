import webpush from 'web-push';

// Reuse the maintained library for RFC8291/VAPID; only replace Node's HTTPS
// transport with Fetch. Requests never follow a redirect with push credentials.
// Workers accepts manual/follow; non-success statuses are rejected below.
export function createFetchPushClient(fetchImpl = globalThis.fetch) {
  return {
    async sendNotification(subscription, payload, options) {
      const details = webpush.generateRequestDetails(subscription, payload, options);
      const response = await fetchImpl(details.endpoint, {
        method: details.method,
        headers: details.headers,
        body: details.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeout || 10000),
      });
      try { await response.body?.cancel(); } catch {}
      if (!response.ok) throw Object.assign(new Error('O serviço push rejeitou o envio.'), { statusCode: response.status });
      return { statusCode: response.status };
    },
  };
}
