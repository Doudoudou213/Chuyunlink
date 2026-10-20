'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const vm = require('node:vm'), http = require('node:http'), https = require('node:https'), crypto = require('node:crypto');
const {createRequire} = require('node:module');
const preview = require('./lib/exploration-journey-question-preview');
const {createExplorationQuestionService, evidence} = require('../cloudfunctions/appCore/domains/exploration-questions');
const E = require('../cloudfunctions/appCore/lib/exploration-core');
const root = path.resolve(__dirname, '..');
const question = (objectId = 'object_tower', text = '画稿里有什么？') =>
  ({resourceId:'r', objectId, question:text, requestId:crypto.randomUUID()});

async function dispatchBoundary() {
  // Execute the exact account guard and dispatch branches, with a service spy.
  // This deliberately avoids SDK initialization and unrelated application data.
  const source = fs.readFileSync(path.join(root, 'cloudfunctions/appCore/index.js'), 'utf8');
  const guard = source.slice(source.indexOf('function requireStableAccount('), source.indexOf('\nfunction firstDocument('));
  const mainStart = source.indexOf('exports.main =');
  const authentication = source.slice(source.indexOf('    const uid = cleanText(userInfo.uid, 128);', mainStart),
    source.indexOf("    if (require('./domains/site-walk-sessions')", mainStart));
  const branches = source.slice(source.indexOf("    if (action === 'getSiteExplorationQuestionContext')"),
    source.indexOf("    if (action === 'recognizeSiteExploration')"));
  assert(guard && branches.includes("requireStableAccount(userInfo)"));
  const calls = [], context = {db:{}, cleanText:(value, count) => String(value || '').slice(0, count),
    require:name => {
      assert.equal(name, './domains/exploration-questions');
      return {createExplorationQuestionService:() => ({
        context:async event => {calls.push('context');return {objectId:event.objectId};},
        ask:async (event, uid) => {calls.push('ask');return {objectId:event.objectId, uid};}
      })};
    }};
  vm.createContext(context);
  vm.runInContext(guard + '\nthis.dispatch=async function(event,userInfo){userInfo=userInfo||{};\n' + authentication + branches + '\n};', context);
  assert.equal((await context.dispatch({action:'getSiteExplorationQuestionContext', objectId:'object_tower'}, {uid:'anon', loginType:'ANONYMOUS'})).objectId, 'object_tower');
  for (const action of ['getSiteExplorationQuestionContext', 'askSiteExploration'])
    for (const account of [null, {}])
      assert.equal((await context.dispatch({action}, account)).error.code, 'UNAUTHENTICATED');
  for (const account of [{uid:'anon', loginType:'ANONYMOUS'}, {uid:'anon', loginType:'anonymous'}])
    await assert.rejects(context.dispatch({action:'askSiteExploration'}, account), {code:'STABLE_ACCOUNT_REQUIRED'});
  assert.equal((await context.dispatch({action:'askSiteExploration', objectId:'object_tower'}, {uid:'member', loginType:'PASSWORD'})).uid, 'member');
  assert.deepEqual(calls, ['context', 'ask']);
}

async function serviceBoundaries() {
  const f = await preview.fixture(), publicWalk = await E.get(f.db, 'r');
  const contexts = [];
  const before = JSON.stringify(f.db.data());
  for (const object of publicWalk.map.objects) {
    const c = await f.questions.context({resourceId:'r', objectId:object.id});
    const item = await evidence(f.db, 'r', object.id);
    assert.equal(c.ok, true);assert.equal(c.ready, true);assert.equal(c.reason, 'ready');
    assert.equal(c.objectId, object.id);assert.equal(c.resourceId, 'r');
    assert.equal(c.title, publicWalk.walk.points.find(point => point.id === object.pointId).title);
    assert.equal(c.fingerprint, item.fingerprint);
    assert.notEqual(c.fingerprint, publicWalk.walk.fingerprint);
    assert.deepEqual(c.sources, item.sources);
    assert.equal(c.introduction, item.pieces.slice(0, 3).map(piece => piece.text).join(''));
    assert.equal(c.simulated, undefined, 'Production service must not mark actual data simulated');
    contexts.push(c);
  }
  assert.equal(new Set(contexts.map(context => context.fingerprint)).size, 4);
  assert.deepEqual(f.calls, {answer:0, verify:0});
  assert.equal(JSON.stringify(f.db.data()), before, 'Public context may not reserve quota or mutate data');
  assert(!JSON.stringify(contexts).includes('private-user'));
  assert(contexts.every(context => !context.sources[0].url), 'Community sources need not invent an external URL');
  for (const event of [{resourceId:'r', objectId:'tower'}, {resourceId:'r', objectId:'missing'},
    {resourceId:'wrong', objectId:'object_tower'}, {resourceId:'r', objectId:'../object_tower'}, {resourceId:'r'}])
    await assert.rejects(f.questions.context(event));
  assert.deepEqual(f.calls, {answer:0, verify:0});
  for (const context of contexts) {
    const answer = await f.questions.ask(question(context.objectId), 'local-reader');
    assert.equal(answer.outcome, 'answer');assert.equal(answer.objectId, context.objectId);
    assert.equal(answer.fingerprint, context.fingerprint);assert.equal(answer.simulated, undefined);
    assert.equal(answer.text, context.introduction);
    assert(answer.sentences.every(sentence => sentence.sourceIds.every(id => answer.sources.some(source => source.id === id))));
  }
  assert.deepEqual(f.calls, {answer:4, verify:4});
  const unknown = await f.questions.ask(question('object_tower', '这里是否有一个尚无记录的新历史事实？'), 'local-reader');
  assert.equal(unknown.outcome, 'insufficient');assert.deepEqual(unknown.sentences, []);assert.deepEqual(unknown.sources, []);
  const calls = {...f.calls};
  for (const text of ['今天门票多少？', '从这里往左怎么走？', '今天几点开放？']) {
    assert.equal((await f.questions.ask(question('object_tower', text), 'local-reader')).outcome, 'practical');
    assert.deepEqual(f.calls, calls);
  }
  await assert.rejects(f.questions.ask(question(), ''), {code:'UNAUTHENTICATED'});
  for (const bad of [{question:''}, {question:'字'.repeat(401)}, {requestId:'short'}, {history:['字'.repeat(401)]}])
    await assert.rejects(f.questions.ask({...question(), ...bad}, 'local-reader'), {code:'QA_INPUT'});
  const diagnostics = JSON.stringify(f.db.data().guide_question_usage);
  assert(!diagnostics.includes('画稿里有什么') && !diagnostics.includes('local-reader') && !diagnostics.includes(contexts[0].introduction));
  const off = createExplorationQuestionService({db:f.db, config:{...f.config, mode:'off'}, client:{run(){throw Error('No provider for an off service');}}});
  assert.equal((await off.context({resourceId:'r', objectId:'object_tower'})).reason, 'off');
  assert.equal((await off.ask(question(), 'local-reader')).outcome, 'off');
  const servicePath = path.join(root, 'cloudfunctions/appCore/domains/exploration-questions.js');
  const load = createRequire(servicePath), sandbox = {module:{exports:{}}, process:{env:{}}, Buffer};
  sandbox.require = name => name === '../lib/guide-question-client' ?
    {...load(name), configFromEnv:() => ({...f.config, mode:'real'})} : load(name);
  vm.runInNewContext(fs.readFileSync(servicePath, 'utf8'), sandbox);
  const defaultOff = sandbox.module.exports.createExplorationQuestionService({db:f.db, client:{run(){throw Error('Independent switch is off');}}});
  assert.equal((await defaultOff.context({resourceId:'r', objectId:'object_tower'})).ready, false);
  assert.equal((await defaultOff.ask(question(), 'local-reader')).outcome, 'off');
  const noFunds = createExplorationQuestionService({db:f.db, config:{...f.config, budgetCny:0}, client:f.client});
  assert.equal((await noFunds.context({resourceId:'r', objectId:'object_tower'})).ready, false);
  assert.equal((await noFunds.ask(question('object_tower', '这一处先看哪里？'), 'new-user')).outcome, 'limited');
  await f.db.collection('submissions').doc('s').update({aiAnalysisConsent:false});
  const withdrawn = await f.questions.context({resourceId:'r', objectId:'object_tower'});
  assert.equal(withdrawn.ready, false);assert.equal(withdrawn.reason, 'insufficient');
  assert.notEqual(withdrawn.fingerprint, contexts[0].fingerprint);assert.deepEqual(withdrawn.sources, []);
  const currentCalls = {...f.calls};
  assert.equal((await f.questions.ask(question(), 'local-reader')).outcome, 'insufficient');
  assert.deepEqual(f.calls, currentCalls);
  for (const stage of ['answer', 'verify']) {
    const changed = await preview.fixture(), run = changed.client.run;
    changed.client.run = async (kind, payload) => {
      const result = await run(kind, payload);
      if (kind === stage) await changed.db.collection('submissions').doc('s').update({aiConsentRevokedAt:'test-only'});
      return result;
    };
    assert.equal((await changed.questions.ask(question(), 'local-reader')).outcome, 'source');
  }
}

function request(base, pathname, options = {}) {
  const url = new URL(base), content = options.body === undefined ? '' :
    typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = http.request({hostname:'127.0.0.1', port:url.port, path:pathname, method:options.method || 'GET',
      headers:{...(content ? {'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(content)} : {}), ...options.headers}}, res => {
      const chunks = [];res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status:res.statusCode, headers:res.headers, text:Buffer.concat(chunks).toString('utf8')}));
      res.on('error', reject);
    });
    req.on('error', reject);req.end(content);
  });
}

async function previewBoundaries() {
  await assert.rejects(preview.start(-1));
  await assert.rejects(preview.start(0, {fixture:{db:{}}}), /本机假数据库/);
  const template = fs.readFileSync(path.join(root, 'explore-journey.html'), 'utf8');
  await assert.rejects(preview.start(0, {html:template.replace('<!-- journey-local-adapter -->', '')}), /注入点/);
  await assert.rejects(preview.start(0, {html:template.replace('<script defer src="static/guide-cloud.js"></script>', '')}), /注入点/);
  const server = await preview.start(0);
  try {
    const url = server.url, page = await request(url, '/explore-journey.html?resourceId=r');
    assert.equal(page.status, 200);assert(page.text.includes('本机固定响应样例'));assert(page.text.includes('不上传问题'));
    assert(!page.text.includes('static/guide-cloud.js'));
    assert(!page.text.includes('cloudbase.net'));
    const code = [...page.text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
    assert.equal(code.length, 1);
    const hash = crypto.createHash('sha256').update(code[0]).digest('base64');
    const csp = page.headers['content-security-policy'];
    assert(csp.includes("'sha256-" + hash + "'"));
    assert(csp.includes("connect-src 'self'"));assert(csp.includes("frame-ancestors 'none'"));
    assert(!/script-src[^;]*(?:unsafe-inline|unsafe-eval|https:|\*)/.test(csp));
    assert.equal(page.headers['cache-control'], 'no-store');assert.equal(page.headers['referrer-policy'], 'no-referrer');
    const token = /const token="([a-f0-9]{48})"/.exec(code[0])?.[1];
    assert(token);
    const call = async event => {
      const r = await request(url, '/__question-local', {method:'POST', headers:{'x-preview-token':token}, body:event});
      return {...r, value:JSON.parse(r.text)};
    };
    const get = await call({action:'getSiteExploration', resourceId:'r'});
    assert.equal(get.status, 200);assert.equal(get.value.localTest, true);
    assert.deepEqual(get.value.journeyQuestions, {schemaVersion:1, mode:'local-fixed', resourceId:'r'});
    assert.equal(get.value.editorialInquiries, undefined);
    assert.notEqual(get.value.walk.simulated, true, 'This is a business-fixture contract, not an editorial draft');
    const object = get.value.map.objects[0];
    const c = (await call({action:'getSiteExplorationQuestionContext', resourceId:'r', objectId:object.id})).value;
    assert.equal(c.simulated, true);assert.equal(c.ready, true);assert.equal(c.objectId, object.id);
    assert.notEqual(c.fingerprint, get.value.walk.fingerprint);
    const answer = (await call({action:'askSiteExploration', ...question(object.id)})).value;
    assert.equal(answer.outcome, 'answer');assert.equal(answer.simulated, true);
    assert.equal(answer.fingerprint, c.fingerprint);assert.equal(answer.text, c.introduction);
    assert.equal((await call({action:'askSiteExploration', ...question(object.id, '这里什么时候修建？')})).value.outcome, 'insufficient');
    assert.equal((await call({action:'askSiteExploration', ...question(object.id, '门票多少？')})).value.outcome, 'practical');
    assert.equal((await call({action:'getSiteExplorationQuestionContext', resourceId:'r', objectId:object.pointId})).value.error.code, 'QA_SOURCE');
    assert.equal((await call({action:'askSiteExploration', ...question(object.id, '')})).value.error.code, 'QA_INPUT');
    for (const action of ['getSiteWalk', 'getGuideQuestionContext', 'createSiteWalkSession', 'publishSiteWalk', 'whoami', '__proto__'])
      assert.equal((await call({action, resourceId:'r'})).value.error.code, 'LOCAL_ACTION');
    assert.equal((await call({action:'getSiteExploration', resourceId:'other'})).value.error.code, 'LOCAL_RESOURCE');
    assert.equal((await call({action:'getSiteExploration', resourceId:'r', apiKey:'not-accepted'})).value.error.code, 'LOCAL_INPUT');
    assert.equal((await request(url, '/__question-local')).status, 405);
    assert.equal((await request(url, '/__question-local', {method:'HEAD'})).status, 405);
    assert.equal((await request(url, '/__question-local', {method:'POST', body:{action:'getSiteExploration', resourceId:'r'}})).status, 403);
    assert.equal((await request(url, '/__question-local', {method:'POST', headers:{'x-preview-token':'wrong'}, body:{}})).status, 403);
    assert.equal((await request(url, '/__question-local', {method:'POST', headers:{'x-preview-token':token, Origin:'https://untrusted.invalid'}, body:{}})).status, 403);
    assert.equal((await request(url, '/__question-local', {method:'POST', headers:{'x-preview-token':token}, body:'{bad'})).status, 400);
    assert.equal((await request(url, '/__question-local', {method:'POST', headers:{'x-preview-token':token, 'Content-Type':'text/plain'}, body:'{}'})).status, 415);
    assert.equal((await request(url, '/__question-local', {method:'POST', headers:{'x-preview-token':token}, body:'x'.repeat(16385)})).status, 413);
    assert.equal((await request(url, '/explore-journey.html?resourceId=r', {headers:{Host:'untrusted.invalid'}})).status, 421);
    assert.equal((await request(url, '/')).headers.location, '/explore-journey.html?resourceId=r');
    assert.equal((await request(url, '/explore-journey.html?resourceId=other')).status, 302);
    assert.equal((await request(url, '/explore-journey.html?resourceId=r', {method:'HEAD'})).text, '');
    for (const pathname of ['/admin.html', '/explore-admin.html', '/static/guide-cloud.js', '/static/cloudbase-app.js',
      '/cloudfunctions/appCore/index.js', '/tools/fixtures/four-scenes-study.json', '/.env', '/__scenario', '/__admin'])
      assert.equal((await request(url, pathname)).status, 404, pathname);
    assert.equal((await request(url, '/__scenario', {method:'POST', headers:{'x-preview-token':token}, body:{kind:'reset'}})).status, 405);
    for (const pathname of ['/../package.json', '/%2e%2e/package.json', '/static/%00file.js', '/static%5cguide-cloud.js'])
      assert.equal((await request(url, pathname)).status, 400, pathname);
    for (const asset of new Set([...page.text.matchAll(/(?:src|href)="(static\/[^"?#]+)"/g)].map(match => '/' + match[1])))
      assert.equal((await request(url, asset)).status, 200, 'Missing visitor dependency ' + asset);
    for (const asset of ['paper-fibres-soft-v1.webp', 'longcang-editorial-v1.woff2', 'exploration-motion/hhl-full-park-v2.webp'])
      assert.equal((await request(url, '/static/assets/' + asset)).status, 200);
    // Force a service refusal in this fake process, not through a browser-facing
    // administration route. Error codes must survive the local transport.
    server.fixture.config.userDailyRequests = 0;
    assert.equal((await call({action:'getSiteExplorationQuestionContext', resourceId:'r', objectId:object.id})).value.ready, false);
    assert.equal((await call({action:'askSiteExploration', ...question(object.id, '这一处先看哪里？')})).value.error.code, 'QA_LIMIT');
  } finally {await server.close();}
  // The 4221 study adapter remains GET/HEAD-only and gains no QA endpoint.
  const editorial = require('./lib/exploration-four-scenes-preview');
  const study = await editorial.start(0);
  try {
    assert.equal((await request(study.url, '/__question-local', {method:'POST', body:{}})).status, 405);
    const page = await request(study.url, '/four-scenes.html?resourceId=hhl-four-scenes-study');
    assert(!page.text.includes('/__question-local'));
  } finally {await study.close();}
}

async function main() {
  const originalRequest = https.request;
  https.request = () => {throw Error('Tests must never connect to a provider or any HTTPS service');};
  try {
    await dispatchBoundary();await serviceBoundaries();await previewBoundaries();
    console.log('PASS journey question service: scoped public context, true object/evidence identity, stable-account guard, default-off/consent/budget gates, exact fixed answers and citations, withdrawal, private-data exclusion, localhost/CSP/token/body/path isolation, and unchanged read-only study preview. No browser, cloud or provider calls.');
  } finally {https.request = originalRequest;}
}
module.exports = {main};
if (require.main === module) main().catch(error => {console.error(error);process.exitCode = 1;});
