import { createServer } from 'http';
import { createReadStream, existsSync, statSync } from 'fs';
import { join, extname } from 'path';
import { request as httpRequest } from 'http';

const PORT = process.env.PORT || 80;
const DIST = join(import.meta.dirname, 'dist');
const BACKEND = process.env.BACKEND_URL || 'http://wordpress_orquestra-backend:8000';

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(res, filePath) {
  const ext = extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  createReadStream(filePath).pipe(res);
}

function proxyToBackend(req, res) {
  const url = new URL(BACKEND);
  const opts = {
    hostname: url.hostname,
    port: url.port || 80,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: url.host },
    timeout: 120000,
  };

  const proxy = httpRequest(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxy.on('error', (err) => {
    console.error('[PROXY] Error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Backend unavailable' }));
    }
  });

  req.pipe(proxy);
}

const server = createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  // Proxy API requests to backend
  if (urlPath.startsWith('/api/')) {
    return proxyToBackend(req, res);
  }

  // Serve static files
  let filePath = join(DIST, urlPath);

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    return serveStatic(res, filePath);
  }

  // SPA fallback - serve index.html
  const indexPath = join(DIST, 'index.html');
  if (existsSync(indexPath)) {
    return serveStatic(res, indexPath);
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[FRONTEND] Serving on port ${PORT}, proxying /api to ${BACKEND}`);
});
