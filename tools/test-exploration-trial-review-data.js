'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const R = require('./lib/exploration-trial-review-data');
const C = require('../static/exploration-journey-content');
let checks = 0;
function check(fn) { fn(); checks++; }
const report = () => ({schemaVersion: 1, kind: 'reading-trial-feedback', localTest: true,
  resourceId: 'r', version: 1, fingerprint: 'fixture-fingerprint-not-only-hex', reading: {recorded: 2, total: 4},
  answers: {start: 'alone', reading: 'mixed', memory: '', obstacle: '想再看一次屋檐'}, scope: R.SCOPE});
const entry = (id, value = report(), excluded = false) => ({id, report: value, excluded});
const parse = value => R.parse(JSON.stringify(value));
function reject(edit) { const value = report(); edit(value); check(() => assert.throws(() => parse(value), /反馈文件无效/)); }
(async function () {
  check(() => assert.deepEqual(parse(report()), report()));
  check(() => assert.deepEqual(R.parse('\uFEFF' + JSON.stringify(report())), report()));
  for (const text of ['', 'null', 'true', '1', '[]', '{', '{"__proto__":{}}', '{"constructor":{}}']) check(() => assert.throws(() => R.parse(text), /反馈文件无效/));
  for (const value of [null, {}, Buffer.from('{}'), 12]) check(() => assert.throws(() => R.parse(value), /反馈文件无效/));
  for (const key of Object.keys(report())) reject(r => { delete r[key]; });
  for (const key of ['uid', 'fileName', 'note', 'sources', 'media', 'location', 'url']) reject(r => { r[key] = 'secret'; });
  reject(r => { r.schemaVersion = 2; });
  reject(r => { r.kind = 'other'; });
  for (const value of ['false', null, 0]) reject(r => { r.localTest = value; });
  for (const value of ['', null, 'x'.repeat(129), '\u0000', 'x\u202ey', '\ud800']) reject(r => { r.resourceId = value; });
  reject(r => { r.fingerprint = ''; });
  reject(r => { r.fingerprint = 'x'.repeat(257); });
  for (const value of ['somebody@example.com', '中文姓名', 'free text', 'a\nb', 'https://example.com/private', '<b>x</b>']) {
    reject(r => { r.resourceId = value; });
    reject(r => { r.fingerprint = value; });
  }
  for (const value of ['demo-v1', 'onsite-local-example-v1', 'a'.repeat(64)]) {
    const compatible = report(); compatible.fingerprint = value;
    check(() => assert.equal(parse(compatible).fingerprint, value));
  }
  for (const value of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) reject(r => { r.version = value; });
  for (const value of [0, 13, '4', 4.2]) reject(r => { r.reading.total = value; });
  for (const value of [-1, 5, 1.5, '2']) reject(r => { r.reading.recorded = value; });
  reject(r => { r.reading.id = 'private'; });
  reject(r => { r.reading = []; });
  reject(r => { r.answers = null; });
  reject(r => { delete r.answers.obstacle; });
  reject(r => { r.answers.uid = 'private'; });
  for (const key of ['start', 'reading', 'memory']) {
    reject(r => { r.answers[key] = 'invalid'; });
    reject(r => { r.answers[key] = null; });
  }
  reject(r => { r.answers.obstacle = '字'.repeat(201); });
  reject(r => { r.answers.obstacle = {}; });
  reject(r => { r.answers = {start: '', reading: '', memory: '', obstacle: '   '}; });
  reject(r => { r.scope = '已经实地验收'; });
  const literal = report(); literal.answers.obstacle = '<img src=x onerror=alert(1)>🙂';
  check(() => assert.equal(parse(literal).answers.obstacle, literal.answers.obstacle));
  check(() => assert.throws(() => R.parse(JSON.stringify(report()).replace('"start":"alone"', '"start":"alone","__proto__":{}')), /原型/));
  check(() => assert.throws(() => R.parse(JSON.stringify(report()).replace('"localTest":true', '"localTest":false,"localTest":true')), /重复/));
  check(() => assert.throws(() => R.parse(JSON.stringify(report()).replace('"start":"alone"', '"start":"help","st\\u0061rt":"alone"')), /重复/));
  const bytes = new TextEncoder().encode(JSON.stringify(report())).length;
  check(() => assert.deepEqual(R.parse(JSON.stringify(report()) + ' '.repeat(R.MAX_BYTES - bytes)), report()));
  check(() => assert.throws(() => R.parse(JSON.stringify(report()) + ' '.repeat(R.MAX_BYTES - bytes + 1)), /64 KiB/));
  check(() => assert.throws(() => R.parse('字'.repeat(24000)), /64 KiB/));

  const one = R.group([entry('a')])[0];
  check(() => assert.equal(one.key, JSON.stringify([true, 'r', 1, report().fingerprint])));
  check(() => assert.deepEqual(one.counts, {start: {alone: 1, help: 0, lost: 0, unanswered: 0}, reading: {clear: 0, mixed: 1, hard: 0, unanswered: 0}, memory: {yes: 0, unsure: 0, no: 0, unanswered: 1}}));
  check(() => assert.deepEqual(one.obstacles, [{entryId: 'a', text: report().answers.obstacle}]));
  const same = R.group([entry('a'), entry('b'), entry('c', report(), true)])[0];
  check(() => assert.equal(same.totalReports, 3));
  check(() => assert.equal(same.includedReports, 2));
  check(() => assert.equal(same.excludedReports, 1));
  check(() => assert.equal(same.possibleDuplicateReports, 3));
  check(() => assert.equal(same.obstacles.length, 2));
  check(() => assert.deepEqual(same.entries[0], {id: 'a', excluded: false, possibleDuplicate: true, duplicateOf: ['b', 'c']}));
  check(() => assert.equal(same.counts.start.alone, 2));
  const different = report(); different.reading.recorded = 3;
  check(() => assert.equal(R.group([entry('a'), entry('b', different)])[0].possibleDuplicateReports, 0));
  const entries = [entry('a')];
  for (const [key, value] of [['localTest', false], ['resourceId', 'other'], ['version', 2], ['fingerprint', 'new']]) entries.push(entry(key, {...report(), [key]: value}));
  check(() => assert.equal(R.group(entries).length, 5));
  const first = {...report(), resourceId: 'a-b', fingerprint: 'c'}, second = {...report(), resourceId: 'a', fingerprint: 'b-c'};
  check(() => assert.equal(R.group([entry('a', first), entry('b', second)]).length, 2));
  check(() => assert.deepEqual(R.group([]), []));
  for (const bad of [null, {}, Array.from({length: 101}, (_, i) => entry(String(i))), [entry('a'), entry('a')], [{id: 'a', report: report()}], [{...entry('a'), extra: true}], [entry('', report())], [{...entry('a'), excluded: 'false'}]]) check(() => assert.throws(() => R.group(bad), /反馈文件无效/));
  check(() => assert.equal(R.group(Array.from({length: 100}, (_, i) => entry(String(i))))[0].includedReports, 100));
  const inherited = Object.assign(Object.create({hidden: true}), report());
  check(() => assert.throws(() => R.group([entry('a', inherited)]), /普通对象/));
  const accessor = report(); Object.defineProperty(accessor, 'localTest', {enumerable: true, get() { throw Error('must not execute'); }});
  check(() => assert.throws(() => R.group([entry('a', accessor)]), /动态属性/));
  const snapshot = JSON.stringify(entries); R.group(entries);
  check(() => assert.equal(JSON.stringify(entries), snapshot));
  const textOnly = report(); textOnly.answers = {start: '', reading: '', memory: '', obstacle: '字'};
  check(() => assert.equal(R.group([entry('a', textOnly)])[0].counts.start.unanswered, 1));
  const allExcluded = R.group([entry('a', report(), true)]);
  check(() => assert.equal(allExcluded[0].obstacles.length, 0));
  check(() => assert.equal(allExcluded[0].counts.reading.mixed, 0));
  check(() => assert.equal(R.summary(allExcluded).groups[0].includedReports, 0));

  const groups = R.group(entries), result = R.summary(groups);
  check(() => assert.equal(result.kind, 'reading-trial-review-summary'));
  check(() => assert.equal(result.groups[1].localTest, false));
  check(() => assert.match(result.limitations.join(' '), /未核实/));
  check(() => assert.match(result.limitations.join(' '), /不是人数/));
  check(() => assert.match(result.limitations.join(' '), /不能自动识别或清除全部个人信息/));
  check(() => assert.throws(() => R.summary([{...groups[0], resourceId: 'private@example.com'}]), /地点编号/));
  check(() => assert.throws(() => R.summary([{...groups[0], fingerprint: '秘密信息'}]), /资料指纹/));
  const output = JSON.stringify(result);
  for (const term of ['obstacles', 'entryId', 'fileName', 'entries', 'duplicateOf', report().answers.obstacle]) check(() => assert(!output.includes(term)));
  groups[0].fileName = 'private-file.json'; groups[0].anything = 'private-name';
  check(() => assert(!JSON.stringify(R.summary(groups)).includes('private-')));
  check(() => assert.throws(() => R.summary([{...groups[0], includedReports: 50}]), /计数不一致/));
  check(() => assert.throws(() => R.summary([{...groups[0], counts: {}}]), /份数/));
  check(() => assert.deepEqual(R.summary([]).groups, []));
  const human = R.reportText(groups, {exampleOnly: true});
  for (const term of ['【仅示例】', '不是人数', '能否开始', '是否读懂', '有无记住', '能自己开始 1 份', '内容指纹：', '地点编号、资料版本和指纹']) check(() => assert(human.includes(term), term));
  for (const term of ['private-file.json', 'private-name', 'obstacles', 'duplicateOf', report().answers.obstacle]) check(() => assert(!human.includes(term)));
  const normal = R.reportText(groups, {exampleOnly: false});
  check(() => assert(normal.includes('来源未核实')));
  check(() => assert(!normal.includes('【仅示例】')));
  check(() => assert(normal.includes('非本地测试（未核实）')));
  check(() => assert(normal.includes('第 5 组')));
  check(() => assert(R.reportText(allExcluded, {exampleOnly: false}).includes('计入 0 份；暂不计入 1 份')));
  check(() => assert(R.reportText([], {exampleOnly: false}).includes('尚未读入反馈')));
  for (const options of [{}, {exampleOnly: 'false'}]) check(() => assert.throws(() => R.reportText(groups, options), /反馈文件无效/));
  check(() => assert.throws(() => R.reportText([{...groups[0], includedReports: 50}], {exampleOnly: false}), /计数不一致/));
  const browser = {TextEncoder}; vm.createContext(browser);
  vm.runInContext(fs.readFileSync(require.resolve('./lib/exploration-trial-review-data'), 'utf8'), browser);
  check(() => assert.equal(browser.ChuTrialReviewData.parse(JSON.stringify(report())).version, 1));

  // Compatibility with the actual current exporter and real local fixture, not a hand-built substitute.
  const {fixture} = require('./lib/exploration-journey-preview');
  const E = require('../cloudfunctions/appCore/lib/exploration-core');
  const f = await fixture(), data = C.project(await E.get(f.db, 'r'), 'r');
  const raw = {...C.record(data, null), observed: ['tower'], feedback: {start: 'help', reading: '', memory: 'unsure', obstacle: '想重读'}};
  const exported = C.trialReport(data, raw);
  check(() => assert.deepEqual(parse(exported), exported));
  check(() => assert.equal(R.group([entry('fixture', parse(exported))])[0].counts.start.help, 1));
  check(() => assert.equal(parse(C.trialReport({...data, localTest: false}, raw)).localTest, false));
  console.log('exploration-trial-review-data: ' + checks + ' checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
