'use strict';
// Read-only verification against the exact deployment manifest, never a crawler.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const base = 'https://chulink-legacy-d8god1687a5d60743-1458884983.tcloudbaseapp.com/';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function main() {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const manifest = fs.readFileSync(path.join(root, 'tools/deploy-cloudbase.ps1'), 'utf8');
  const pages = [...manifest.matchAll(/Join-Path \$projectRoot '([^']+)'/g)].map(m => m[1]).filter(x => /\.(html|geojson)$/.test(x));
  const scripts = [...manifest.matchAll(/Join-Path \$staticDirectory '([^']+)'/g)].map(m => 'static/' + m[1]).filter(x => /\.(js|css|png|svg)$/.test(x));
  const assets = execFileSync('git', ['ls-tree', '-r', '--name-only', commit, '--', 'static/assets'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  const files = [...new Set([...pages, ...scripts, ...assets])];
  if (files.length < 100 || files.some(file => file.includes('..') || path.isAbsolute(file) || /(?:^|\/)(?:tools|cloudfunctions|\.git)(?:\/|$)/.test(file))) throw Error('INVALID_MANIFEST');
  let cursor = 0;
  const rows = [];
  async function worker() {
    while (cursor < files.length) {
      const file = files[cursor++];
      let row;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(base + file + '?release=' + commit.slice(0, 7), { signal: AbortSignal.timeout(25000) });
          const actual = Buffer.from(await response.arrayBuffer());
          row = { file, status: response.status, hashMatches: response.ok && hash(actual) === hash(fs.readFileSync(path.join(root, file))) };
          if (row.hashMatches) break;
        } catch { row = { file, error: 'READ_FAILED', hashMatches: false }; }
      }
      rows.push(row);
      if (!row.hashMatches) console.log(JSON.stringify(row));
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  const summary = { commit, checkedAt: new Date().toISOString(), total: files.length, passed: rows.filter(row => row.hashMatches).length,
    rows: rows.sort((a, b) => a.file.localeCompare(b.file)) };
  const directory = path.join(root, 'artifacts/scenic-release-20261022');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'hosting.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ commit, total: summary.total, passed: summary.passed }));
  if (summary.passed !== summary.total) process.exitCode = 1;
}
main().catch(() => { console.error('HOSTING_VERIFICATION_FAILED'); process.exitCode = 1; });
