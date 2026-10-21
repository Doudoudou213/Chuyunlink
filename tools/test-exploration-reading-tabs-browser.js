'use strict';
// The existing local fixture only: no account, paid model or production writes.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {start} = require('./lib/exploration-journey-preview');
let checks = 0;
function check(value, label) {assert(value, label);checks++;}
(async () => {
  const server = await start();
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({channel:'msedge',headless:true});
    const page = await browser.newPage({viewport:{width:390,height:844}});
    page.on('pageerror', error => errors.push(error.message));
    const ready = async id => page.locator('#journey-leaf-dialog[open][data-leaf="'+id+'"][aria-busy=false][data-state=open]').waitFor();
    const open = async () => {await page.locator('#reading > .journey-leaf-trigger').click();await ready('reading');};
    const close = async () => {await page.locator('.journey-leaf-close').click();await page.locator('#journey-leaf-dialog').waitFor({state:'hidden'});};
    await page.goto(server.url+'/explore-journey.html?resourceId=r');
    await page.locator('#content:not([hidden])').waitFor();
    const before = await page.evaluate(() => history.length);
    await open();
    check(await page.evaluate(() => history.length) === before + 1, 'opening creates one modal history entry');
    check(await page.locator('#journey-leaf-tab-reading').getAttribute('aria-pressed') === 'true', 'current reading control is announced');
    check(await page.locator('#journey-leaf-tab-sources').getAttribute('aria-pressed') === 'false', 'source control is not current');
    // Deliberately long local layout text, not a replacement for reviewed source content.
    await page.locator('#reading-copy').evaluate(el => {window.__tabOriginalCopy = el.textContent;el.textContent = '本地滚动测试，不是历史讲解。'.repeat(90);});
    const top = await page.locator('#journey-leaf-body').evaluate(el => {el.scrollTop=250;return el.scrollTop;});
    check(top > 0, 'fixture has a meaningful reading position');
    for (let i=0; i<3; i++) {
      await page.locator('#journey-leaf-tab-sources').click();await ready('sources');
      check(await page.locator('#source-list').isVisible(), 'sources share the original paper '+i);
      check(await page.locator('#reading-copy').isHidden(), 'inactive reading content is not visible '+i);
      check(await page.locator('#journey-leaf-next').isHidden(), 'source page has no misleading next-scene action '+i);
      check(await page.locator('#audio').count() === 1, 'no duplicate audio element '+i);
      await page.locator('#journey-leaf-tab-reading').click();await ready('reading');
      check(await page.locator('#journey-leaf-body').evaluate(el => el.scrollTop) === top, 'return keeps reading position '+i);
      check(await page.locator('#journey-leaf-next').isEnabled(), 'reading continuation restored '+i);
    }
    check(await page.evaluate(() => history.length) === before + 1, 'internal switching adds no history entries');
    check(await page.locator('dialog[open]').count() === 1, 'never stacks dialogs');
    await page.locator('#reading-copy').evaluate(el => {el.textContent=window.__tabOriginalCopy;});
    await page.locator('#journey-leaf-tab-sources').click();await ready('sources');
    await close();
    check(await page.locator('#reading > .journey-leaf-trigger').evaluate(el => document.activeElement === el), 'close from source returns to original reading opener');
    await open();
    check(await page.locator('#journey-leaf-body').evaluate(el => el.scrollTop) === 0, 'new paper does not retain old scroll');
    await page.locator('#journey-leaf-tab-sources').click();await ready('sources');
    await page.evaluate(() => history.back());
    await page.locator('#journey-leaf-dialog').waitFor({state:'hidden'});
    check(new URL(page.url()).pathname === '/explore-journey.html', 'one Back leaves source view and stays in the visitor page');

    // Pending source verification hides old content and cannot reopen after close.
    await open();
    let release, capture;
    const blocked = new Promise(resolve => {release=resolve;});
    const captured = new Promise(resolve => {capture=resolve;});
    await page.route('**/__journey', async route => {const response=await route.fetch();capture();await blocked;await route.fulfill({response});});
    await page.locator('#journey-leaf-tab-sources').click();await captured;
    check(await page.locator('#reading-copy').isHidden() && await page.locator('#source-list').isHidden(), 'both views withheld while revalidating');
    check(await page.locator('#journey-leaf-tab-reading').isDisabled(), 'switch disabled while pending');
    await close();release();await page.waitForTimeout(200);await page.unroute('**/__journey');
    check(await page.locator('#journey-leaf-dialog').isHidden(), 'late source result cannot reopen');

    // A source revoked between the two views must close the whole paper.
    await open();
    const control = await browser.newPage();await control.goto(server.url+'/preview-control.html');
    await control.locator('[data-kind=withdraw]').click();await control.waitForFunction(() => document.querySelector('#result').textContent.includes('已完成'));
    await page.locator('#journey-leaf-tab-sources').click();await page.locator('#retry:not([hidden])').waitFor();
    check(await page.locator('#journey-leaf-dialog').isHidden(), 'withdrawal blocks internal source switch');
    check(await page.locator('#source-list').textContent() === '' && await page.locator('#reading-copy').textContent() === '', 'withdrawal erases both source and reading');
    check(errors.length === 0, errors.join('\n'));
    console.log('PASS reading paper tabs: '+checks+' checks; scroll/history/focus/audio/verification/withdrawal.');
  } finally {await browser?.close();await server.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
