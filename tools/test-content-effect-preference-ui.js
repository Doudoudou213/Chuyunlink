'use strict';

// Exercise the real collection disclosure and client script in an isolated browser.
// All effect calls are local fixtures; external requests are blocked.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const disclosure = html.match(/<details class="collect-consent-disclosure">[\s\S]*?<\/details>/)?.[0];
assert(disclosure?.includes('id="collect-effects-preference"'), 'real form includes the preference host');
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
const script = fs.readFileSync(path.join(root, 'static/content-effects.js'), 'utf8');
const server = http.createServer((req, res) => {
  if (req.url === '/content-effects.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(script); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const main = req.url === '/index.html' ? `<main id="view-collect"><form id="collect-form">${disclosure}</form></main>` : '<main><p>独立内容页</p></main>';
  res.end(`<!doctype html><meta charset="utf-8"><style>${styles}</style>${main}<script src="/content-effects.js"></script>`);
});

async function setup(page) {
  await page.evaluate(() => {
    window.effectCalls = [];
    window.localEffects = async request => { effectCalls.push(request); return { enabled: true }; };
    ContentEffects.configure(localEffects);
  });
}

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext();
    await context.route('https://**/*', route => route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin + '/index.html');
    const formBefore = await page.locator('#collect-form').evaluate(form => [...new FormData(form)]);
    await setup(page);
    await page.locator('.collect-consent-disclosure').evaluate(node => { node.open = true; });
    const choice = page.locator('#content-effects-choice');
    assert.equal(await choice.getAttribute('type'), 'checkbox');
    assert.equal(await choice.isChecked(), true, 'existing browser-default permission retained');
    assert.equal(await choice.getAttribute('name'), null, 'preference is not a submission field');
    assert.equal(await page.locator('#collect-effects-preference > label.collect-consent-option').count(), 1);
    assert.equal(await page.locator('body > footer').count(), 0);
    assert.deepEqual(await page.locator('#collect-form').evaluate(form => [...new FormData(form)]), formBefore);
    assert.match(await page.locator('#content-effects-description').innerText(), /不影响投稿审核.*当前浏览器/);
    await page.evaluate(() => { ContentEffects.configure(localEffects); ContentEffects.configure(localEffects); });
    assert.equal(await choice.count(), 1, 'reconfigure never mounts a duplicate');

    await page.evaluate(() => {
      ContentEffects.open('fixture', { kind: 'route', mode: 'walk', minutes: 60, stops: '1' });
      ContentEffects.contribute('fixture');
    });
    assert(await page.evaluate(() => Boolean(ContentEffects.fields().effectNonce)));
    await choice.uncheck();
    assert.equal(await page.evaluate(() => localStorage.getItem('chu-effects-disabled')), 'true');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('chu-effect-contribution')), null);
    assert.deepEqual(await page.evaluate(() => ContentEffects.fields()), {});
    await page.locator('#collect-form').evaluate(form => form.reset());
    assert.equal(await choice.isChecked(), false, 'form reset keeps the saved browser preference');
    await choice.check();
    const count = await page.evaluate(() => effectCalls.length);
    await page.evaluate(() => ContentEffects.emit('fixture', 'source_open'));
    assert.equal(await page.evaluate(() => effectCalls.length), count, 'old slots cleared when preference changed');

    // A response received after off/on must not revive the old contribution association.
    await page.evaluate(() => {
      effectCalls = [];
      ContentEffects.configure(request => {
        effectCalls.push(request);
        return request.action === 'beginContentEffect' ? new Promise(resolve => { window.resolveOldEffect = resolve; }) : Promise.resolve({ enabled: true });
      });
      ContentEffects.open('delayed', { kind: 'route', mode: 'walk', minutes: 60, stops: '1' });
      ContentEffects.contribute('delayed');
    });
    await choice.uncheck(); await choice.check();
    await page.evaluate(async () => { resolveOldEffect({ enabled: true }); await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(await page.evaluate(() => effectCalls.filter(call => call.action === 'recordContentEffect').length), 0);
    assert.deepEqual(await page.evaluate(() => ContentEffects.fields()), {});

    const other = await context.newPage(); await other.goto(origin + '/standalone.html');
    await other.evaluate(() => localStorage.setItem('chu-effects-disabled', 'true'));
    await page.waitForFunction(() => !document.getElementById('content-effects-choice').checked);
    await page.reload(); await setup(page);
    assert.equal(await choice.isChecked(), false, 'saved opt-out survives reload');
    await setup(other);
    const standalone = other.locator('#content-effects-choice');
    assert.equal(await standalone.getAttribute('type'), 'button');
    assert.equal(await standalone.isVisible(), true, 'independent content pages retain an accessible control');
    await standalone.click();
    await page.waitForFunction(() => document.getElementById('content-effects-choice').checked);

    const privateContext = await browser.newContext();
    await privateContext.route('https://**/*', route => route.abort());
    await privateContext.addInitScript(() => {
      Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true });
      localStorage.setItem('chu-effects-disabled', 'false');
    });
    const privatePage = await privateContext.newPage();
    await privatePage.goto(origin + '/index.html'); await setup(privatePage);
    const locked = privatePage.locator('#content-effects-choice');
    assert.equal(await locked.isChecked(), false); assert.equal(await locked.isDisabled(), true);
    assert.match(await privatePage.locator('#content-effects-description').textContent(), /浏览器.*统计保持关闭/);
    await locked.evaluate(input => { input.checked = true; input.dispatchEvent(new Event('change')); });
    assert.equal(await locked.isChecked(), false);
    await privatePage.evaluate(() => ContentEffects.open('blocked', { kind: 'route', mode: 'walk', minutes: 60, stops: '1' }));
    assert.equal(await privatePage.evaluate(() => effectCalls.length), 0, 'GPC cannot be overridden by checkbox');
    assert.equal(await privatePage.evaluate(() => localStorage.getItem('chu-effects-disabled')), 'false', 'GPC does not rewrite user preference');
    assert.deepEqual(errors, []);
    await privateContext.close(); await context.close();
    console.log('Content preference UI passed: real disclosure, repeated configure, unchanged form fields/defaults, reset/reload persistence, cleared associations and delayed events, cross-tab changes, standalone control, GPC priority.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
