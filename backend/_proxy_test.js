const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data.slice(0, 500) }));
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

(async () => {
  // Directo al backend
  try {
    const r = await get('http://127.0.0.1:4000/api/v1/health');
    console.log('[BACKEND DIRECTO] /health =>', r.status, r.body);
  } catch (e) { console.log('[BACKEND DIRECTO] ERROR:', e.message); }

  // Via proxy Next.js
  try {
    const r = await get('http://127.0.0.1:3000/api/v1/health');
    console.log('[PROXY NEXT.JS]   /health =>', r.status, r.body);
  } catch (e) { console.log('[PROXY NEXT.JS]   ERROR:', e.message); }

  // Feed via proxy
  try {
    const r = await get('http://127.0.0.1:3000/api/v1/posts/feed');
    console.log('[PROXY NEXT.JS]   /posts/feed =>', r.status, r.body);
  } catch (e) { console.log('[PROXY NEXT.JS]   /posts/feed ERROR:', e.message); }
})();
