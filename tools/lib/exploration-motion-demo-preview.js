'use strict';

// Isolated local artwork preview: no SDK, proxy, business data or write endpoint.
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.avif': 'image/avif', '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8'
};

function allowedPath(raw) {
  let pathname;
  try { pathname = decodeURIComponent(String(raw || '/').split('?')[0]); }
  catch { return null; }
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(p => p === '.' || p === '..')) return null;
  if (pathname === '/' || pathname === '/explore-motion-demo.html') return '/explore-motion-demo.html';
  if (/^\/static\/exploration-motion-[a-z0-9-]+\.(?:css|js)$/.test(pathname)) return pathname;
  if (/^\/static\/exploration-(?:gilded-reveal|gilded-profiles|park-layout|park-demo)\.js$/.test(pathname)) return pathname;
  if (pathname === '/static/assets/gsap-3.15.0.min.js') return pathname;
  if (/^\/static\/assets\/exploration-motion\/[a-zA-Z0-9._-]+\.(?:webp|png|jpe?g|avif|svg|json)$/.test(pathname)) return pathname;
  if (/^\/static\/assets\/(?:longcang-editorial-v1\.woff2|paper-fibres-soft-v1\.webp)$/.test(pathname)) return pathname;
  if (pathname === '/static/assets/vendor/lucide-1.51.0.min.js') return pathname;
  return null;
}

async function start(port = 0) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local preview port');
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
    }
    const pathname = allowedPath(req.url);
    if (!pathname) { res.writeHead(404); res.end(); return; }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
    try {
      const real = await fs.realpath(file);
      if (!real.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
      const data = await fs.readFile(real);
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.setHeader('Content-Length', data.length);
      res.writeHead(200);
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      res.writeHead(['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code) ? 404 : 500);
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

module.exports = { start, allowedPath };
if (require.main === module) start(process.argv[2] === undefined ? 4207 : Number(process.argv[2]))
  .then(server => console.log(server.url + '/explore-motion-demo.html'))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
