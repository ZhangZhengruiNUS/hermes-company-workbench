// Local test server mirroring production nginx routes for /next/ + /api/ + /avatars/
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = '/home/ubuntu/hermes-company-workbench/web/dist';
const AVATARS = '/var/www/hermes-report/avatars';
const API_UPSTREAM = { host: '127.0.0.1', port: 8081 };
const PORT = 8123;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
};

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url;

  // Proxy API
  if (url.startsWith('/api/')) {
    const p = new URL(url, 'http://x');
    const preq = http.request({
      host: API_UPSTREAM.host,
      port: API_UPSTREAM.port,
      method: req.method,
      path: url,
      headers: { ...req.headers, host: '127.0.0.1:8081' },
    }, (pres) => {
      res.writeHead(pres.statusCode || 502, pres.headers);
      pres.pipe(res);
    });
    preq.on('error', (e) => { res.writeHead(502); res.end('proxy err: ' + e.message); });
    req.pipe(preq);
    return;
  }

  // Avatars
  if (url.startsWith('/avatars/')) {
    const file = path.basename(url.split('?')[0]);
    serveStatic(res, path.join(AVATARS, file));
    return;
  }

  // Static under /next/
  if (url.startsWith('/next/')) {
    let p = url.replace(/^\/next\//, '');
    if (p === '' || p === '/') p = 'index.html';
    // SPA fallback not needed for overview
    serveStatic(res, path.join(DIST, p));
    return;
  }

  res.writeHead(404); res.end('route not mapped: ' + url);
});

server.listen(PORT, () => {
  console.log('test server on http://127.0.0.1:' + PORT + '/next/');
});
