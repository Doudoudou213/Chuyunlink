/* Offline review only: no storage, network, identity inference or automatic deduplication. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChuTrialReviewData = factory();
})(globalThis, function () {
  'use strict';
  const MAX_BYTES = 64 * 1024;
  const MAX_ENTRIES = 100;
  const SCOPE = '自愿填写的阅读试用反馈；不代表实地到访、客流统计或景区验收。';
  const LIMITATIONS = Object.freeze([
    '数量为人工选择纳入的反馈文件份数，不是人数、客流、转化率或满意度。',
    '本地样例与非本地声明分组展示；localTest=false 只是导出文件的声明，未核实来源或真实试用。',
    '内容相同只提示可能重复，也可能来自不同试用者；不自动删除或判定同一人。',
    '此摘要不包含原始意见、文件名或账号字段；仍保留地点编号、资料版本和指纹，导出前须人工核对，不能自动识别或清除全部个人信息。',
    '此摘要不代表实地到访、景区验收或上线许可。'
  ]);
  const CHOICES = Object.freeze({start: ['alone', 'help', 'lost'], reading: ['clear', 'mixed', 'hard'], memory: ['yes', 'unsure', 'no']});
  const ROOT_KEYS = ['schemaVersion', 'kind', 'localTest', 'resourceId', 'version', 'fingerprint', 'reading', 'answers', 'scope'];
  function fail(message) { throw new Error('反馈文件无效：' + message); }
  function object(value, keys, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(name + '应为普通对象。');
    const actual = Object.keys(value);
    if (actual.length !== keys.length || actual.some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) fail(name + '字段不完整或含不允许的内容。');
    if (Object.getOwnPropertySymbols(value).length || actual.some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail(name + '不能含动态属性。');
  }
  function string(value, max, name, nonempty = true) {
    if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)) fail(name + '格式不正确。');
    // Reject isolated UTF-16 surrogates, but preserve emoji pairs and literal markup as plain text.
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) fail(name + '包含无效字符。');
      } else if (code >= 0xdc00 && code <= 0xdfff) fail(name + '包含无效字符。');
    }
    return value;
  }
  function integer(value, min, max, name) {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail(name + '超出范围。');
    return value;
  }
  function token(value, max, name) {
    string(value, max, name);
    if (!/^[\w-]+$/.test(value)) fail(name + '只能包含 ASCII 字母、数字、下划线或连字符。');
    return value;
  }
  function validate(raw) {
    object(raw, ROOT_KEYS, '报告');
    if (raw.schemaVersion !== 1 || raw.kind !== 'reading-trial-feedback') fail('不支持此报告类型或版本。');
    if (typeof raw.localTest !== 'boolean') fail('缺少明确的本地样例声明。');
    // Match site-walk-core.id; metadata is not a free-text field.
    const resourceId = token(raw.resourceId, 128, '地点编号');
    const version = integer(raw.version, 1, Number.MAX_SAFE_INTEGER, '资料版本');
    // Production/editorial fingerprints are hex; legacy local demos use demo-v1 tokens.
    const fingerprint = token(raw.fingerprint, 256, '资料指纹');
    object(raw.reading, ['recorded', 'total'], '阅读记录');
    const total = integer(raw.reading.total, 1, 12, '景物总数');
    const recorded = integer(raw.reading.recorded, 0, total, '已记录景物数');
    object(raw.answers, ['start', 'reading', 'memory', 'obstacle'], '回答');
    const answers = {};
    for (const [key, allowed] of Object.entries(CHOICES)) {
      if (raw.answers[key] !== '' && !allowed.includes(raw.answers[key])) fail('回答选项不在允许范围内。');
      answers[key] = raw.answers[key];
    }
    answers.obstacle = string(raw.answers.obstacle, 200, '自愿意见', false).trim();
    if (!Object.values(answers).some(Boolean)) fail('没有可复盘的回答。');
    if (raw.scope !== SCOPE) fail('报告范围声明不匹配。');
    return {schemaVersion: 1, kind: 'reading-trial-feedback', localTest: raw.localTest,
      resourceId, version, fingerprint, reading: {recorded, total}, answers, scope: SCOPE};
  }
  function parse(text) {
    if (typeof text !== 'string') fail('请读取 JSON 文本。');
    if (text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES) fail('单份报告不能超过 64 KiB。');
    let raw;
    try {
      raw = JSON.parse(text.replace(/^\uFEFF/, ''), (key, value) => {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('含不允许的原型字段。');
        return value;
      });
    } catch (error) {
      if (error.message.startsWith('反馈文件无效：')) throw error;
      fail('不是有效的 JSON。');
    }
    // JSON.parse accepts duplicate keys; reject their ambiguity before deciding test/version scope.
    const stack = [];
    for (const token of text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g) || []) {
      if (token === '{') stack.push({keys: new Set(), key: true});
      else if (token === '[') stack.push({array: true});
      else if (token === '}' || token === ']') stack.pop();
      else {
        const top = stack.at(-1);
        if (!top || top.array) continue;
        if (token === ',') top.key = true;
        else if (token === ':') top.key = false;
        else if (token.startsWith('"') && top.key) {
          const key = JSON.parse(token);
          if (top.keys.has(key)) fail('含重复字段。');
          top.keys.add(key);
        }
      }
    }
    return validate(raw);
  }
  function group(entries) {
    if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) fail('每次最多复盘 100 份报告。');
    const groups = new Map(), ids = new Set();
    for (const entry of entries) {
      object(entry, ['id', 'report', 'excluded'], '复盘条目');
      const id = string(entry.id, 128, '条目编号');
      if (ids.has(id)) fail('条目编号重复。');
      ids.add(id);
      if (typeof entry.excluded !== 'boolean') fail('是否排除须明确选择。');
      const report = validate(entry.report);
      const key = JSON.stringify([report.localTest, report.resourceId, report.version, report.fingerprint]);
      if (!groups.has(key)) {
        const counts = {};
        for (const [name, choices] of Object.entries(CHOICES)) counts[name] = Object.fromEntries([...choices, 'unanswered'].map(choice => [choice, 0]));
        groups.set(key, {key, localTest: report.localTest, resourceId: report.resourceId, version: report.version,
          fingerprint: report.fingerprint, totalReports: 0, includedReports: 0, excludedReports: 0,
          possibleDuplicateReports: 0, counts, obstacles: [], entries: [], duplicates: new Map()});
      }
      const g = groups.get(key), row = {id, excluded: entry.excluded, possibleDuplicate: false, duplicateOf: []};
      g.totalReports++; g.entries.push(row);
      if (entry.excluded) g.excludedReports++;
      else {
        g.includedReports++;
        for (const name of Object.keys(CHOICES)) g.counts[name][report.answers[name] || 'unanswered']++;
        if (report.answers.obstacle) g.obstacles.push({entryId: id, text: report.answers.obstacle});
      }
      const signature = JSON.stringify(report);
      if (!g.duplicates.has(signature)) g.duplicates.set(signature, []);
      g.duplicates.get(signature).push(row);
    }
    return [...groups.values()].map(g => {
      for (const matches of g.duplicates.values()) if (matches.length > 1) {
        g.possibleDuplicateReports += matches.length;
        for (const row of matches) {
          row.possibleDuplicate = true;
          row.duplicateOf = matches.filter(other => other.id !== row.id).map(other => other.id);
        }
      }
      delete g.duplicates;
      return g;
    });
  }
  function summary(groups) {
    if (!Array.isArray(groups) || groups.length > MAX_ENTRIES) fail('分组不正确。');
    // Explicit allowlist: never spread groups/entries, because they contain voluntary free text.
    return {schemaVersion: 1, kind: 'reading-trial-review-summary', limitations: [...LIMITATIONS],
      groups: groups.map(g => {
        if (!g || typeof g.localTest !== 'boolean') fail('分组声明不正确。');
        const counts = {};
        for (const [name, choices] of Object.entries(CHOICES)) {
          counts[name] = {};
          for (const choice of [...choices, 'unanswered']) counts[name][choice] = integer(g.counts?.[name]?.[choice], 0, MAX_ENTRIES, '回答份数');
        }
        const includedReports = integer(g.includedReports, 0, MAX_ENTRIES, '纳入份数');
        const excludedReports = integer(g.excludedReports, 0, MAX_ENTRIES, '排除份数');
        const totalReports = integer(g.totalReports, 0, MAX_ENTRIES, '总份数');
        const possibleDuplicateReports = integer(g.possibleDuplicateReports, 0, totalReports, '可能重复份数');
        if (includedReports + excludedReports !== totalReports || Object.values(counts).some(values => Object.values(values).reduce((a, b) => a + b, 0) !== includedReports)) fail('分组计数不一致。');
        return {localTest: g.localTest, resourceId: token(g.resourceId, 128, '地点编号'),
          version: integer(g.version, 1, Number.MAX_SAFE_INTEGER, '资料版本'), fingerprint: token(g.fingerprint, 256, '资料指纹'),
          totalReports, includedReports, excludedReports, possibleDuplicateReports, counts};
      })};
  }
  function reportText(groups, options = {}) {
    if (typeof options.exampleOnly !== 'boolean') fail('请明确是否为演示摘要。');
    const clean = summary(groups);
    const rows = ['楚韵链迹 · 画卷试用复盘',
      options.exampleOnly ? '【仅示例】以下为演示记录，不是真实试用结果。' : '【本地文件摘要】来源未核实，不代表独立游客或景区验收。',
      '本报告仅含计数和版本依据，不包含游客原话、账号字段或原文件名。', ''];
    if (!clean.groups.length) rows.push('尚未读入反馈，暂无可复盘记录。', '');
    const columns = [
      ['start', '能否开始', [['alone', '能自己开始'], ['help', '需要提示'], ['lost', '没找到入口'], ['unanswered', '未回答']]],
      ['reading', '是否读懂', [['clear', '清楚易懂'], ['mixed', '部分费解'], ['hard', '不易理解'], ['unanswered', '未回答']]],
      ['memory', '有无记住', [['yes', '记住了'], ['unsure', '不确定'], ['no', '还没有'], ['unanswered', '未回答']]]
    ];
    clean.groups.forEach((g, i) => {
      rows.push('第 ' + (i + 1) + ' 组 · 地点编号 ' + g.resourceId + ' · 资料第 ' + g.version + ' 版',
        '文件声明：' + (g.localTest ? '本地测试' : '非本地测试（未核实）'),
        '内容指纹：' + g.fingerprint,
        '已读入 ' + g.totalReports + ' 份；计入 ' + g.includedReports + ' 份；暂不计入 ' + g.excludedReports + ' 份。',
        '其中 ' + g.possibleDuplicateReports + ' 份内容相同，仅供人工核对，不自动删除。');
      for (const [key, title, values] of columns) rows.push(title + '：' + values.map(([value, label]) => label + ' ' + g.counts[key][value] + ' 份').join('；') + '。');
      rows.push('');
    });
    rows.push('如何使用这份报告', '先核对版本和可能重复的文件，再对照本机原话决定需要改善的内容。',
      '计数不能替代现场核验、内容审核、真实用户试用或上线授权。', '', '范围与限制', ...clean.limitations.map(line => '· ' + line));
    return rows.join('\n');
  }
  return {MAX_BYTES, MAX_ENTRIES, SCOPE, LIMITATIONS, parse, group, summary, reportText};
});
