'use strict';
// Fresh browser + isolated fixed-response server only. These checks do not call
// a real model or approve historical content, identity, field routes or rewards.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const preview = require('./lib/exploration-journey-question-preview');
const editorialPreview = require('./lib/exploration-four-scenes-preview');
const output = path.resolve(__dirname, '../artifacts/exploration-journey-live/question');
const apiPath = '/__question-local';
const apiPattern = '**' + apiPath;
const question = '画稿里有什么？';
let checks = 0;
function check(value, name) {assert(value, name);checks++;}
function event(request) {
  try {return request.postDataJSON();} catch {return null;}
}

(async () => {
  const server = await preview.start(0);
  let browser, editorial;
  const origins = new Set([server.url]), errors = [], external = [], network = [];
  const records = new WeakMap();
  const url = server.url + '/explore-journey.html?resourceId=r';
  async function page(options = {}) {
    const p = await browser.newPage({viewport:{width:390, height:900}, reducedMotion:'reduce', ...options});
    const record = {calls:[], responses:[], jobs:[]};
    records.set(p, record);
    p.on('pageerror', error => errors.push(error.message));
    p.on('request', request => {
      const data = event(request);
      network.push({url:request.url(), method:request.method(), action:data?.action});
      if (request.url().startsWith(server.url + apiPath)) record.calls.push(data);
    });
    p.on('response', response => {
      if (!response.url().startsWith(server.url + apiPath)) return;
      const data = event(response.request());
      const job = response.json().then(value => record.responses.push({event:data, value})).catch(() => {});
      record.jobs.push(job);
    });
    await p.route('**/*', route => {
      const value = route.request().url();
      if (![...origins].some(origin => value.startsWith(origin + '/')) && !value.startsWith('data:')) {
        external.push(value);return route.abort();
      }
      return route.continue();
    });
    return p;
  }
  const calls = (p, action) => records.get(p).calls.filter(value => value?.action === action);
  const asks = p => calls(p, 'askSiteExploration');
  const opened = p => p.locator('#journey-leaf-dialog[open][data-state=open][aria-busy=false]').waitFor();
  const openReading = async p => {await p.locator('#reading > .journey-leaf-trigger').click();await opened(p);};
  const closeReading = async p => {await p.locator('.journey-leaf-close').click();await p.locator('#journey-leaf-dialog').waitFor({state:'hidden'});};
  const entry = p => p.locator('#journey-question-entry');
  const go = async (p, point = 'pond') => {
    await p.goto(url + '&pointId=' + point, {waitUntil:'domcontentloaded'});
    await p.locator('#content:not([hidden])').waitFor();
  };
  const storage = p => p.evaluate(() => ({
    local:Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])),
    session:Object.fromEntries(Object.keys(sessionStorage).sort().map(key => [key, sessionStorage.getItem(key)]))
  }));
  async function latest(p, action) {
    await Promise.all(records.get(p).jobs);
    return records.get(p).responses.filter(item => item.event?.action === action).at(-1)?.value;
  }
  async function openQuestion(p) {
    await entry(p).click();
    await p.locator('#journey-question-panel:not([hidden])').waitFor();
    await p.waitForFunction(() => document.getElementById('journey-question-form').getAttribute('aria-busy') === 'false');
  }
  async function ready(p) {
    await p.waitForFunction(() => !document.getElementById('journey-question-send').disabled);
  }
  async function back(p) {
    await p.locator('#journey-question-back').click();
    await p.locator('#journey-question-panel').waitFor({state:'hidden'});
    await p.locator('#journey-reading-main').waitFor({state:'visible'});
  }
  async function cleared(p, label) {
    check(await p.locator('#journey-question-answer').textContent() === '', label + ' clears answer DOM');
    check(await p.locator('#journey-question-sources').textContent() === '', label + ' clears source DOM');
  }
  async function answered(p, label = 'fixed answer', native = false) {
    await p.locator('#journey-question-answer:not([hidden]) > p').first().waitFor();
    const result = await latest(p, 'askSiteExploration'), context = await latest(p, 'getSiteExplorationQuestionContext');
    check(result?.outcome === 'answer' && result.simulated === true, label + ' is explicitly a local simulated response');
    check(context?.simulated === true && context.ready === true, label + ' uses the explicitly ready local context');
    check(JSON.stringify(await p.locator('#journey-question-answer > p').allTextContents()) === JSON.stringify(result.sentences.map(sentence => sentence.text)),
      label + ' renders exactly the checked response sentences');
    check(result.objectId === context.objectId && result.fingerprint === context.fingerprint && result.resourceId === context.resourceId,
      label + ' belongs to the current object and independent evidence fingerprint');
    check((await p.locator('#journey-question-answer').textContent()).includes('本地固定响应'),
      label + ' never claims fixed output is a real model result');
    check(await p.locator('#journey-question-sources li').count() === result.sources.length, label + ' shows only the cited sources');
    const used = new Set(result.sentences.flatMap(sentence => sentence.sourceIds));
    check(result.sources.every(source => used.has(source.id) && context.sources.some(item => item.id === source.id)),
      label + ' every rendered source is used and belongs to current context');
    const links = await p.locator('#journey-question-sources a').evaluateAll(nodes => nodes.map(node => node.href));
    check(JSON.stringify(links) === JSON.stringify(result.sources.filter(source => source.url).map(source => new URL(source.url).href)),
      label + ' source links match the verified response, without fabricated fallback URLs');
    check(await p.locator('#journey-question-sources a').evaluateAll(nodes => nodes.every(node =>
      node.protocol === 'https:' && node.target === '_blank' && node.rel.includes('noopener'))), label + ' citation links are safe');
    check(await p.locator('dialog[open]').count() === (native ? 0 : 1), label + ' stays in the same reading surface');
    check(await p.locator('[data-recorded=true]').count() === 0, label + ' is not a recorded visit or award');
  }
  async function send(p, value = question) {
    await ready(p);await p.locator('#journey-question-input').fill(value);await p.locator('#journey-question-send').click();
    await p.waitForFunction(() => document.getElementById('journey-question-form').getAttribute('aria-busy') === 'false');
  }
  async function intercept(p, handler) {
    const routeHandler = async route => {
      const data = event(route.request());
      if (!data) return route.continue();
      return handler(route, data);
    };
    await p.route(apiPattern, routeHandler);
    return () => p.unroute(apiPattern, routeHandler);
  }
  async function mutate(p, action, change) {
    return intercept(p, async (route, data) => {
      if (data.action !== action) return route.continue();
      const response = await route.fetch(), value = await response.json();
      change(value, data);
      return route.fulfill({response, json:value});
    });
  }
  async function hold(p, action) {
    let release, captured, finished;
    const waiting = new Promise(resolve => {release = resolve;});
    const seen = new Promise(resolve => {captured = resolve;});
    const done = new Promise(resolve => {finished = resolve;});
    const remove = await intercept(p, async (route, data) => {
      if (data.action !== action) return route.continue();
      try {
        const response = await route.fetch();captured();
        await waiting;await route.fulfill({response});
      } finally {finished();}
    });
    return {captured:seen, release, clear:async () => {await done;await remove();}};
  }
  async function target(p, selector, label) {
    const node = p.locator(selector);await node.scrollIntoViewIfNeeded();
    check(await node.evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.width >= 44 && box.height >= 44 && box.left >= 0 && box.right <= innerWidth + 1;
    }), label + ' has a reachable 44px target: ' + selector);
  }
  try {
    browser = await chromium.launch({channel:'msedge', headless:true});
    fs.mkdirSync(output, {recursive:true});
    const p = await page();await go(p);await openReading(p);
    const originalText = await p.locator('#reading-copy').textContent();
    check(asks(p).length === 0, 'reading alone never sends a question');
    check(await p.locator('#journey-inquiry-entry').isHidden(), 'fixed free-question sample does not mix in the research excerpt entry');
    await entry(p).scrollIntoViewIfNeeded();
    const scroll = await p.locator('#journey-leaf-body').evaluate(node => node.scrollTop);
    const history = await p.evaluate(() => window.history.length), beforeStorage = await storage(p);
    await openQuestion(p);await ready(p);
    check(await p.evaluate(() => window.history.length) === history, 'question panel creates no extra modal history entry');
    check(asks(p).length === 0, 'opening the question panel only loads context');
    check(calls(p, 'getSiteExplorationQuestionContext').at(-1).objectId === 'object_pond', 'context uses the map object ID, never the point ID');
    const context = await latest(p, 'getSiteExplorationQuestionContext'), walk = await latest(p, 'getSiteExploration');
    check(context.fingerprint !== walk.walk.fingerprint, 'question evidence fingerprint is distinct from the reading walk fingerprint');
    check((await p.locator('#journey-question-notice').textContent()).includes('本地固定响应'), 'local model boundary is visible before typing');
    check(await p.locator('#journey-question-input').getAttribute('maxlength') === '400', 'question input has a visible 400-character contract');
    check((await p.locator('#journey-question-input').getAttribute('aria-describedby'))?.includes('privacy'), 'question input describes privacy before sending');
    await p.locator('#journey-question-input').fill(question);
    check(asks(p).length === 0, 'typing is not an implicit submission');
    await p.locator('#journey-question-form').evaluate(form => {
      const input = form.querySelector('textarea');input.value = '';
      form.dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));
    });
    check(asks(p).length === 0, 'blank synthetic submit cannot send a request');
    await p.locator('#journey-question-form').evaluate(form => {
      const input = form.querySelector('textarea');input.value = '测'.repeat(401);
      input.dispatchEvent(new Event('input', {bubbles:true}));
      form.dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));
    });
    check(asks(p).length === 0, 'programmatic overlength input cannot bypass the send guard');
    check((await p.locator('#journey-question-status').textContent()).includes('400'), 'overlength input explains the limit');
    const callsBefore = records.get(p).calls.length;
    await send(p);await answered(p);
    const sent = asks(p).at(-1), sequence = records.get(p).calls.slice(callsBefore).map(value => value.action);
    check(sent.resourceId === 'r' && sent.objectId === 'object_pond', 'question is bound to the current actual map object');
    check(sent.question === question && typeof sent.requestId === 'string' && sent.requestId.length > 10, 'explicit question has one request ticket');
    check(Array.isArray(sent.history) && sent.history.length === 0, 'question sends no conversation history');
    const askIndex = sequence.indexOf('askSiteExploration');
    check(sequence.slice(0, askIndex).includes('getSiteExploration') && sequence.slice(0, askIndex).includes('getSiteExplorationQuestionContext'),
      'send rechecks reading authority and question context before requesting an answer');
    check(sequence.slice(askIndex + 1).includes('getSiteExploration') && sequence.slice(askIndex + 1).includes('getSiteExplorationQuestionContext'),
      'response is rechecked against reading and evidence before rendering');
    check(JSON.stringify(await storage(p)) === JSON.stringify(beforeStorage), 'asking stores no question, answer, history or telemetry locally');
    await back(p);await cleared(p, 'return to original reading');
    check(await p.evaluate(() => document.activeElement.id) === 'journey-question-entry', 'return restores the question entry focus');
    check(Math.abs(await p.locator('#journey-leaf-body').evaluate(node => node.scrollTop) - scroll) <= 3, 'return restores original reading scroll');
    check(await p.locator('#reading-copy').textContent() === originalText, 'question never rewrites the chapter');
    await p.close();

    for (const viewport of [
      {width:320, height:900}, {width:390, height:900}, {width:768, height:900},
      {width:1440, height:900}, {width:667, height:320}
    ]) {
      const q = await page({viewport});await go(q);await openReading(q);
      await q.evaluate(() => document.fonts.ready);
      await q.locator('#reading-size').click();
      await q.waitForFunction(() => document.body.dataset.readingSize === 'large');
      await target(q, '#journey-question-entry', String(viewport.width));
      await openQuestion(q);await ready(q);
      for (const selector of ['#journey-question-input', '#journey-question-send', '#journey-question-back', '.journey-leaf-close']) await target(q, selector, String(viewport.width));
      check(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth), viewport.width + ' document has no horizontal overflow');
      check(await q.locator('#journey-leaf-body').evaluate(node => node.scrollWidth <= node.clientWidth + 1), viewport.width + ' form fits the paper');
      await q.locator('#journey-question-input').scrollIntoViewIfNeeded();
      await q.screenshot({path:path.join(output, 'form-' + viewport.width + 'x' + viewport.height + '.png')});
      await q.locator('#journey-question-input').fill(question);
      await q.locator('#journey-question-send').focus();await q.keyboard.press('Enter');
      await answered(q, viewport.width + ' keyboard answer');
      check(await q.locator('#journey-question-answer > p').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 21),
        viewport.width + ' answer inherits large-reading preference');
      check(await q.locator('#journey-leaf-body').evaluate(node => node.scrollWidth <= node.clientWidth + 1), viewport.width + ' answer and citations wrap');
      await q.locator('#journey-question-answer').scrollIntoViewIfNeeded();
      await q.screenshot({path:path.join(output, 'answer-' + viewport.width + 'x' + viewport.height + '.png')});
      await q.locator('#journey-question-sources').scrollIntoViewIfNeeded();
      await q.screenshot({path:path.join(output, 'sources-' + viewport.width + 'x' + viewport.height + '.png')});
      await q.locator('#journey-question-back').focus();await q.keyboard.press('Space');
      await q.locator('#journey-reading-main').waitFor({state:'visible'});
      check(await q.evaluate(() => document.activeElement.id) === 'journey-question-entry', viewport.width + ' keyboard back restores entry focus');
      await q.keyboard.press('Enter');await ready(q);await q.keyboard.press('Escape');
      await q.locator('#journey-leaf-dialog').waitFor({state:'hidden'});
      await cleared(q, viewport.width + ' Escape');
      check(await q.evaluate(() => !document.activeElement.closest('dialog')), viewport.width + ' Escape restores external focus');
      await q.close();
    }

    // Unknown historical questions and practical/current information are
    // explicit non-answers, never a guess or an automatically generated route.
    for (const [value, outcome] of [['这处建筑是谁亲手设计的？', 'insufficient'], ['今天门票多少钱，几点开门？', 'practical']]) {
      const q = await page();await go(q);await openReading(q);await openQuestion(q);await send(q, value);
      const result = await latest(q, 'askSiteExploration');
      check(result.outcome === outcome && result.simulated === true, outcome + ' comes from the local fixed-response service');
      await cleared(q, outcome);
      check((await q.locator('#journey-question-status').textContent()).trim().length > 0, outcome + ' has a readable non-answer');
      check(await q.locator('#journey-question-retry').isHidden(), outcome + ' does not offer a blind automatic/model retry');
      check(await q.locator('[data-recorded=true]').count() === 0, outcome + ' records no visit');
      await q.close();
    }

    const duplicate = await page();await go(duplicate);await openReading(duplicate);await openQuestion(duplicate);await ready(duplicate);
    await duplicate.locator('#journey-question-input').fill(question);
    const pendingDuplicate = await hold(duplicate, 'askSiteExploration');
    const beforeDuplicate = asks(duplicate).length;
    try {
      await duplicate.locator('#journey-question-form').evaluate(form => {
        form.dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));
        form.dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));
      });
      await pendingDuplicate.captured;
      check(asks(duplicate).length === beforeDuplicate + 1, 'double submit starts only one question request');
      check(await duplicate.locator('#journey-question-send').isDisabled(), 'pending question disables duplicate send');
      check(await duplicate.locator('#journey-question-input').evaluate(node => node.readOnly), 'pending question preserves the submitted wording');
      await cleared(duplicate, 'pending initial question');
      pendingDuplicate.release();await pendingDuplicate.clear();await answered(duplicate, 'single double-click response');
    } finally {pendingDuplicate.release();await duplicate.close();}

    const retry = await page();await go(retry);await openReading(retry);await openQuestion(retry);
    let firstFailure = true;
    const removeFailure = await intercept(retry, (route, data) => {
      if (data.action === 'askSiteExploration' && firstFailure) {firstFailure = false;return route.abort('failed');}
      return route.continue();
    });
    await send(retry);
    await retry.locator('#journey-question-retry:not([hidden])').waitFor();
    const failedTicket = asks(retry).at(-1).requestId, failures = asks(retry).length;
    await retry.waitForTimeout(300);
    check(asks(retry).length === failures, 'transport failure does not automatically retry a possibly costly request');
    await cleared(retry, 'failed request');
    await retry.locator('#journey-question-retry').click();await answered(retry, 'explicit same-ticket retry');
    check(asks(retry).at(-1).requestId === failedTicket, 'explicit retry reuses the failed request ID');
    await removeFailure();await retry.close();

    for (const kind of ['coded-duplicate', 'legacy-duplicate', 'busy']) {
      const q = await page();await go(q);await openReading(q);await openQuestion(q);
      let rejectFirst = true;
      await intercept(q, (route, data) => {
        if (data.action !== 'askSiteExploration' || !rejectFirst) return route.continue();
        rejectFirst = false;
        const error = kind === 'coded-duplicate' ? {code:'QA_DUPLICATE', message:'本机重复请求测试'} :
          kind === 'legacy-duplicate' ? {message:'这次问题已处理或正在处理，请稍后重新提问'} :
          {code:'QA_BUSY', message:'上一条问题还在处理中'};
        return route.fulfill({status:400, contentType:'application/json', json:{ok:false, error}});
      });
      await send(q);
      const priorId = asks(q).at(-1).requestId, count = asks(q).length;
      await q.waitForTimeout(300);
      check(asks(q).length === count, kind + ' never automatically sends another request');
      await cleared(q, kind + ' rejected ticket');
      if (kind === 'busy') {
        check(await q.locator('#journey-question-retry').isVisible(), 'busy response offers an explicit same-ticket retry');
        check(!(await q.locator('#journey-question-send').textContent()).includes('重新提问'), 'busy response does not imply a new charged request');
        await q.locator('#journey-question-retry').click();await answered(q, 'busy same-ticket retry');
        check(asks(q).at(-1).requestId === priorId, 'QA_BUSY retry retains the original request ID');
      } else {
        check(await q.locator('#journey-question-retry').isHidden(), kind + ' cannot repeatedly retry a consumed ticket');
        check((await q.locator('#journey-question-send').textContent()).includes('重新提问'), kind + ' clearly labels a separate new request');
        check((await q.locator('#journey-question-status').textContent()).includes('新请求'), kind + ' explains the new-request consequence before clicking');
        await q.locator('#journey-question-send').click();await answered(q, kind + ' explicit new request');
        check(asks(q).at(-1).requestId !== priorId, kind + ' creates a different ticket only after the explicit click');
      }
      check(asks(q).length === count + 1, kind + ' performs exactly one explicit recovery request');
      await q.close();
    }

    const edited = await page();
    await edited.addInitScript(() => {
      const original = window.setInterval.bind(window);
      window.__questionPeriodicChecks = [];
      window.setInterval = function(callback, delay, ...args) {
        if (delay === 30000 && typeof callback === 'function') window.__questionPeriodicChecks.push(() => callback(...args));
        return original(callback, delay, ...args);
      };
    });
    await go(edited);await openReading(edited);await openQuestion(edited);await send(edited);await answered(edited, 'answer before editing');
    const asksBeforeEdit = asks(edited).length;
    await edited.locator('#journey-question-input').fill('我想换一个问题，但还没有发送');
    await cleared(edited, 'editing the question');
    const periodicRead = edited.waitForResponse(response => event(response.request())?.action === 'getSiteExplorationQuestionContext');
    await edited.evaluate(() => window.__questionPeriodicChecks.forEach(callback => callback()));
    await periodicRead;await edited.waitForTimeout(100);
    await cleared(edited, 'periodic context recheck after editing');
    check(asks(edited).length === asksBeforeEdit, 'editing and periodic context verification never implicitly send a replacement question');
    check(await edited.locator('#journey-question-input').inputValue() === '我想换一个问题，但还没有发送', 'periodic recheck preserves the visitor unsent wording');
    await edited.close();

    for (const kind of ['close', 'back', 'next', 'background']) {
      const q = await page();await go(q, 'tower');await openReading(q);await openQuestion(q);await ready(q);
      const pending = await hold(q, 'askSiteExploration');
      try {
        await q.locator('#journey-question-input').fill(question);await q.locator('#journey-question-send').click();await pending.captured;
        if (kind === 'close') await q.keyboard.press('Escape');
        if (kind === 'back') await back(q);
        if (kind === 'next') {await q.locator('#journey-leaf-next').click();await q.waitForFunction(() => document.getElementById('point-title').textContent === '古铜顶');await opened(q);}
        if (kind === 'background') {
          await q.evaluate(() => {
            Object.defineProperty(document, 'hidden', {configurable:true, value:true});
            document.dispatchEvent(new Event('visibilitychange'));
          });
        }
        if (kind === 'close' || kind === 'background') await q.locator('#journey-leaf-dialog').waitFor({state:'hidden'});
        pending.release();await pending.clear();await q.waitForTimeout(100);
        await cleared(q, kind + ' cancels pending answer');
        check(await q.locator('#journey-question-panel').isHidden(), kind + ' cannot revive the old panel');
        if (kind === 'next') check(await q.locator('#point-title').textContent() === '古铜顶', 'late answer cannot return to previous scene');
        if (kind === 'background') {
          await q.evaluate(() => {
            Object.defineProperty(document, 'hidden', {configurable:true, value:false});
            document.dispatchEvent(new Event('visibilitychange'));
          });
          await q.locator('#content:not([hidden])').waitFor();
        }
        check(await q.locator('[data-recorded=true]').count() === 0, kind + ' does not create progress credit');
      } finally {pending.release();await q.close();}
    }

    for (const kind of ['wrong-object', 'walk-fingerprint', 'forged-source-url', 'unknown-source']) {
      const q = await page();await go(q);await openReading(q);await openQuestion(q);
      const reading = await latest(q, 'getSiteExploration');
      await mutate(q, 'askSiteExploration', value => {
        if (kind === 'wrong-object') value.objectId = 'object_tower';
        if (kind === 'walk-fingerprint') value.fingerprint = reading.walk.fingerprint;
        if (kind === 'forged-source-url') value.sources[0].url = 'https://not-the-source.invalid/forged';
        if (kind === 'unknown-source') value.sentences[0].sourceIds = ['not-current-source'];
      });
      await send(q);await cleared(q, kind);
      check(await q.locator('#journey-question-answer').isHidden(), kind + ' cannot render an unbound answer');
      check((await q.locator('#journey-question-status').textContent()).trim().length > 0, kind + ' has a safe failure explanation');
      check(await q.locator('#journey-question-sources a').count() === 0, kind + ' leaves no forged link');
      await q.close();
    }

    for (const kind of ['context-changed-after-send', 'reading-expired-after-send']) {
      const q = await page();await go(q);await openReading(q);await openQuestion(q);
      let sent = false;
      await intercept(q, async (route, data) => {
        const response = await route.fetch(), value = await response.json();
        if (data.action === 'askSiteExploration') sent = true;
        if (sent && kind === 'context-changed-after-send' && data.action === 'getSiteExplorationQuestionContext') value.fingerprint = 'd'.repeat(64);
        if (sent && kind === 'reading-expired-after-send' && data.action === 'getSiteExploration') value.validUntil = new Date(Date.now() - 60000).toISOString();
        return route.fulfill({response, json:value});
      });
      await q.locator('#journey-question-input').fill(question);await q.locator('#journey-question-send').click();
      if (kind === 'reading-expired-after-send') await q.locator('#retry:not([hidden])').waitFor();
      else await q.waitForFunction(() => document.getElementById('journey-question-form').getAttribute('aria-busy') === 'false');
      await cleared(q, kind);
      check(asks(q).length === 1, kind + ' does not issue a replacement question automatically');
      if (kind === 'reading-expired-after-send') check(await q.locator('#journey-leaf-dialog').isHidden(), 'expired reading closes the old answer surface');
      else check((await q.locator('#journey-question-status').textContent()).includes('变化') ||
        (await q.locator('#journey-question-status').textContent()).includes('更新'), 'new evidence asks the visitor to reconsider the question');
      await q.close();
    }

    const switchedIdentity = await page();await go(switchedIdentity);await openReading(switchedIdentity);await openQuestion(switchedIdentity);
    await switchedIdentity.evaluate(() => {window.ExplorationAdapter.identity = async () => 'local-other-reader';});
    await send(switchedIdentity);
    check(asks(switchedIdentity).length === 0, 'identity change before send blocks the question request');
    check((await switchedIdentity.locator('#journey-question-status').textContent()).includes('账号'), 'identity change gives a readable restart instruction');
    await cleared(switchedIdentity, 'changed identity before send');await switchedIdentity.close();
    const identityLate = await page();await go(identityLate);await openReading(identityLate);await openQuestion(identityLate);
    const pendingIdentity = await hold(identityLate, 'askSiteExploration');
    try {
      await identityLate.locator('#journey-question-input').fill(question);await identityLate.locator('#journey-question-send').click();await pendingIdentity.captured;
      await identityLate.evaluate(() => {window.ExplorationAdapter.identity = async () => 'local-other-reader';});
      pendingIdentity.release();await pendingIdentity.clear();
      await identityLate.waitForFunction(() => document.getElementById('journey-question-form').getAttribute('aria-busy') === 'false');
      await cleared(identityLate, 'changed identity after send');
      check((await identityLate.locator('#journey-question-status').textContent()).includes('账号'), 'identity is checked again after receiving the answer');
      check(await identityLate.locator('#journey-question-retry').isHidden(), 'identity switch does not reuse another actor request ticket');
    } finally {pendingIdentity.release();await identityLate.close();}

    for (const kind of ['off', 'guest']) {
      const q = await page();
      if (kind === 'off') await mutate(q, 'getSiteExplorationQuestionContext', value => {value.ready = false;value.reason = 'off';});
      await go(q);await openReading(q);
      if (kind === 'guest') await q.evaluate(() => {window.ExplorationAdapter.identity = async () => 'guest';});
      await openQuestion(q);
      check(await q.locator('#journey-question-send').isDisabled(), kind + ' does not offer an active send button');
      await q.locator('#journey-question-form').evaluate(form => {
        form.querySelector('textarea').value = '画稿里有什么？';
        form.dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));
      });
      await q.waitForFunction(() => document.getElementById('journey-question-form').getAttribute('aria-busy') === 'false');
      check(asks(q).length === 0, kind + ' cannot be bypassed with a programmatic form submission');
      check(await q.locator('#journey-question-refresh').isVisible(), kind + ' offers explicit context recovery');
      if (kind === 'guest') {
        check(await q.locator('#journey-question-login').isVisible(), 'guest is offered an explicit login link');
        check(await q.locator('#journey-question-login').evaluate(node => {
          const address = new URL(node.href);
          return address.origin === location.origin && address.pathname.endsWith('/index.html') && address.searchParams.get('view') === 'profile';
        }), 'login link stays on the existing profile flow rather than creating a new account mechanism');
        await target(q, '#journey-question-login', 'guest recovery');
      }
      await q.close();
    }

    // Exercise the non-adapter identity branch, but preserve the saved local
    // transport. No SDK or real CloudBase request is allowed in these cases.
    for (const kind of ['anonymous-flag', 'anonymous-login-type']) {
      const q = await page();await go(q);await openReading(q);
      await q.evaluate(mode => {
        const localCall = window.ExplorationAdapter.call.bind(window.ExplorationAdapter);
        window.ExploreTransport.call = data => localCall(data);
        delete window.ExplorationAdapter;
        window.__anonymousIdentityChecks = 0;
        window.GuideCloud = {identity:async () => {
          window.__anonymousIdentityChecks++;
          return mode === 'anonymous-flag'
            ? {uid:'local-test-anonymous-with-uid', isAnonymous:true, loginType:'PASSWORD'}
            : {uid:'local-test-anonymous-with-uid', isAnonymous:false, loginType:'cloudbase_ANONYMOUS'};
        }};
      }, kind);
      await openQuestion(q);
      check(await q.evaluate(() => window.__anonymousIdentityChecks > 0 && !window.ExplorationAdapter),
        kind + ' exercises actual identity classification without the local identity adapter');
      check(await q.locator('#journey-question-send').isDisabled(), kind + ' rejects a UID-bearing anonymous session');
      check(await q.locator('#journey-question-login').isVisible(), kind + ' routes the visitor to explicit login');
      await q.locator('#journey-question-form').evaluate(form => {
        form.querySelector('textarea').value = '画稿里有什么？';
        form.dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));
      });
      await q.waitForFunction(() => document.getElementById('journey-question-form').getAttribute('aria-busy') === 'false');
      check(asks(q).length === 0, kind + ' cannot submit an anonymous question by bypassing the disabled button');
      check(calls(q, 'getSiteExplorationQuestionContext').length === 0, kind + ' stops before creating authenticated question context');
      await cleared(q, kind);
      await q.close();
    }

    for (const missing of ['exploration-journey-question.js', 'exploration-journey-question-data.js', 'exploration-journey-question-state.js']) {
      const q = await page();await q.route('**/' + missing, route => route.abort());
      await go(q);await openReading(q);
      check(await entry(q).isHidden(), missing + ' leaves no dead free-question entry');
      check(await q.locator('#reading-copy').isVisible(), missing + ' preserves ordinary reading');
      check(asks(q).length === 0, missing + ' does not fall back to an implicit question');
      await q.close();
    }
    const fallback = await page();await fallback.route('**/exploration-journey-leaves.js', route => route.abort());
    await go(fallback);await fallback.locator('#reading > summary').click();
    await fallback.waitForFunction(() => document.getElementById('reading').open);
    await entry(fallback).scrollIntoViewIfNeeded();const fallbackScroll = await fallback.evaluate(() => scrollY);
    await openQuestion(fallback);await send(fallback);await answered(fallback, 'native details answer', true);
    await back(fallback);
    check(await fallback.evaluate(() => document.activeElement.id) === 'journey-question-entry', 'native return restores question entry focus');
    check(Math.abs(await fallback.evaluate(() => scrollY) - fallbackScroll) <= 3, 'native return restores window scroll');
    check(await fallback.locator('#reading-copy').isVisible(), 'native fallback returns to exact source reading');
    await fallback.close();

    const blockedStorage = await page();
    await blockedStorage.addInitScript(() => {
      for (const name of ['getItem', 'setItem', 'removeItem']) Object.defineProperty(Storage.prototype, name, {
        configurable:true, value() {throw new DOMException('Local test storage blocked', 'SecurityError');}
      });
    });
    await go(blockedStorage);await openReading(blockedStorage);await openQuestion(blockedStorage);
    await send(blockedStorage);await answered(blockedStorage, 'storage-blocked fixed answer');await blockedStorage.close();

    editorial = await editorialPreview.start(0);origins.add(editorial.url);
    const old = await page();
    await old.goto(editorial.url + '/four-scenes.html?resourceId=hhl-four-scenes-study&pointId=pond', {waitUntil:'domcontentloaded'});
    await old.locator('#content:not([hidden])').waitFor();await openReading(old);
    check(await entry(old).isHidden(), 'existing four-scene research sample does not gain free-question capability');
    check(await old.locator('#journey-inquiry-entry').isVisible(), 'existing four-scene excerpt entry remains available');
    check(asks(old).length === 0, 'existing 4221-style sample makes no model-shaped question request');
    await old.close();

    check(external.length === 0, 'all browser connections stay on local fixed-response servers: ' + external.join('; '));
    check(network.every(item => item.method === 'GET' || (item.method === 'POST' &&
      item.url.startsWith(server.url + apiPath) &&
      ['getSiteExploration', 'getSiteExplorationQuestionContext', 'askSiteExploration'].includes(item.action))),
    'only static reads and the three explicitly isolated local actions are requested');
    check(errors.length === 0, 'no uncaught browser errors: ' + errors.join('; '));
    console.log('PASS journey free-question browser: ' + checks + ' checks; local context/identity binding, exact citations, manual same-ticket retry, cancellation, fallbacks, keyboard and five viewport screenshots. ' + output);
  } finally {
    if (browser) await browser.close();
    if (editorial) await editorial.close();
    await server.close();
  }
})().catch(error => {console.error(error);process.exitCode = 1;});
