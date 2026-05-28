import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

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

export default async function handler(request, response) {
  try {
    const htmlPath = join(process.cwd(), 'index.html');
    let html = await readFile(htmlPath, 'utf8');

    if (!html.includes('__aiVerifyPasswordPatch')) {
      if (html.includes('</body>')) {
        html = html.replace('</body>', CLIENT_PATCH + '\n</body>');
      } else {
        html += CLIENT_PATCH;
      }
    }

    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.status(200).send(html);
  } catch (error) {
    response.status(500).json({ error: error?.message || 'Unable to render app.' });
  }
}
