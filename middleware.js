const CLIENT_PATCH = `
<script>
(function(){
  if (window.__aiVerifyPasswordPatch) return;
  window.__aiVerifyPasswordPatch = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url ? String(input.url) : '');
    const isClassifyCall = url === '/api/classify' || url.endsWith('/api/classify');

    if (isClassifyCall) {
      const password = window.prompt('This feature requires entering the password');
      if (password === null) {
        throw new Error('AI verification cancelled.');
      }

      if (!init) init = {};
      if (typeof init.body === 'string') {
        const payload = JSON.parse(init.body || '{}');
        payload.aiFeaturePassword = password;
        init = Object.assign({}, init, { body: JSON.stringify(payload) });
      }
    }

    return originalFetch(input, init);
  };
})();
</script>`;

export async function middleware(request) {
  const url = new URL(request.url);
  if (url.searchParams.get('__mw_bypass') === '1') {
    return;
  }

  const upstreamUrl = new URL('/index.html', url.origin);
  upstreamUrl.searchParams.set('__mw_bypass', '1');

  const upstream = await fetch(upstreamUrl);
  let html = await upstream.text();

  if (!html.includes('__aiVerifyPasswordPatch')) {
    if (html.includes('</body>')) {
      html = html.replace('</body>', CLIENT_PATCH + '\n</body>');
    } else {
      html += CLIENT_PATCH;
    }
  }

  const headers = new Headers(upstream.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');

  return new Response(html, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}

export const config = {
  matcher: ['/', '/index.html']
};
