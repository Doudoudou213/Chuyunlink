'use strict';
// Fresh local browser only. These are unpublished editorial excerpts, not AI
// answers, historical review, field navigation, cloud writes or award eligibility.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const preview = require('./lib/exploration-four-scenes-preview');
const draft = require('./fixtures/four-scenes-study.json');
const inquiries = require('./fixtures/four-scenes-inquiries.json');
const output = path.resolve(__dirname, '../artifacts/exploration-journey-live/inquiry');
const resourceId = 'hhl-four-scenes-study';
let checks = 0;
function check(value, name) {assert(value, name);checks++;}
const expectedPoint = id => draft.points.find(point => point.id === id);
const expectedQuestions = id => inquiries.points.find(point => point.pointId === id).questions;
const expectedParagraphs = (id, question) => question.paragraphs.map(item => expectedPoint(id).paragraphs[item.index]);
const expectedSources = (id, question) => [...new Set(question.paragraphs.flatMap(item => item.sourceIndexes))]
  .map(index => expectedPoint(id).sources[index].url);

(async () => {
  const server = await preview.start();
  let browser;
  const errors = [], requests = [], external = [];
  const url = server.url + '/four-scenes.html?resourceId=' + resourceId;
  const html = await (await fetch(url)).text();
  const apiPath = html.match(/fetch\(["'](\/__[\w-]+)["']/)?.[1];
  check(Boolean(apiPath), 'inquiry uses an inspectable local read endpoint');
  const apiPattern = '**' + apiPath;
  async function page(options = {}) {
    const p = await browser.newPage({viewport:{width:390, height:900}, reducedMotion:'reduce', ...options});
    p.on('pageerror', error => errors.push(error.message));
    p.on('request', request => requests.push({url:request.url(), method:request.method()}));
    await p.route('**/*', route => {
      const value = route.request().url();
      if (!value.startsWith(server.url + '/') && !value.startsWith('data:')) {
        external.push(value);
        return route.abort();
      }
      return route.continue();
    });
    return p;
  }
  const go = async (p, id = 'tower') => {
    await p.goto(url + '&pointId=' + id, {waitUntil:'domcontentloaded'});
    await p.locator('#content:not([hidden])').waitFor();
  };
  const opened = p => p.locator('#journey-leaf-dialog[open][data-state=open][aria-busy=false]').waitFor();
  const open = async p => {await p.locator('#reading > .journey-leaf-trigger').click();await opened(p);};
  const close = async p => {await p.locator('.journey-leaf-close').click();await p.locator('#journey-leaf-dialog').waitFor({state:'hidden'});};
  const select = async (p, id) => {await p.locator('[data-stop=' + id + ']').click();await opened(p);};
  const entry = p => p.locator('#journey-inquiry-entry');
  const options = p => p.locator('#journey-inquiry-options button[data-question]');
  const questionButton = (p, id) => p.locator('#journey-inquiry-options button[data-question="' + id + '"]');
  const reads = () => requests.filter(request => request.url.startsWith(server.url + apiPath)).length;
  const storage = p => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])));
  async function ask(p) {
    await entry(p).click();
    await p.locator('#journey-inquiry-panel:not([hidden])').waitFor();
    await options(p).first().waitFor({state:'visible'});
  }
  async function answered(p, id, question, native = false) {
    const paragraphs = expectedParagraphs(id, question);
    await p.waitForFunction(expected => {
      const root = document.getElementById('journey-inquiry-answer');
      return root && !root.hidden &&
        JSON.stringify([...root.querySelectorAll(':scope > p')].map(node => node.textContent)) === JSON.stringify(expected);
    }, paragraphs);
    check(await questionButton(p, question.id).getAttribute('aria-pressed') === 'true', id + ' selection is announced: ' + question.id);
    const actual = await p.locator('#journey-inquiry-answer > p').allTextContents();
    check(JSON.stringify(actual) === JSON.stringify(paragraphs), id + ' answer uses only the exact existing selected paragraphs: ' + question.id);
    const links = await p.locator('#journey-inquiry-sources a').evaluateAll(nodes => nodes.map(node => node.href));
    check(JSON.stringify(links) === JSON.stringify(expectedSources(id, question)), id + ' answer has exactly its own paragraph sources: ' + question.id);
    check(await p.locator('#journey-inquiry-sources a').evaluateAll(nodes => nodes.every(node =>
      node.protocol === 'https:' && node.target === '_blank' && node.rel.includes('noopener'))),
    id + ' source links use safe public navigation: ' + question.id);
    check(await p.locator('#journey-inquiry-sources li').evaluateAll(nodes => nodes.every(node =>
      [...node.querySelectorAll('p')].some(paragraph => paragraph.textContent.trim()))),
      id + ' source provenance accompanies every link: ' + question.id);
    check(await p.locator('dialog[open]').count() === (native ? 0 : 1), id + ' asks within the existing reading surface: ' + question.id);
    check(await p.locator('#journey-reading-main').isHidden(), id + ' original reading is visually retired while asking: ' + question.id);
    check(await p.locator('[data-recorded=true]').count() === 0, id + ' asking records no observation or reward: ' + question.id);
  }
  async function choose(p, id, question, native = false) {
    await questionButton(p, question.id).click();
    await answered(p, id, question, native);
  }
  async function back(p) {
    await p.locator('#journey-inquiry-back').click();
    await p.locator('#journey-reading-main').waitFor({state:'visible'});
    await p.locator('#journey-inquiry-panel').waitFor({state:'hidden'});
  }
  async function cleared(p, label) {
    check(await p.locator('#journey-inquiry-answer').textContent() === '', label + ' clears excerpt DOM');
    check(await p.locator('#journey-inquiry-sources').textContent() === '', label + ' clears cited-source DOM');
  }
  async function holdRead(p) {
    let release, captured, finished;
    const wait = new Promise(resolve => {release = resolve;});
    const seen = new Promise(resolve => {captured = resolve;});
    const done = new Promise(resolve => {finished = resolve;});
    const handler = async route => {
      try {
        const response = await route.fetch();
        captured();
        await wait;
        await route.fulfill({response});
      } catch (error) {
        if (!p.isClosed()) throw error;
      } finally {finished();}
    };
    await p.route(apiPattern, handler);
    return {captured:seen, release, clear:async () => {await done;await p.unroute(apiPattern, handler);}};
  }
  async function mutation(p, change) {
    const handler = route => {
      const value = preview.response();
      change(value);
      return route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(value)});
    };
    await p.route(apiPattern, handler);
    return () => p.unroute(apiPattern, handler);
  }
  async function checkTarget(p, selector, label) {
    const node = p.locator(selector);
    await node.scrollIntoViewIfNeeded();
    check(await node.evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.width >= 44 && box.height >= 44 && box.left >= 0 && box.right <= innerWidth + 1;
    }), label + ' has a reachable 44px target: ' + selector);
  }
  try {
    browser = await chromium.launch({channel:'msedge', headless:true});
    fs.mkdirSync(output, {recursive:true});
    check(preview.response().localTest === true, 'questions are served only as local editorial capabilities');
    check(inquiries.mode === 'editorial-excerpts' && inquiries.publishAllowed === false, 'questions are excerpts, not publishable model output');

    const p = await page();
    await go(p);
    check(await entry(p).isHidden(), 'inquiry does not add a new action to the closed main canvas');
    await open(p);
    check(await p.locator('#journey-inquiry-panel').isHidden(), 'reading opens without a question panel');
    check((await entry(p).textContent()).includes('问这一景'), 'one quiet entry offers current-scene questions');
    for (const point of draft.points) {
      if (point.id !== 'tower') {await close(p);await select(p, point.id);}
      const beforeStorage = await storage(p);
      await entry(p).scrollIntoViewIfNeeded();
      const originalScroll = await p.locator('#journey-leaf-body').evaluate(node => node.scrollTop);
      const originalHistory = await p.evaluate(() => history.length);
      const beforeReads = reads();
      await ask(p);
      check(reads() > beforeReads, point.id + ' entry rechecks current authority');
      check(await p.evaluate(() => history.length) === originalHistory, point.id + ' inquiry does not add another dialog history entry');
      check(await options(p).count() === 2, point.id + ' has only two contextual questions');
      check(JSON.stringify(await options(p).allTextContents()) === JSON.stringify(expectedQuestions(point.id).map(question => question.label)),
        point.id + ' offers only its own two authored questions');
      check(await p.locator('#journey-inquiry input,#journey-inquiry textarea,#journey-inquiry form').count() === 0,
        point.id + ' does not pretend to offer unrestricted AI chat');
      for (const question of expectedQuestions(point.id)) {
        const previousReads = reads();
        await choose(p, point.id, question);
        check(reads() > previousReads, point.id + ' each answer repeats current content verification');
        check(await p.locator('#journey-inquiry-options button[aria-pressed=true]').count() === 1,
        point.id + ' selection never accumulates across question choices');
        check(await p.locator('#reading-copy').textContent() === point.paragraphs.join('\n\n'), point.id + ' excerpting does not rewrite hidden original text');
      }
      check(JSON.stringify(await storage(p)) === JSON.stringify(beforeStorage), point.id + ' inquiry writes no local content, question history or telemetry');
      await back(p);
      await cleared(p, point.id + ' return to original');
      check(await p.evaluate(() => document.activeElement.id) === 'journey-inquiry-entry', point.id + ' return restores entry focus');
      check(Math.abs(await p.locator('#journey-leaf-body').evaluate(node => node.scrollTop) - originalScroll) <= 3,
        point.id + ' return restores original reading scroll position');
      check(await p.locator('#reading-copy').textContent() === point.paragraphs.join('\n\n'), point.id + ' return restores exact original reading');
    }
    await close(p);
    await select(p, 'tower');
    await ask(p);
    await choose(p, 'tower', expectedQuestions('tower')[0]);
    await p.locator('#journey-leaf-next').click();
    await p.waitForFunction(() => document.querySelector('#point-title').textContent === '古铜顶');
    await opened(p);
    check(await p.locator('#journey-inquiry-panel').isHidden(), 'next scene returns to normal reading');
    await cleared(p, 'next scene');
    await ask(p);
    check(JSON.stringify(await options(p).allTextContents()) === JSON.stringify(expectedQuestions('copper').map(question => question.label)),
      'next scene cannot inherit prior questions');
    await choose(p, 'copper', expectedQuestions('copper')[1]);
    await close(p);
    await cleared(p, 'closed leaf');
    await open(p);
    check(await p.locator('#journey-inquiry-panel').isHidden(), 'reopening a paper never revives an old answer');
    await p.close();

    for (const viewport of [
      {width:320, height:900}, {width:390, height:900}, {width:768, height:900},
      {width:1440, height:900}, {width:667, height:320}
    ]) {
      const q = await page({viewport});
      await go(q, 'pond');
      await open(q);
      await q.evaluate(() => document.fonts.ready);
      await q.locator('#reading-size').click();
      await q.waitForFunction(() => document.body.dataset.readingSize === 'large');
      await checkTarget(q, '#journey-inquiry-entry', viewport.width + 'px entry');
      await ask(q);
      check(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth), viewport.width + 'px document has no overflow');
      check(await q.locator('#journey-leaf-body').evaluate(node => node.scrollWidth <= node.clientWidth + 1),
        viewport.width + 'px question leaf has no overflow');
      for (const question of expectedQuestions('pond')) {
        await checkTarget(q, '#journey-inquiry-options button[data-question="' + question.id + '"]', viewport.width + 'px question');
      }
      await q.screenshot({path:path.join(output, 'questions-' + viewport.width + 'x' + viewport.height + '.png')});
      const question = expectedQuestions('pond')[1];
      await questionButton(q, question.id).focus();
      await q.keyboard.press('Enter');
      await answered(q, 'pond', question);
      check(await q.locator('#journey-inquiry-answer > p').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 21),
        viewport.width + 'px answer inherits large reading preference');
      check(await q.locator('#journey-leaf-body').evaluate(node => node.scrollWidth <= node.clientWidth + 1),
        viewport.width + 'px long answer and provenance wrap');
      await checkTarget(q, '#journey-inquiry-back', viewport.width + 'px back');
      await checkTarget(q, '.journey-leaf-close', viewport.width + 'px close');
      await q.locator('#journey-inquiry-answer').scrollIntoViewIfNeeded();
      await q.screenshot({path:path.join(output, 'answer-' + viewport.width + 'x' + viewport.height + '.png')});
      await q.locator('#journey-inquiry-back').focus();
      await q.keyboard.press('Space');
      await q.locator('#journey-reading-main').waitFor({state:'visible'});
      check(await q.evaluate(() => document.activeElement.id) === 'journey-inquiry-entry', viewport.width + 'px keyboard returns to entry');
      await q.keyboard.press('Enter');
      await q.locator('#journey-inquiry-panel:not([hidden])').waitFor();
      await q.keyboard.press('Escape');
      await q.locator('#journey-leaf-dialog').waitFor({state:'hidden'});
      check(await q.evaluate(() => !document.activeElement.closest('dialog')), viewport.width + 'px Escape restores external focus');
      await cleared(q, viewport.width + 'px Escape');
      await q.close();
    }

    // Every verification boundary is cancelable. Synthetic visibility is used;
    // this is not a claim about Safari or a physical device's background policy.
    for (const kind of ['entry-close', 'answer-close', 'answer-back', 'answer-background']) {
      const q = await page();
      await go(q, 'pond');
      await open(q);
      if (kind !== 'entry-close') await ask(q);
      const held = await holdRead(q);
      try {
        if (kind === 'entry-close') await entry(q).click();
        else await questionButton(q, expectedQuestions('pond')[0].id).click();
        await held.captured;
        check(await q.locator('#journey-inquiry-answer').textContent() === '', kind + ' does not expose a cached answer while checking');
        if (kind === 'answer-back') await back(q);
        else if (kind === 'answer-background') {
          await q.evaluate(() => {
            Object.defineProperty(document, 'hidden', {configurable:true, value:true});
            document.dispatchEvent(new Event('visibilitychange'));
          });
          await q.locator('#journey-leaf-dialog').waitFor({state:'hidden'});
        } else {
          await q.keyboard.press('Escape');
          await q.locator('#journey-leaf-dialog').waitFor({state:'hidden'});
        }
        held.release();
        await held.clear();
        await q.waitForTimeout(100);
        await cleared(q, kind + ' late response');
        check(await q.locator('#journey-inquiry-panel').isHidden(), kind + ' late response cannot restore the question panel');
        if (kind === 'answer-background') {
          await q.evaluate(() => {
            Object.defineProperty(document, 'hidden', {configurable:true, value:false});
            document.dispatchEvent(new Event('visibilitychange'));
          });
          await q.locator('#content:not([hidden])').waitFor();
        }
        if (kind !== 'answer-back') check(await q.locator('#journey-leaf-dialog').isHidden(), kind + ' late response cannot reopen paper');
        check(await q.locator('[data-recorded=true]').count() === 0, kind + ' records no observation');
      } finally {held.release();await q.close();}
    }

    // An unanswered request cannot flash the previous question's excerpt.
    const slow = await page();
    await go(slow, 'copper');await open(slow);await ask(slow);
    await choose(slow, 'copper', expectedQuestions('copper')[0]);
    const held = await holdRead(slow);
    try {
      const second = expectedQuestions('copper')[1];
      await questionButton(slow, second.id).click();
      await held.captured;
      await cleared(slow, 'pending replacement question');
      check((await slow.locator('#journey-inquiry-status').textContent()).trim().length > 0,
        'pending question has a readable status rather than a blank busy screen');
      held.release();await held.clear();
      await answered(slow, 'copper', second);
    } finally {held.release();await slow.close();}

    const switched = await page();
    await go(switched, 'copper');await open(switched);await ask(switched);
    let releaseOld, sawOld, oldDone, delayed = false;
    const oldWait = new Promise(resolve => {releaseOld = resolve;});
    const oldSeen = new Promise(resolve => {sawOld = resolve;});
    const oldFinished = new Promise(resolve => {oldDone = resolve;});
    const delayedFirst = async route => {
      if (delayed) return route.continue();
      delayed = true;
      try {
        const response = await route.fetch();sawOld();await oldWait;await route.fulfill({response});
      } finally {oldDone();}
    };
    await switched.route(apiPattern, delayedFirst);
    try {
      await questionButton(switched, expectedQuestions('copper')[0].id).click();
      await oldSeen;
      await choose(switched, 'copper', expectedQuestions('copper')[1]);
      releaseOld();await oldFinished;await switched.waitForTimeout(100);
      await answered(switched, 'copper', expectedQuestions('copper')[1]);
      check(await questionButton(switched, expectedQuestions('copper')[0].id).getAttribute('aria-pressed') === 'false',
        'late older question never replaces the newer selected answer');
    } finally {releaseOld();await switched.close();}

    // Controller-level authority is shared by overlapping UI requests. A late
    // older success or failure must not roll back a newer accepted capability.
    for (const kind of ['older-capability', 'older-failure']) {
      const q = await page();await go(q, 'pond');await open(q);await ask(q);
      const oldValue = preview.response(), freshValue = preview.response();
      const freshLabel = '鹅池的日常照料，资料里怎样说？';
      freshValue.editorialInquiries.revision = 'c'.repeat(64);
      freshValue.editorialInquiries.points.find(point => point.pointId === 'pond').questions[1].label = freshLabel;
      let releaseA, capturedA, completedA, first = true;
      const pendingA = new Promise(resolve => {releaseA = resolve;});
      const seenA = new Promise(resolve => {capturedA = resolve;});
      const finishedA = new Promise(resolve => {completedA = resolve;});
      await q.route(apiPattern, async route => {
        if (!first) return route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(freshValue)});
        first = false;capturedA();
        try {
          await pendingA;
          if (kind === 'older-failure') return await route.abort('failed');
          return await route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(oldValue)});
        } finally {completedA();}
      });
      try {
        await questionButton(q, expectedQuestions('pond')[0].id).click();
        await seenA;
        await questionButton(q, expectedQuestions('pond')[1].id).click();
        await q.waitForFunction(() => /更新|变化|重选|重新/.test(document.querySelector('#journey-inquiry-status').textContent));
        await cleared(q, kind + ' newer capability is adopted before the older request');
        check(await questionButton(q, expectedQuestions('pond')[1].id).textContent() === freshLabel,
          kind + ' uses the newer response while request A is still pending');
        await choose(q, 'pond', expectedQuestions('pond')[1]);
        releaseA();await finishedA;await q.waitForTimeout(100);
        check(await q.locator('#gate').isHidden(), kind + ' cannot gate valid newer accepted reading');
        check(await q.locator('#journey-leaf-dialog').isVisible(), kind + ' cannot close the newer accepted reading leaf');
        check(await questionButton(q, expectedQuestions('pond')[1].id).textContent() === freshLabel,
          kind + ' cannot roll question labels back to the older capability');
        check(await q.locator('#journey-inquiry-answer').isVisible(), kind + ' cannot erase the newer selected excerpt');
        check(JSON.stringify(await q.locator('#journey-inquiry-answer > p').allTextContents()) ===
          JSON.stringify(expectedParagraphs('pond', expectedQuestions('pond')[1])),
        kind + ' leaves the latest verified answer intact');
        check(await questionButton(q, expectedQuestions('pond')[1].id).getAttribute('aria-pressed') === 'true',
          kind + ' preserves the latest explicitly selected question');
        check(await q.locator('[data-recorded=true]').count() === 0, kind + ' cannot create an observation');
      } finally {releaseA();await q.close();}
    }

    for (const kind of ['withdraw', 'version']) {
      const q = await page();await go(q, 'baiyun');await open(q);await ask(q);
      await choose(q, 'baiyun', expectedQuestions('baiyun')[0]);
      await mutation(q, value => {
        if (kind === 'withdraw') {value.available = false;value.reason = '本地测试资料撤回';}
        else {value.walk.version++;value.walk.fingerprint += '-inquiry-test-version';}
      });
      await questionButton(q, expectedQuestions('baiyun')[1].id).click();
      await q.locator('#retry:not([hidden])').waitFor();
      check(await q.locator('#journey-leaf-dialog').isHidden(), kind + ' closes the unverified answer paper');
      await cleared(q, kind);
      check(await q.locator('#reading-copy').textContent() === '', kind + ' clears stale source prose too');
      await q.close();
    }

    // Capability changes are separate from the existing chapter fingerprint.
    // Re-select from fresh questions; never reuse a formerly valid answer map.
    const revised = await page();await go(revised, 'pond');await open(revised);await ask(revised);
    await choose(revised, 'pond', expectedQuestions('pond')[0]);
    const oldFingerprint = preview.response().walk.fingerprint;
    await mutation(revised, value => {
      value.editorialInquiries.revision = 'a'.repeat(64);
      value.editorialInquiries.points.find(point => point.pointId === 'pond').questions[1].label = '鹅池的日常照料，资料里怎样说？';
    });
    await questionButton(revised, expectedQuestions('pond')[1].id).click();
    await revised.waitForFunction(() => /更新|变化|重选|重新/.test(document.querySelector('#journey-inquiry-status').textContent));
    await cleared(revised, 'changed inquiry capability with unchanged walk');
    check(await revised.locator('#journey-leaf-dialog').isVisible(), 'question-map update need not discard the unchanged reading leaf');
    check(await questionButton(revised, expectedQuestions('pond')[1].id).textContent() === '鹅池的日常照料，资料里怎样说？',
      'updated question labels replace old choices');
    check(preview.response().walk.fingerprint === oldFingerprint, 'test changed only question capability, not chapter fingerprint');
    await choose(revised, 'pond', expectedQuestions('pond')[1]);
    await revised.close();

    const revisionOnly = await page();await go(revisionOnly, 'pond');await open(revisionOnly);await ask(revisionOnly);
    await choose(revisionOnly, 'pond', expectedQuestions('pond')[0]);
    await mutation(revisionOnly, value => {value.editorialInquiries.revision = 'b'.repeat(64);});
    await questionButton(revisionOnly, expectedQuestions('pond')[1].id).click();
    await revisionOnly.waitForFunction(() => /更新|变化|重选|重新/.test(document.querySelector('#journey-inquiry-status').textContent));
    await cleared(revisionOnly, 'revision-only capability update');
    check(JSON.stringify(await options(revisionOnly).allTextContents()) === JSON.stringify(expectedQuestions('pond').map(question => question.label)),
      'revision-only update preserves the latest matching question labels');
    check(await revisionOnly.locator('#journey-inquiry-options button[aria-pressed=true]').count() === 0,
      'revision-only update still requires explicit fresh selection');
    await choose(revisionOnly, 'pond', expectedQuestions('pond')[1]);
    await revisionOnly.close();

    const removed = await page();await go(removed, 'pond');await open(removed);await ask(removed);
    await choose(removed, 'pond', expectedQuestions('pond')[0]);
    await mutation(removed, value => {delete value.editorialInquiries;});
    await questionButton(removed, expectedQuestions('pond')[1].id).click();
    await removed.locator('#journey-inquiry').waitFor({state:'hidden'});
    await cleared(removed, 'removed optional capability');
    check(await removed.locator('#journey-reading-main').isVisible(), 'removing question capability returns to still-valid prose');
    check(await removed.locator('#journey-leaf-dialog').isVisible(), 'optional capability removal need not discard valid reading');
    await removed.close();

    for (const kind of ['no-capability', 'non-local', 'bad-resource', 'bad-paragraph', 'bad-source', 'cross-scene', 'unsafe-source']) {
      const q = await page();
      await mutation(q, value => {
        const point = value.editorialInquiries.points.find(point => point.pointId === 'pond');
        if (kind === 'no-capability') delete value.editorialInquiries;
        if (kind === 'non-local') value.localTest = false;
        if (kind === 'bad-resource') value.editorialInquiries.resourceId = 'different-local-study';
        if (kind === 'bad-paragraph') point.questions[0].paragraphs[0].index = 999;
        if (kind === 'bad-source') point.questions[0].paragraphs[0].sourceIndexes = [999];
        if (kind === 'cross-scene') point.pointId = 'tower';
        if (kind === 'unsafe-source') value.walk.points.find(point => point.id === 'pond').sources[0].url = 'javascript:alert("not-executed")';
      });
      await go(q, 'pond');
      await open(q);
      check(await entry(q).isHidden(), kind + ' cannot expose an unsupported question entry');
      check(await q.locator('#reading-copy').textContent() === expectedPoint('pond').paragraphs.join('\n\n'),
        kind + ' does not break otherwise valid source reading');
      await cleared(q, kind);
      check(await q.locator('#journey-inquiry-sources a').count() === 0, kind + ' leaves no unsafe or mismatched citation');
      await q.close();
    }

    for (const missing of ['exploration-journey-inquiry.js', 'exploration-journey-inquiry-data.js']) {
      const q = await page();
      await q.route('**/' + missing, route => route.abort());
      await go(q, 'pond');await open(q);
      check(await entry(q).isHidden(), missing + ' leaves no dead entry');
      check(await q.locator('#reading-copy').textContent() === expectedPoint('pond').paragraphs.join('\n\n'), missing + ' retains exact ordinary reading');
      check(await q.locator('#journey-leaf-next').isEnabled(), missing + ' preserves ordinary continuation');
      await q.close();
    }
    const fallback = await page();
    await fallback.route('**/exploration-journey-leaves.js', route => route.abort());
    await go(fallback, 'pond');
    await fallback.locator('#reading > summary').click();
    await fallback.waitForFunction(() => document.getElementById('reading').open);
    check(await fallback.locator('#reading-copy').isVisible(), 'native details fallback still shows current prose');
    check(await fallback.locator('#reading-copy').textContent() === expectedPoint('pond').paragraphs.join('\n\n'), 'native fallback does not replace the source chapter');
    check(await entry(fallback).isVisible(), 'native details fallback also offers contextual inquiry');
    await entry(fallback).scrollIntoViewIfNeeded();
    const nativeScroll = await fallback.evaluate(() => scrollY);
    await ask(fallback);await choose(fallback, 'pond', expectedQuestions('pond')[0], true);await back(fallback);
    check(await fallback.locator('#reading-copy').isVisible(), 'native fallback inquiry can return to original prose');
    check(await fallback.evaluate(() => document.activeElement.id) === 'journey-inquiry-entry', 'native return restores entry focus');
    check(Math.abs(await fallback.evaluate(() => scrollY) - nativeScroll) <= 3, 'native return restores window reading position');
    check(await fallback.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'native details fallback fits mobile width');
    await ask(fallback);
    const nativeHeld = await holdRead(fallback);
    try {
      await questionButton(fallback, expectedQuestions('pond')[1].id).click();
      await nativeHeld.captured;
      await fallback.locator('#reading > summary').click();
      await fallback.waitForFunction(() => !document.getElementById('reading').open);
      nativeHeld.release();await nativeHeld.clear();await fallback.waitForTimeout(100);
      await cleared(fallback, 'native collapse during question verification');
      check(await fallback.locator('#journey-inquiry-panel').isHidden(), 'native collapse cancels question state');
      await fallback.locator('#reading > summary').click();
      await fallback.waitForFunction(() => document.getElementById('reading').open);
      check(await fallback.locator('#reading-copy').isVisible(), 'native reopen starts with original prose');
    } finally {nativeHeld.release();}
    await ask(fallback);await choose(fallback, 'pond', expectedQuestions('pond')[0], true);
    await mutation(fallback, value => {delete value.editorialInquiries;});
    await questionButton(fallback, expectedQuestions('pond')[1].id).click();
    await fallback.locator('#journey-inquiry').waitFor({state:'hidden'});
    await cleared(fallback, 'native capability removal');
    check(await fallback.evaluate(() => document.activeElement === document.querySelector('#reading > summary')),
      'native capability removal restores focus to its still-visible reading summary');
    check(await fallback.locator('#reading-copy').isVisible(), 'native capability removal preserves otherwise valid original reading');
    check(await fallback.locator('dialog[open]').count() === 0, 'native capability removal does not create a replacement modal');
    await fallback.close();

    const animated = await page({reducedMotion:'no-preference'});
    await go(animated, 'tower');await open(animated);await ask(animated);
    await choose(animated, 'tower', expectedQuestions('tower')[0]);
    check(await animated.locator('#journey-leaf-dialog').getAttribute('data-state') === 'open', 'asking does not replay or nest the whole page-opening motion');
    await animated.emulateMedia({reducedMotion:'reduce'});
    await back(animated);
    check(await animated.locator('#journey-reading-main').isVisible(), 'reduced motion returns directly to readable original content');
    await animated.close();

    check(external.length === 0, 'no external requests: ' + external.join('; '));
    check(requests.every(request => request.method === 'GET'), 'inquiry browser performs only same-origin reads');
    check(errors.length === 0, 'no uncaught page errors: ' + errors.join('; '));
    console.log('PASS journey inquiry browser: ' + checks + ' checks; eight source-bound excerpts, same-leaf return, cancellation, capability changes, fallbacks, keyboard and five viewport screenshots. ' + output);
  } finally {if (browser) await browser.close();await server.close();}
})().catch(error => {console.error(error);process.exitCode = 1;});
