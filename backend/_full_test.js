const http = require('http');

function request(method, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, timeout: 5000 }, (res) => {
      let data = '';
      const cookies = res.headers['set-cookie'] || [];
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data.slice(0, 800), cookies }));
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers },
      timeout: 5000
    }, (res) => {
      let body = '';
      const cookies = res.headers['set-cookie'] || [];
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 800), cookies }));
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

(async () => {
  // 1. Health
  const h = await request('GET', 'http://127.0.0.1:4000/api/v1/health');
  console.log('[1] Health:', h.status, h.body);

  // 2. GET /posts sin auth
  const p = await request('GET', 'http://127.0.0.1:4000/api/v1/posts');
  console.log('[2] GET /posts (sin auth):', p.status, p.body);

  // 3. Login con root
  const login = await post('http://127.0.0.1:4000/api/v1/auth/login', {
    email: 'root@appchat.com', password: 'Root1234!'
  });
  console.log('[3] Login:', login.status, login.body.slice(0, 300));
  console.log('    Cookies:', login.cookies);

  if (login.status === 201 || login.status === 200) {
    const data = JSON.parse(login.body);
    const token = data.accessToken;
    console.log('    Token:', token ? token.slice(0, 30) + '...' : 'NONE');

    // 4. GET /posts con auth
    const p2 = await request('GET', 'http://127.0.0.1:4000/api/v1/posts', { authorization: 'Bearer ' + token });
    console.log('[4] GET /posts (con auth):', p2.status, p2.body.slice(0, 500));
  }
})();
