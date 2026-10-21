'use strict';
// Local, read-only static tool. Feedback files are read by the browser, never
// posted here. No cloud clients, process secrets, fixtures or directory serving.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../..');
const files = new Map([
  ['/', ['tools/preview/exploration-trial-review.html', 'text/html;charset=utf-8']],
  ['/trial-review.html', ['tools/preview/exploration-trial-review.html', 'text/html;charset=utf-8']],
  ['/review.css', ['tools/preview/exploration-trial-review.css', 'text/css;charset=utf-8']],
  ['/review.js', ['tools/preview/exploration-trial-review.js', 'text/javascript;charset=utf-8']],
  ['/review-data.js', ['tools/lib/exploration-trial-review-data.js', 'text/javascript;charset=utf-8']],
  ['/paper.webp', ['static/assets/paper-fibres-soft-v1.webp', 'image/webp']],
  ['/brush.woff2', ['static/assets/longcang-editorial-v1.woff2', 'font/woff2']]
]);
const csp = ["default-src 'none'", "script-src 'self'", "style-src 'self'",
  "img-src 'self'", "font-src 'self'", "connect-src 'none'", "object-src 'none'",
  "base-uri 'none'", "form-action 'none'", "frame-src 'none'", "frame-ancestors 'none'",
  "worker-src 'none'", "media-src 'none'"].join('; ');

async function start(port = 0) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('本机预览端口不合法');
  const realRoot = fs.realpathSync(root);
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const finish = (status, headers = {}, body) => {
      req.resume();res.writeHead(status, headers);res.end(req.method === 'HEAD' ? undefined : body);
    };
    const hosts = ['127.0.0.1:' + server.address().port, 'localhost:' + server.address().port];
    if (!hosts.includes(req.headers.host)) return finish(421);
    if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) return finish(403);
    if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return finish(403);
    if (!['GET', 'HEAD'].includes(req.method)) return finish(405, {Allow:'GET, HEAD'});
    // Check the raw target before any URL normalization. No percent-encoded
    // routes, dot segments, absolute targets or backslashes are accepted.
    const target = String(req.url || '').split('?')[0];
    if (!/^\/[a-z0-9.\-]*$/.test(target) || target === '/.' || target === '/..') return finish(400);
    const entry = files.get(target);
    if (!entry) return finish(404);
    try {
      const file = fs.realpathSync(path.join(realRoot, entry[0]));
      const relative = path.relative(realRoot, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return finish(404);
      const content = fs.readFileSync(file);
      return finish(200, {'Content-Type':entry[1], 'Content-Length':content.length}, content);
    } catch {
      // Do not disclose file paths or local errors to browser callers.
      return finish(404);
    }
  });
  server.requestTimeout = 10000;server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {server.once('error', reject);server.listen(port, '127.0.0.1', resolve);});
  return {url:'http://127.0.0.1:' + server.address().port,
    close:() => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeIdleConnections?.();
    })};
}
module.exports = {start};
if (require.main === module) start(process.argv[2] === undefined ? 4223 : Number(process.argv[2]))
  .then(server => console.log(server.url + '/trial-review.html'))
  .catch(error => {console.error(error.message);process.exitCode = 1;});
