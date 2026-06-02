const http = require('http');

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get('http://localhost:4000' + path, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data.slice(0, 300) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

(async () => {
  const routes = [
    '/api/v1/posts/feed',
    '/api/v1/groups',
    '/api/v1/users/me',
    '/api/v1/auth/me',
  ];
  for (const r of routes) {
    try {
      const res = await get(r);
      console.log(r, '=>', res.status, res.body);
    } catch (e) {
      console.log(r, '=> ERROR:', e.message);
    }
    console.log('---');
  }
})();
