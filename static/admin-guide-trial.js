(function () {
  'use strict';
  const box = document.getElementById('list');
  if (!box) return;
  const esc = value => escapeHtml(String(value ?? ''));
  const money = value => value == null ? '未知' : '¥' + Number(value).toFixed(4);
  const stages = { preparing: '检查与预算预留', calling: '等待模型', validating: '校验输出', saving: '保存草稿', completed: '已完成', failed: '失败', interrupted: '任务中断', processing: '处理中' };
  const choices = {
    firstPass: ['是否一次通过', { yes: '是', no: '否' }],
    modification: ['管理员修改量', { none: '无需修改', small: '少量修改', large: '大量修改' }],
    sourceSufficient: ['来源是否充分', { yes: '充分', partial: '部分充分', no: '不足' }],
    accuracy: ['事实是否准确', { correct: '正确', partial: '部分正确', incorrect: '错误' }],
    listenSuitable: ['是否适合现场听', { yes: '适合', partial: '需要调整', no: '不适合' }]
  };
  function budget(b) {
    if (!b) return '';
    return '<p>本轮上限 ' + money(b.limitCny) + ' · 已预留 ' + money(b.reservedCny) + ' · 剩余可预留 ' + money(b.remainingCny) + '</p><p>已知用量估算 ' + money(b.estimatedCny) + '；用量待核对 ' + esc(b.unknownAttempts) + ' 次。失败也保留额度，最终费用以供应商账单为准。</p>';
  }
  document.addEventListener('guide:render', () => {
    const editor = document.getElementById('guide-editor');
    if (!editor || document.getElementById('guide-trial')) return;
    editor.insertAdjacentHTML('afterend', '<details id="guide-trial" class="guide-card"><summary>小额试跑与运行诊断</summary><p>先选上方故事、事实和生成重点。检查条件不会调用模型；生成仍使用上方“生成讲解草稿”。每条手动试跑，不自动批量调用。</p><div class="guide-row"><button type="button" id="gt-check">检查试跑条件（不调用模型）</button><button type="button" id="gt-refresh">刷新本轮记录</button></div><div id="gt-preflight" role="status"></div><div id="gt-status" role="status"></div><div id="gt-records"></div></details>');
  });
  function reviewFields(item) {
    if (!item.active || item.status !== 'completed') return '';
    return '<fieldset data-gt-review="' + esc(item.jobId) + '" data-revision="' + esc(item.reviewRevision) + '"><legend>试跑判断（不会发布内容）</legend>' + Object.entries(choices).map(([key, [label, options]]) => '<label>' + label + '<select data-gt-field="' + key + '"><option value="">请选择</option>' + Object.entries(options).map(([value, text]) => '<option value="' + value + '" ' + (item.review?.[key] === value ? 'selected' : '') + '>' + text + '</option>').join('') + '</select></label>').join('') + '<button type="button" data-gt-save="' + esc(item.jobId) + '">保存试跑判断</button></fieldset>';
  }
  async function refresh() {
    const container = document.getElementById('gt-records');
    if (!container) return;
    const r = await callAiWorker({ action: 'getGuideTrialReport' });
    if (!container.isConnected) return;
    container.innerHTML = budget(r.budget) + '<p>' + esc(r.note) + '</p>' + (r.partial ? '<p>仅展示本轮前 20 条记录，请控制小规模试跑数量。</p>' : '') + (!r.items.length ? '<p>本轮还没有试跑记录。</p>' : '') + r.items.map(item => '<details class="guide-card" data-gt-item="' + esc(item.jobId) + '"><summary>' + esc(item.title) + ' · ' + esc(item.interest) + ' · ' + esc(stages[item.status] || item.status) + (item.simulated ? ' · 本地模拟' : ' · 真实接口任务') + '</summary><p>' + esc(item.model) + ' / ' + esc(item.promptVersion) + ' / ' + esc(item.codeVersion) + '</p><p>来源 ' + esc(item.sourceCount) + ' 条 · 生成 ' + esc(item.charCount) + ' 字 · 任务尝试 ' + esc(item.attempts) + ' 次 · 模型请求 ' + esc(item.providerAttempts) + ' 次</p><p>阶段：' + esc(stages[item.failedStage || item.stage] || item.stage) + '；最近一次任务耗时 ' + (item.elapsedMs == null ? '尚未结束' : esc((item.elapsedMs / 1000).toFixed(1)) + ' 秒') + '</p><p>已知 Token ' + (item.usage ? esc(item.usage.inputTokens) + ' 输入 / ' + esc(item.usage.outputTokens) + ' 输出（重试累计）' : '未返回') + ' · 预留 ' + money(item.reservedCny) + ' · 估算费用 ' + money(item.estimatedCny) + '</p>' + (item.error ? '<p>' + esc(item.error.message) + '。' + esc(item.error.nextStep) + '</p>' : '') + (item.grounding ? '<p>生成已拦截：</p>'+item.grounding.issues.map(i=>'<p>'+esc(i.message)+'：'+esc(i.text)+'</p>').join('') : '') + (!item.active ? '<p>来源或授权已变化，样本停用；保留费用记录。</p>' : '') + (item.canRetry ? '<button type="button" data-gt-retry="' + esc(item.jobId) + '">在剩余额度内重试</button>' : '') + (item.fragmentId ? '<button type="button" data-guide-edit="' + esc(item.fragmentId) + '">打开草稿核对来源</button>' : '') + '<p>正式审核记录：' + (item.quality.length ? item.quality.map(q => esc(q.decision === 'approve' ? '通过' : '驳回') + ' / ' + esc({ correct: '正确', partial: '部分正确', incorrect: '错误' }[q.humanRating] || '未判断') + (q.modified ? ' / 已修改' : '')).join('；') : '尚无') + '</p>' + reviewFields(item) + '</details>').join('');
  }
  box.addEventListener('click', async e => {
    const button = e.target.closest('button');
    if (!button || !button.closest('#guide-trial') || button.dataset.guideEdit) return;
    const status = document.getElementById('gt-status');
    button.disabled = true;
    status.textContent = '处理中…';
    try {
      if (button.id === 'gt-check') {
        const r = await callAiWorker({ action: 'checkGuideTrial', storyId: document.getElementById('gf-story').value, claimIds: [...box.querySelectorAll('[data-gf-claim]:checked')].map(n => n.dataset.gfClaim), interest: document.getElementById('gf-interest').value });
        const target = document.getElementById('gt-preflight');
        if (target) target.innerHTML = '<p>' + (r.ready ? '基础条件就绪；实际网络与调用仍待验证。' : '暂不具备试跑条件。') + '模式：' + esc({ off: '关闭', mock: '本地模拟', real: '真实接口' }[r.mode] || '关闭') + '</p><p>来源 ' + esc(r.sourceCount) + ' 条 / 事实 ' + esc(r.claimCount) + ' 条；单次请求预计预留 ' + money(r.estimateCny) + '</p>' + budget(r.budget) + r.blockers.map(b => '<p>' + esc(b.message) + '。' + esc(b.nextStep) + '</p>').join('') + '<p>' + esc(r.note) + '</p>';
      } else if (button.id === 'gt-refresh') await refresh();
      else if (button.dataset.gtRetry) {
        await callAiWorker({ action: 'retryGuideTrial', jobId: button.dataset.gtRetry });
        await refresh();
      } else if (button.dataset.gtSave) {
        const fieldset = button.closest('[data-gt-review]');
        const values = Object.fromEntries([...fieldset.querySelectorAll('[data-gt-field]')].map(n => [n.dataset.gtField, n.value]));
        if (Object.values(values).some(v => !v)) throw Error('请补齐五项判断');
        await callAiWorker({ action: 'saveGuideTrialReview', jobId: button.dataset.gtSave, revision: Number(fieldset.dataset.revision), ...values });
        await refresh();
      }
      if (status.isConnected) status.textContent = '操作完成。试跑判断不会自动发布，也不会自动加入固定验收集。';
    } catch (err) {
      if (status.isConnected) status.textContent = err.message;
    } finally { button.disabled = false; }
  });
})();
