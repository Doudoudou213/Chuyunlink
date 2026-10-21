'use strict';
// Local editorial disclosures only: no login, cloud calls, writes or publishing.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const four = require('./lib/exploration-four-scenes-preview');
const tower = require('./lib/exploration-tower-study-preview');
const fourDraft = require('./fixtures/four-scenes-study.json');
const towerDraft = require('./fixtures/tower-study.json');
const output = path.resolve(__dirname, '../artifacts/exploration-journey-live/preview-disclosure');
let checks = 0;
function check(value, name) {assert(value, name);checks++;}
const variants = [
  {preview:four, page:'four-scenes', resourceId:'hhl-four-scenes-study', title:'四景叙事审阅样章', draft:fourDraft,
    link:'http://127.0.0.1:4220/tower-study.html?resourceId=hhl-tower-study', linkTitle:'第一阶段主楼样章'},
  {preview:tower, page:'tower-study', resourceId:'hhl-tower-study', title:'主楼讲解审阅样章', draft:towerDraft,
    link:'http://127.0.0.1:4221/four-scenes.html?resourceId=hhl-four-scenes-study', linkTitle:'四景叙事样章'}
];
const viewports = [{width:320,height:844}, {width:390,height:844}, {width:768,height:900}, {width:1440,height:900}];

(async () => {
  let browser;
  const servers = [], errors = [], external = [], requests = [];
  try {
    browser = await chromium.launch({channel:'msedge', headless:true});
    fs.mkdirSync(output, {recursive:true});
    for (const variant of variants) {
      const server = await variant.preview.start();servers.push(server);
      const url = server.url + '/' + variant.page + '.html?resourceId=' + variant.resourceId;
      const response = await fetch(url), html = await response.text();
      const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      const policy = new Map((response.headers.get('content-security-policy') || '').split(';').map(part => {
        const [key,...values] = part.trim().split(/\s+/);return [key, values];
      }));
      check(response.status === 200 && inline.length === 1, variant.page + ': one existing local adapter script');
      const hash = "'sha256-" + crypto.createHash('sha256').update(inline[0][1]).digest('base64') + "'";
      check(policy.get('script-src')?.join(' ') === "'self' " + hash, variant.page + ': disclosure uses exact existing CSP hash, not unsafe-inline');
      check(policy.get('connect-src')?.join(' ') === "'self'", variant.page + ': same-origin connections only');
      check(!html.includes('guide-cloud.js'), variant.page + ': cloud adapter still absent');
      for (const viewport of viewports) {
        const label = variant.page + ' ' + viewport.width;
        const page = await browser.newPage({viewport, reducedMotion:'reduce'});
        page.on('pageerror', error => errors.push(label + ': ' + error.message));
        page.on('request', request => requests.push({url:request.url(), method:request.method()}));
        await page.route('**/*', route => {
          const address = route.request().url();
          if (!address.startsWith(server.url + '/') && !address.startsWith('data:')) {
            external.push(address);return route.abort();
          }
          return route.continue();
        });
        await page.goto(url);await page.locator('#content:not([hidden])').waitFor();
        await page.evaluate(() => document.fonts.ready);
        const details = page.locator('.study-preview-notice details');
        const summary = details.locator('summary');
        const panel = details.locator(':scope > div');
        const open = async () => {await summary.focus();await page.keyboard.press('Enter');check(await details.evaluate(e => e.open), label + ': Enter opens native details');};
        const closed = async () => check(!await details.evaluate(e => e.open), label + ': disclosure closed');
        await closed();
        check(await page.locator('.study-preview-boundary').textContent() === '未审稿，非现场导览', label + ': review boundary remains permanent');
        check(await summary.evaluate(e => {
          const r = e.getBoundingClientRect();return r.width >= 44 && r.height >= 44 && r.left >= 0 && r.right <= innerWidth;
        }), label + ': 44px keyboard/touch trigger fits');
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label + ': closed page has no horizontal overflow');
        check(await page.locator('#painting-help').evaluate(e => {
          const r = e.getBoundingClientRect(), notice = document.querySelector('.study-preview-notice').getBoundingClientRect();
          return r.top >= notice.bottom && r.width > 0 && e.textContent.includes('不');
        }), label + ': art caption stays below the boundary, not underneath it');
        await page.screenshot({path:path.join(output, variant.page + '-closed-' + viewport.width + '.png')});

        await open();
        check(await panel.locator('strong').textContent() === variant.title, label + ': full sample title retained');
        check(await panel.locator('p').textContent() === '仅使用现有画稿；网页核读于' + variant.draft.webReadDate + '，不代表景区认可。录音与现场核对待补。', label + ': all safety and pending-verification text retained');
        check(await panel.locator('a').getAttribute('href') === variant.link && (await panel.locator('a').textContent()).trim() === variant.linkTitle + ' ↗', label + ': original cross-preview link retained');
        check(await panel.evaluate(e => {
          const r = e.getBoundingClientRect(), notice = document.querySelector('.study-preview-notice').getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.top >= notice.bottom - 1 && e.scrollHeight <= e.clientHeight + 1;
        }), label + ': complete disclosure fits viewport without covering its own trigger/boundary');
        check(await panel.evaluate(e => {
          const pane = e.getBoundingClientRect();
          return ['#painting-help','#point-title','#observation','#reading > .journey-leaf-trigger'].every(selector => {
            const target = document.querySelector(selector).getBoundingClientRect();
            return pane.bottom <= target.top || pane.top >= target.bottom || pane.right <= target.left || pane.left >= target.right;
          });
        }), label + ': caption, current scene and main reading action are not covered by the disclosure');
        await panel.locator('strong').click();
        check(await details.evaluate(e => e.open), label + ': clicking inside does not dismiss');
        await summary.focus();await page.keyboard.press('Tab');
        check(await panel.locator('a').evaluate(e => e === document.activeElement), label + ': disclosure link reachable by keyboard');
        await page.screenshot({path:path.join(output, variant.page + '-open-' + viewport.width + '.png')});
        await page.keyboard.press('Escape');await closed();
        check(await summary.evaluate(e => e === document.activeElement), label + ': Esc returns focus to summary');

        await summary.focus();await page.keyboard.press('Space');
        check(await details.evaluate(e => e.open), label + ': Space retains native open behavior');
        await summary.evaluate(e => {
          const event = new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true});
          event.preventDefault();e.dispatchEvent(event);
        });
        check(await details.evaluate(e => e.open), label + ': already handled Escape is not consumed again');
        await page.keyboard.press('Escape');await closed();

        await open();await page.locator('#journey-stage').click({position:{x:10,y:10}});await closed();
        check(!await summary.evaluate(e => e === document.activeElement), label + ': outside pointer close does not steal focus');
        await summary.click();check(await details.evaluate(e => e.open), label + ': click opens once');
        await summary.click();await closed();
        check(await summary.evaluate(e => e === document.activeElement), label + ': summary retains native toggle focus');

        await open();
        const reading = page.locator('#reading > .journey-leaf-trigger');
        await reading.click();
        const leaf = page.locator('#journey-leaf-dialog');
        await page.locator('#journey-leaf-dialog[open][data-state=open][aria-busy=false]').waitFor();
        await closed();
        // Adversarial stacked state: even if a background disclosure is open,
        // Esc belongs to the active modal and must not focus its inert summary.
        await details.evaluate(e => {e.open = true;});
        await page.keyboard.press('Escape');await leaf.waitFor({state:'hidden'});
        check(await details.evaluate(e => e.open), label + ': reading-dialog Esc does not consume background notice');
        check(await reading.evaluate(e => e === document.activeElement), label + ': dialog returns focus to its own trigger');
        check(!await summary.evaluate(e => e === document.activeElement), label + ': modal Esc never steals focus for summary');
        await page.keyboard.press('Escape');await closed();
        check(await summary.evaluate(e => e === document.activeElement), label + ': next Esc closes disclosure after modal has finished');
        await page.close();
      }
    }
    check(external.length === 0, 'no external requests: ' + external.join('; '));
    check(requests.every(request => request.method === 'GET'), 'browser requests stay read-only');
    check(errors.length === 0, 'no uncaught browser errors: ' + errors.join('; '));
    console.log('PASS editorial preview disclosure browser: ' + checks + ' checks; keyboard/outside close, modal ownership, full safety text, 320/390/768/1440 screenshots. ' + output);
  } finally {
    if (browser) await browser.close();
    for (const server of servers) await server.close();
  }
})().catch(error => {console.error(error);process.exitCode = 1;});
