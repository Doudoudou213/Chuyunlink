'use strict';
const assert = require('node:assert/strict'), http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const {start} = require('./lib/exploration-trial-review-preview');
let checks = 0;
function check(value, label) {assert(value, label);checks++;}
function request(url, target, {method = 'GET', headers = {}} = {}) {
  const base = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({hostname:'127.0.0.1', port:base.port, path:target, method, headers,
      timeout:5000}, res => {
      const chunks = [];
      res.on('data', data => chunks.push(data));
      res.on('end', () => resolve({status:res.statusCode, headers:res.headers, body:Buffer.concat(chunks)}));
    });
    req.on('timeout', () => req.destroy(Error('Local test timeout')));
    req.on('error', reject);req.end();
  });
}
(async () => {
  for (const port of [-1, 65536, 1.2, '4223', NaN]) {
    await assert.rejects(start(port), /端口/);checks++;
  }
  const server = await start(), base = new URL(server.url);
  try {
    const files = [
      ['/', 'tools/preview/exploration-trial-review.html', 'text/html'],
      ['/trial-review.html', 'tools/preview/exploration-trial-review.html', 'text/html'],
      ['/review.css', 'tools/preview/exploration-trial-review.css', 'text/css'],
      ['/review.js', 'tools/preview/exploration-trial-review.js', 'text/javascript'],
      ['/review-data.js', 'tools/lib/exploration-trial-review-data.js', 'text/javascript'],
      ['/paper.webp', 'static/assets/paper-fibres-soft-v1.webp', 'image/webp'],
      ['/brush.woff2', 'static/assets/longcang-editorial-v1.woff2', 'font/woff2']
    ];
    for (const [url, local, type] of files) {
      const r = await request(server.url, url);
      check(r.status === 200, url + ' exists');
      check(r.headers['content-type'].startsWith(type), url + ' type');
      check(r.body.equals(fs.readFileSync(path.join(__dirname, '..', local))), url + ' exact bytes');
      check(Number(r.headers['content-length']) === r.body.length, url + ' length');
      const head = await request(server.url, url, {method:'HEAD'});
      check(head.status === 200 && !head.body.length && head.headers['content-length'] === r.headers['content-length'], url + ' HEAD');
    }
    const page = await request(server.url, '/trial-review.html?preview=local-review');
    check(page.status === 200, 'query does not select arbitrary files');
    check(page.headers['cache-control'] === 'no-store', 'no cache');
    check(page.headers['x-content-type-options'] === 'nosniff', 'no sniff');
    check(page.headers['referrer-policy'] === 'no-referrer', 'no referrer');
    check(page.headers['cross-origin-resource-policy'] === 'same-origin', 'no cross-origin resources');
    check(!page.headers['access-control-allow-origin'], 'no CORS');
    for (const directive of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self'", "font-src 'self'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "frame-ancestors 'none'", "worker-src 'none'"])
      check(page.headers['content-security-policy'].includes(directive), directive);
    check(!/unsafe-inline|unsafe-eval|https:|data:/.test(page.headers['content-security-policy']), 'no inline or remote allowances');
    for (const host of ['attacker.example', '127.0.0.1', 'localhost', 'localhost:1', '127.0.0.1.attacker.example:' + base.port])
      check((await request(server.url, '/', {headers:{Host:host}})).status === 421, 'reject wrong Host ' + host);
    check((await request(server.url, '/', {headers:{Host:'localhost:' + base.port}})).status === 200, 'localhost alias');
    for (const origin of ['https://evil.example', 'null', 'http://127.0.0.1:1', 'https://' + base.host])
      check((await request(server.url, '/', {headers:{Origin:origin}})).status === 403, 'reject foreign Origin');
    check((await request(server.url, '/', {headers:{Origin:server.url}})).status === 200, 'same-origin permitted');
    for (const site of ['cross-site', 'same-site'])
      check((await request(server.url, '/', {headers:{'Sec-Fetch-Site':site}})).status === 403, 'reject ' + site);
    for (const site of ['none', 'same-origin'])
      check((await request(server.url, '/', {headers:{'Sec-Fetch-Site':site}})).status === 200, 'allow ' + site);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const r = await request(server.url, '/trial-review.html', {method});
      check(r.status === 405 && r.headers.allow === 'GET, HEAD', 'no writes ' + method);
    }
    for (const target of ['/../package.json', '/%2e%2e/package.json', '/%252e%252e/package.json', '/review%2ejs', '/\\package.json', '//trial-review.html', 'http://evil.example/', '/%00', '/%', '/./trial-review.html'])
      check((await request(server.url, target)).status === 400, 'raw traversal rejected ' + target);
    for (const target of ['/unknown.js', '/package.json', '/admin.html', '/.env', '/favicon.ico'])
      check((await request(server.url, target)).status === 404, 'no unlisted file ' + target);
    for (const target of ['/static/cloudbase-app.js', '/cloudfunctions/appCore/index.js', '/tools/preview/exploration-trial-review.html'])
      check((await request(server.url, target)).status !== 200, 'no source prefix serving');
    for (const name of ['validate-cloudbase-build.js', 'deploy-cloudbase.ps1']) {
      const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
      check(!source.includes('exploration-trial-review'), 'tool omitted from formal ' + name);
    }
    const hubOrigin = 'http://127.0.0.1:4224';
    const navigationHeaders = {'Sec-Fetch-Site':'same-site', 'Sec-Fetch-Mode':'navigate',
      'Sec-Fetch-Dest':'document', Referer:hubOrigin + '/trial-suite.html'};
    check((await request(server.url, '/trial-review.html', {headers:navigationHeaders})).status === 403,
      'standalone default rejects cross-port document navigation');
    for (const origins of [null, 'http://127.0.0.1:4224', ['https://127.0.0.1:4224'],
      ['http://127.0.0.1'], ['http://evil.example:4224'], ['http://127.0.0.1:4224/'],
      ['http://localhost:4224/a'], ['http://u@localhost:4224'], Array(5).fill(hubOrigin)]) {
      await assert.rejects(start(0, {trustedNavigationOrigins:origins}), /来源/);checks++;
    }
    const trusted = await start(0, {trustedNavigationOrigins:[hubOrigin]});
    try {
      for (const target of ['/', '/trial-review.html', '/trial-review.html?preview=local-review']) {
        for (const method of ['GET', 'HEAD']) {
          const r = await request(trusted.url, target, {method, headers:navigationHeaders});
          check(r.status === 200 && (method !== 'HEAD' || !r.body.length), 'known hub can open only review document');
        }
      }
      for (const headers of [
        {...navigationHeaders, Referer:'http://127.0.0.1:4225/trial-suite.html'},
        {...navigationHeaders, Referer:'https://evil.example/'},
        {...navigationHeaders, Referer:'invalid'},
        {...navigationHeaders, Referer:''},
        {...navigationHeaders, Origin:'https://evil.example'},
        {...navigationHeaders, 'Sec-Fetch-Site':'cross-site'},
        {...navigationHeaders, 'Sec-Fetch-Mode':'cors'},
        {...navigationHeaders, 'Sec-Fetch-Dest':'script'},
        {...navigationHeaders, 'Sec-Fetch-Dest':''}
      ]) check((await request(trusted.url, '/trial-review.html', {headers})).status === 403, 'reject non-navigation or unknown source');
      for (const target of ['/review.js', '/review.css', '/paper.webp', '/brush.woff2', '/review-data.js'])
        check((await request(trusted.url, target, {headers:navigationHeaders})).status === 403, 'trusted navigation does not open assets');
      for (const method of ['POST', 'PUT', 'DELETE'])
        check((await request(trusted.url, '/trial-review.html', {method, headers:navigationHeaders})).status !== 200, 'trusted navigation never permits writes');
    } finally {await trusted.close();}
    console.log('Trial review local server: ' + checks + ' checks passed.');
  } finally {await server.close();}
})().catch(error => {console.error(error);process.exitCode = 1;});
