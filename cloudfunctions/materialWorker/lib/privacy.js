'use strict';

const crypto = require('node:crypto');

const RULES = [
  { type: 'mainland_id_number', pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g, replacement: '[身份证号已隐藏]' },
  { type: 'mainland_mobile', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g, replacement: '[手机号已隐藏]' },
  { type: 'email_address', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: '[邮箱已隐藏]' },
  { type: 'landline_number', pattern: /(?<!\d)(?:0\d{2,3}[-\s]?)?\d{7,8}(?!\d)/g, replacement: '[电话号码已隐藏]' },
  { type: 'long_account_number', pattern: /(?<!\d)\d{16,19}(?!\d)/g, replacement: '[长号码已隐藏]' }
];

function redactSensitiveText(value) {
  let text = String(value == null ? '' : value);
  const counts = {};
  for (const rule of RULES) {
    text = text.replace(rule.pattern, () => {
      counts[rule.type] = (counts[rule.type] || 0) + 1;
      return rule.replacement;
    });
  }
  return {
    text,
    flags: Object.keys(counts),
    counts,
    redacted: Object.keys(counts).length > 0
  };
}

function textHash(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value), 'utf8').digest('hex');
}

module.exports = { redactSensitiveText, textHash };
