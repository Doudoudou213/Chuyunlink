'use strict';
// Local mocked browser checks. No CloudBase session, model calls or production writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || 'agent-review-ui-artifacts');
const payload = { temporaryId: 'entity_1', name: '凤鸟纹', entityType: 'detail_or_motif', summary: '花窗近景中记录的双翼纹样', aliases: [] };
const entity = { id: 'entity-candidate', jobId: 'j1', candidateType: 'entity', status: 'pending_review', risk: 'medium', payload,
  eligible: true, evidence: [], resourceId: 'r1', resourceTitle: '随州木雕花窗', submissionTitle: '花窗正面采集记录', submissionText: '投稿者记录了窗棂上的双翼纹样，并补充了正面拍摄位置。' };
const relation = { ...entity, id: 'relation-candidate', candidateType: 'relation', sourceName: '凤鸟纹', sourceReady: false,
  payload: { fromTemporaryId: 'entity_1', toResourceId: 'r1', relationType: 'visually_similar_to', reason: '纹样具有相似的双翼轮廓，仍须核对现场细节。', evidenceLinkIds: ['ev1'], confidence: 0.8 },
  evidence: [{ id: 'ev1', valid: true, title: '木雕花窗近景记录', summary: '已确认投稿记录了两侧展开的双翼纹样。' }] };
const seed = [entity, relation, { ...relation, id: 'high', risk: 'high', payload: { ...relation.payload, relationType: 'changed_over_time' } },
  { ...entity, id: 'gap', candidateType: 'gap', risk: 'insufficient', payload: { request: '补充背面连接位置照片', reason: '现有照片没有呈现背面构造。' } }];
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req,res) => {
    const files = { '/admin.html': 'admin.html', '/static/admin-agent-review.js': 'static/admin-agent-review.js' };
    if (!files[req.url]) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(root,files[req.url])));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    if (fs.existsSync(path.join(output, 'tailwind.js'))) await page.route('https://cdn.tailwindcss.com/**', route => route.fulfill({ contentType:'application/javascript', body:fs.readFileSync(path.join(output,'tailwind.js'),'utf8') }));
    await page.route('https://static.cloudbase.net/**', route => route.fulfill({ contentType: 'application/javascript', body: `window.cloudbase={init:()=>({auth:()=>({getLoginState:async()=>null})})};` }));
    await page.goto(`http://127.0.0.1:${server.address().port}/admin.html`);
    await page.waitForFunction(() => typeof callAdmin === 'function');
    await page.evaluate(rows => {
      window.mockRows = rows;
      window.calls = [];
      callAdmin = async request => {
        calls.push(request);
        if (request.action === 'getAgentEvaluationWorkspace') return { ok:true,
          sets:[{id:'agent_feedback_v1',version:'feedback-v1',title:'管理员反馈评测集 V1',status:'active'}],
          selectedSet:{id:'agent_feedback_v1',version:'feedback-v1',title:'管理员反馈评测集 V1',status:'active'},
          metrics:{total:0,activeTotal:0,directApprovalRate:0,modificationRate:0,rejectionRate:0,sourceValidityRate:0,relationTypeConsistencyRate:0,ratingCounts:{correct:0,partial:0,incorrect:0,unrated:0}},
          comparisons:[],samples:[],selectedReviewIds:[] };
        if (request.action === 'getAgentReviewWorkspace') return { ok:true, candidates:mockRows.filter(c=>c.status===request.status),
          nextOffset:null, resources:[{id:'r1',title:'随州木雕花窗'}], entities:[], stories:[{id:'story1',resourceId:'r1',title:'花窗故事',chapters:[{index:0,title:'花窗构造'}]}] };
        if (request.action === 'saveAgentGapDraft' || request.action === 'publishAgentGapDraft') return { ok:true, task:{...request, draftVersion:1, status:request.action === 'saveAgentGapDraft' ? 'draft':'published'} };
        return { ok:true, results:request.items.map(item=>({ok:true,candidateId:item.candidateId,status:'approved'})) };
      };
      loginPanel.classList.add('hidden'); loginPanel.style.display = 'none';
      adminPanel.classList.remove('hidden');
      identity.textContent = '管理员 · 本地演示数据';
    }, seed);
    await page.waitForFunction(() => getComputedStyle(document.getElementById('login-panel')).display === 'none');
    for (const width of [390,768,1440]) {
      await page.setViewportSize({ width, height: 1000 });
      if(!await page.locator('#agent-review-refresh').isVisible()) await page.locator('.admin-menu-toggle').click();
      await page.click('#agent-review-refresh');
      await page.locator('[data-candidate]').first().waitFor();
      await page.locator('[data-candidate]').first().locator('summary').first().click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}`);
      await page.screenshot({ path:path.join(output,`review-${width}.png`), fullPage:true });
    }
    assert.equal(await page.locator('[data-candidate="high"] [data-select]').isDisabled(), true);
    assert.equal(await page.locator('[data-candidate="gap"] [data-approve]').count(), 0);
    assert.equal(await page.locator('[data-candidate="gap"] [data-gap-publish]').isDisabled(), true);
    await page.evaluate(()=>document.querySelectorAll('#list details').forEach(d=>d.open=true));
    await page.locator('[data-candidate="gap"] [data-gap-save]').click();
    await page.locator('[data-candidate="gap"] [data-result]').filter({hasText:'草稿已保存'}).waitFor();
    await page.locator('[data-candidate="gap"] [data-gap-publish]').click();
    await page.locator('[data-candidate="gap"] [data-result]').filter({hasText:'征集已发布'}).waitFor();
    assert.equal(await page.evaluate(() => calls.find(c=>c.action==='publishAgentGapDraft').draftVersion), 1);
    await page.locator('[data-candidate="entity-candidate"] [data-select]').check();
    await page.locator('[data-batch-approve]').click();
    await page.locator('[data-candidate="entity-candidate"] [data-result]').filter({hasText:'处理完成'}).waitFor();
    assert.equal(await page.evaluate(() => calls.filter(c=>c.action==='reviewAgentCandidates').length), 1);
    await page.click('[data-refresh]');
    await page.evaluate(()=>document.querySelectorAll('#list details').forEach(d=>d.open=true));
    await page.locator('[data-candidate="relation-candidate"] [data-field="why"]').fill('管理员修改后，明确指出只有外观相似。');
    await page.locator('[data-candidate="relation-candidate"] [data-approve]').click();
    await page.waitForFunction(() => calls.filter(c=>c.action==='reviewAgentCandidates').length === 2);
    assert.equal(await page.evaluate(() => calls.at(-1).items[0].edits.why), '管理员修改后，明确指出只有外观相似。');
    await page.evaluate(() => { mockRows = []; });
    await page.click('[data-refresh]');
    await page.getByText('当前没有建议。', {exact:false}).waitFor();
    assert.deepEqual(errors, []);
    console.log('Admin review UI passed: 390/768/1440 widths, selection, edits, risk restrictions, empty state, no script errors.');
  } finally { if (browser) await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(e => { console.error(e); process.exitCode=1; });
