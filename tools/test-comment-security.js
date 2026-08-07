'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.resolve(__dirname, '..', 'cloudfunctions', 'appCore', 'index.js');
const source = `${fs.readFileSync(sourcePath, 'utf8')}
module.exports.__commentSecurity = { normalizeCommentContent, interactionContentHash, isTransactionBusyError };`;
const moduleObject = { exports: {} };
const sandbox = {
  module: moduleObject,
  exports: moduleObject.exports,
  console,
  URL,
  Buffer,
  setTimeout,
  clearTimeout,
  process: { env: {} },
  require(name) {
    if (name === '@cloudbase/node-sdk') {
      return {
        SYMBOL_CURRENT_ENV: 'test',
        init() {
          return { database: () => ({}) };
        }
      };
    }
    return require(name);
  }
};

vm.runInNewContext(source, sandbox, { filename: sourcePath });
const { normalizeCommentContent, interactionContentHash, isTransactionBusyError } = moduleObject.exports.__commentSecurity;

assert.strictEqual(normalizeCommentContent('  一条正常的讨论内容  '), '一条正常的讨论内容');
assert.strictEqual(normalizeCommentContent('第一行\r\n第二行'), '第一行\n第二行');
assert.strictEqual(interactionContentHash('同 一条评论'), interactionContentHash('  同   一条评论  '));
assert.strictEqual(isTransactionBusyError({ code: 'ResourceUnavailableTransactionBusy', message: 'Transaction is busy' }), true);
assert.strictEqual(isTransactionBusyError({ code: 'DATABASE_TRANSACTION_FAIL', message: 'temporary failure' }), true);
assert.strictEqual(isTransactionBusyError({ code: 'COMMENT_REQUIRED', message: '评论为空' }), false);

const clientSource = fs.readFileSync(path.resolve(__dirname, '..', 'static', 'cloudbase-app.js'), 'utf8');
assert.match(clientSource, /action:\s*'createComment'[\s\S]{0,260}clientRequestId:/);
assert.match(clientSource, /pendingCommentRequestId/);

const rejected = [
  ['', 'COMMENT_REQUIRED'],
  ['x'.repeat(501), 'COMMENT_TOO_LONG'],
  ['请联系 13800138000', 'PRIVATE_INFORMATION'],
  ['身份证 420106199001011234', 'PRIVATE_INFORMATION'],
  ['邮箱 test@example.com', 'PRIVATE_INFORMATION'],
  ['https://a.example https://b.example https://c.example', 'TOO_MANY_LINKS'],
  ['哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈', 'COMMENT_SPAM']
];

for (const [value, code] of rejected) {
  assert.throws(() => normalizeCommentContent(value), (error) => error && error.code === code);
}

console.log('Comment security tests passed.');
