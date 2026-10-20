export function securityHeaders(headers = {}, secure = true) {
  const result = new Headers(headers);
  result.set('X-Content-Type-Options', 'nosniff');
  result.set('X-Frame-Options', 'DENY');
  result.set('Referrer-Policy', 'no-referrer');
  result.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  result.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (secure) result.set('Strict-Transport-Security', 'max-age=31536000');
  return result;
}

export function withSecurity(response, request) {
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: securityHeaders(response.headers, new URL(request.url).protocol === 'https:') });
}

export function nodeRequest(request) {
  const url = new URL(request.url);
  const headers = Object.fromEntries(request.headers);
  headers.host = url.host;
  headers['x-forwarded-proto'] = url.protocol.slice(0, -1);
  return {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    socket: { remoteAddress: request.headers.get('CF-Connecting-IP') || 'local' },
    async *[Symbol.asyncIterator]() {
      if (!request.body) return;
      const reader = request.body.getReader(), decoder = new TextDecoder();
      let ended = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { ended = true; break; }
          yield decoder.decode(value, { stream: true });
        }
        const tail = decoder.decode();
        if (tail) yield tail;
      } finally {
        if (!ended) { try { await reader.cancel(); } catch {} }
        reader.releaseLock();
      }
    },
  };
}

export async function readJson(request, maximum) {
  const length = request.headers.get('Content-Length');
  if (length && Number(length) > maximum) {
    try { await request.body?.cancel(); } catch {}
    throw Object.assign(new Error('Arquivo maior que o limite de importação.'), { status: 413 });
  }
  const pieces = [], reader = request.body?.getReader();
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) { await reader.cancel(); throw Object.assign(new Error('Arquivo maior que o limite de importação.'), { status: 413 }); }
        pieces.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const piece of pieces) { bytes.set(piece, offset); offset += piece.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Object.assign(new Error('Arquivo JSON inválido.'), { status: 400 }); }
}
