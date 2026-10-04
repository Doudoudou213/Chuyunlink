'use strict';

// Source-contract checks only. These do not claim to measure the browser's CSS
// cascade, textured-pixel contrast, actual wrapping, scroll alignment or touch targets.
// The numeric contrast check below covers declared colors over the darker paper token.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const editorial = read('static/paper-editorial.css');
const community = read('static/community-paper.css');
const profile = read('static/profile-paper.css');
const home = read('static/discover-paper.css');
const field = read('static/field-paper.css');
const build = read('tools/validate-cloudbase-build.js');
const deploy = read('tools/deploy-cloudbase.ps1');
const allStyles = [html, home, profile, community, field, editorial].join('\n');
const ruleCache = new Map();

function rules(source, selector) {
  if (!ruleCache.has(source)) {
    // Parse only styles, not the large HTML document and its JS template strings.
    const styles = source === html
      ? [...source.matchAll(/<style\b[^>]*>([^]*?)<\/style>/gi)].map(match => match[1]).join('\n')
      : source;
    const cleaned = styles.replace(/\/\*[^]*?\*\//g, '');
    ruleCache.set(source, [...cleaned.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(match => ({ selectors: match[1].trim().split(/,\s*(?![^()]*\))/).map(value => value.trim()), body: match[2] })));
  }
  return ruleCache.get(source).filter(item => item.selectors.includes(selector)).map(item => item.body);
}

function rule(source, selector, marker = '') {
  const found = rules(source, selector).find(body => body.includes(marker));
  assert.ok(found, `Rule exists: ${selector} (${marker})`);
  return found;
}

function declaration(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const values = [...body.matchAll(new RegExp(`(?:^|[;{])\\s*${escaped}\\s*:\\s*([^;}]+)`, 'g'))];
  assert.ok(values.length, `Declaration exists: ${name}`);
  return values.at(-1)[1].replace(/\s*!important\s*$/, '').trim();
}

function variable(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const values = [...allStyles.matchAll(new RegExp(`${escaped}\\s*:\\s*([^;}]+)`, 'g'))];
  assert.ok(values.length, `Variable exists: ${name}`);
  return resolve(values.at(-1)[1].trim());
}

function resolve(value) {
  const match = /^var\((--[\w-]+)\)$/.exec(value);
  return match ? variable(match[1]) : value.toLowerCase();
}

function color(value) {
  const resolved = resolve(value);
  if (/^#[\da-f]{6}$/i.test(resolved)) {
    return [1, 3, 5].map(index => Number.parseInt(resolved.slice(index, index + 2), 16)).concat(1);
  }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(resolved);
  assert.ok(rgba, `Supported declared state color: ${resolved}`);
  return rgba.slice(1).map(Number);
}

function contrastRatio(foreground, background, paper) {
  const composite = (over, under) => over.slice(0, 3).map((channel, index) => channel * over[3] + under[index] * (1 - over[3]));
  const luminance = rgb => rgb.map(channel => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const backgroundRGB = composite(background, paper);
  const front = luminance(composite(foreground, backgroundRGB));
  const back = luminance(backgroundRGB);
  return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
}

function webpSize(data) {
  assert.equal(data.toString('ascii', 0, 4), 'RIFF');
  assert.equal(data.toString('ascii', 8, 12), 'WEBP');
  for (let offset = 12; offset + 8 <= data.length;) {
    const kind = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (kind === 'VP8X') return [data.readUIntLE(start + 4, 3) + 1, data.readUIntLE(start + 7, 3) + 1];
    if (kind === 'VP8L') {
      const bits = data.readUInt32LE(start + 1);
      return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    if (kind === 'VP8 ') return [data.readUInt16LE(start + 6) & 0x3fff, data.readUInt16LE(start + 8) & 0x3fff];
    offset = start + size + (size % 2);
  }
  throw new Error('WebP dimensions not found');
}

let passed = 0;
function test(name, callback) {
  callback(); passed++;
  console.log(`PASS ${name}`);
}

test('Paper texture exists, is square 1024px WebP, and stays under 120 KiB', () => {
  const asset = fs.readFileSync(path.join(root, 'static/assets/paper-fibres-soft-v1.webp'));
  assert.deepEqual(webpSize(asset), [1024, 1024]);
  assert.ok(asset.length > 1000 && asset.length <= 120 * 1024);
});

test('Material uses the existing paper surface and muted warm shadow tokens', () => {
  const tokens = rule(editorial, ':root');
  assert.match(declaration(tokens, '--editorial-leaf-background'), /paper-fibres-soft-v1\.webp/);
  assert.match(declaration(tokens, '--editorial-leaf-shadow'), /#756e5e/);
  assert.equal(variable('--editorial-paper'), '#f8f4eb');
  assert.equal(variable('--editorial-surface'), '#fffcf5');
  assert.equal(variable('--editorial-ink'), '#30392e');
});

test('Selected paper leaves share background/shadow without newly framing them', () => {
  const leaves = [
    [field, '.collect-paper-active #view-collect .collect-scroll-sheet'],
    [community, '#view-community #community-route-card'],
    [community, '#view-community .chu-knowledge-panel'],
    [community, '#view-community #quick-learning-list'],
    [profile, '.profile-paper-active #cloud-profile-card'],
    [profile, '.profile-paper-active .profile-submission-card'],
    [profile, '.profile-paper-active .profile-gallery-empty']
  ];
  for (const [source, selector] of leaves) {
    const body = rule(source, selector, '--editorial-leaf-background');
    assert.match(body, /box-shadow:\s*var\(--editorial-leaf-shadow\)/, selector);
    assert.doesNotMatch(body, /(?:^|;)\s*border(?:-(?:top|right|bottom|left))?\s*:\s*(?!0(?:\s|;))[^;]*(?:solid|dashed|double)/, selector);
  }
  assert.doesNotMatch(home, /--editorial-leaf-background/, 'Do not wallpaper the illustrated homepage');
  assert.doesNotMatch(rule(html, '#heritage-map'), /editorial-leaf/, 'Do not cover the actual map');
});

test('Collection notes keep 1rem text, 2.25rem rows and an input-local scrolling rule', () => {
  const notes = rule(html, '#view-collect #collect-description', 'repeating-linear-gradient');
  assert.equal(declaration(notes, 'font-size'), '1rem');
  assert.equal(declaration(notes, 'line-height'), '2.25rem');
  assert.match(declaration(notes, 'background'), /100% 2\.25rem local$/);
  assert.equal(declaration(notes, 'resize'), 'vertical');
  assert.equal(declaration(rule(html, '#view-collect .collect-notes-paper'), 'background'), 'transparent');
  assert.ok(rules(html, '#view-collect #collect-description:focus-visible').length, 'Keyboard focus styling remains');
});

test('320px and 390px share the narrow collection column rule, not a desktop-sized gutter', () => {
  assert.match(html, /@media\s*\(max-width:\s*420px\)\s*\{\s*#view-collect \.collect-form-section\s*\{[^}]*grid-template-columns:\s*2\.65rem minmax\(0,\s*1fr\);[^}]*gap:\s*0\.7rem/);
  assert.match(html, /#view-collect \.collect-section-label\s*\{\s*padding-right:\s*0\.45rem;\s*font-size:\s*1\.04rem/);
  assert.match(html, /#view-collect #collect-form > button\[type="submit"\]\s*\{\s*width:\s*calc\(100% - 3\.35rem\);\s*margin-left:\s*3\.35rem/);
});

test('Shared page palettes reuse the established editorial values', () => {
  for (const source of [home, field]) {
    assert.match(source, /var\(--editorial-paper\)/);
    assert.match(source, /var\(--editorial-ink\)/);
    assert.match(source, /var\(--editorial-sage\)/);
    assert.match(source, /var\(--editorial-red\)/);
  }
});

test('Correct answer, collected status and map verification resolve to the same existing sage', () => {
  const sage = variable('--editorial-sage');
  assert.equal(sage, '#58725f');
  assert.equal(variable('--community-patina'), sage);
  assert.equal(variable('--map-ticket-patina'), sage);
  assert.equal(resolve(declaration(rule(html, '.profile-status-verified'), 'color')), sage);
  assert.equal(resolve(declaration(rule(community, '#view-community button[id^="quiz-option"].is-correct'), 'color')), sage);
  assert.equal(resolve(declaration(rule(html, '#landmark-drawer[data-status="verified"] .landmark-ticket-eyebrow'), 'color')), sage);
});

test('Wrong answer and attention keep muted red; urgent map collection remains red rather than success', () => {
  const red = variable('--editorial-red');
  assert.equal(red, '#a7493d');
  assert.equal(variable('--community-vermilion'), red);
  assert.equal(variable('--map-ticket-vermilion'), red);
  assert.equal(resolve(declaration(rule(html, '.profile-status-attention'), 'color')), red);
  assert.equal(resolve(declaration(rule(community, '#view-community button[id^="quiz-option"].is-wrong'), 'color')), red);
  assert.equal(resolve(declaration(rule(html, '#landmark-drawer[data-status="pending"] .landmark-ticket-eyebrow'), 'color')), red);
  assert.notEqual(resolve(declaration(rule(html, '.profile-status-gold'), 'color')), red, 'Pending organisation remains distinct from an error');
});

test('Legacy emerald remapping must not turn success into gold again', () => {
  for (const view of ['collect', 'community', 'map']) {
    const background = rule(html, `#view-${view} [class*="bg-emerald"]`);
    const text = rule(html, `#view-${view} [class*="text-emerald"]`);
    assert.match(declaration(background, 'background-color'), /rgba\(88,\s*114,\s*95,\s*0\.04\)/);
    assert.equal(resolve(declaration(text, 'color')), variable('--editorial-sage'));
    assert.doesNotMatch(background + text, /(?:#b38c45|#b68a4a|#735322|179,\s*140,\s*69|182,\s*138,\s*74)/i);
  }
  assert.equal(resolve(declaration(rule(html, '#view-map .bg-emerald-600'), 'background-color')), variable('--editorial-sage'));
});

test('Declared sage, red and gold state text exceeds 4.5:1 over darker paper', () => {
  const paper = color(variable('--editorial-paper'));
  const states = [
    [html, '.profile-status-verified'],
    [html, '.profile-status-gold'],
    [html, '.profile-status-attention'],
    [community, '#view-community button[id^="quiz-option"].is-correct'],
    [community, '#view-community button[id^="quiz-option"].is-wrong']
  ];
  for (const [source, selector] of states) {
    const body = rule(source, selector);
    const ratio = contrastRatio(color(declaration(body, 'color')), color(declaration(body, 'background')), paper);
    assert.ok(ratio >= 4.5, `${selector}: ${ratio.toFixed(3)}:1 must be at least 4.5:1`);
  }
  const genericBackground = rule(html, '#view-collect [class*="bg-emerald"]');
  const genericText = rule(html, '#view-collect [class*="text-emerald"]');
  const ratio = contrastRatio(color(declaration(genericText, 'color')), color(declaration(genericBackground, 'background-color')), paper);
  assert.ok(ratio >= 4.5, `Shared success text: ${ratio.toFixed(3)}:1 must be at least 4.5:1`);
});

test('Texture dependency is covered by build validation and existing recursive asset copying', () => {
  assert.match(build, /['"]static\/assets\/paper-fibres-soft-v1\.webp['"]/);
  assert.match(deploy, /Copy-Item\s+-LiteralPath\s+\(Join-Path\s+\$staticDirectory\s+'assets'\)\s+-Destination\s+\$hostingStaticDirectory\s+-Recurse/);
  assert.match(html, /href="\.\/static\/paper-editorial\.css(?:\?[^"\s]+)?"|href="static\/paper-editorial\.css(?:\?[^"\s]+)?"/);
});

console.log(`Paper material source checks: ${passed}/${passed} passed. Browser rendering still requires separate QA.`);
