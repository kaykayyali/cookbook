import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.STATIC_ROOT || 'docs');
const upstream = process.env.API_UPSTREAM || 'https://cookbook.damascusfront.net';
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const headers = {};
      for (const name of ['authorization', 'content-type', 'if-match']) if (req.headers[name]) headers[name] = req.headers[name];
      const response = await fetch(`${upstream}${url.pathname}${url.search}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      res.writeHead(response.status, { 'content-type': response.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    let file = path.resolve(root, relative);
    if (!file.startsWith(root)) throw new Error('invalid path');
    try { await fs.access(file); } catch { file = path.join(root, 'index.html'); }
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(error.message);
  }
});
server.listen(port, '127.0.0.1', () => console.log(`crawl proxy ready on ${port}`));
