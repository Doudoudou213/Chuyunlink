/* Administrator-only entry; authoritative checks remain inside adminSubmissions. */
(() => {
  'use strict';
  const anchor = document.getElementById('redemption-refresh') || document.getElementById('story-themes-refresh');
  if (!anchor) return;
  const entry = document.createElement('button'); entry.type = 'button';
  entry.className = anchor.className; entry.textContent = '徽章核验'; entry.dataset.adminView = 'badges';
  anchor.after(entry);
  const categories = { architecture: '古建筑', music: '乐器 / 礼乐器物', artifact: '器物', pattern: '纹样', inscription: '碑刻题记', oral: '口述', landscape: '文化景观', document: '文献与资料' };
  const flags = { patternDetails: '已核对纹样特写、所在部位与说明', inscriptionTranscript: '已核对碑刻影像与文字整理',
    oralAuthorization: '已核对讲述者录制及使用授权、身份类别和口述摘要', artifactDetails: '已核对器物整体、细节影像及工艺观察',
    onsite: '已核对该地点的实地采集材料', citedCorrection: '已核实纠错出处，确认有效采纳' };
  const box = document.getElementById('list');
  let sequence = 0;
  entry.addEventListener('click', () => {
    const session = ++sequence;
    setActiveView('badges', '徽章核验');
    box.innerHTML = `<section class="effect-panel" id="admin-badge-panel">
      <h2>为贡献留下核验依据</h2><p>先完成原材料审核，再补充徽章条件。这里只核验依据，不直接给用户发章或积分。</p>
      <form id="badge-source-form" class="effect-filters">
        <label>材料类型<select name="sourceType"><option value="submission">已通过的投稿</option><option value="supplement">已通过的补充</option><option value="feedback">已采纳的故事纠错</option></select></label>
        <label>材料编号<input name="sourceId" required maxlength="128" pattern="[A-Za-z0-9_-]+" placeholder="从对应管理栏目复制编号"></label>
        <button type="submit">读取材料</button>
      </form><p id="badge-admin-message" role="status"></p><div id="badge-evidence-editor"></div></section>`;
    const form = document.getElementById('badge-source-form');
    const status = document.getElementById('badge-admin-message');
    const editor = document.getElementById('badge-evidence-editor');
    let lookupToken = 0;
    const present = () => session === sequence && document.getElementById('admin-badge-panel')?.contains(status);
    form.addEventListener('input', () => { lookupToken++; editor.replaceChildren(); });
    form.addEventListener('submit', async event => {
      event.preventDefault(); const token = ++lookupToken;
      const source = { sourceType: form.elements.sourceType.value, sourceId: form.elements.sourceId.value.trim() };
      status.textContent = '正在读取材料…'; editor.replaceChildren();
      try {
        const data = await callAdmin({ action: 'getBadgeEvidence', ...source });
        if (!present() || token !== lookupToken) return;
        status.textContent = data.evidence?.stale ? '原始材料有变化，请重新核对后保存。' : '请核对原材料，只勾选有依据的条件。';
        const heading = document.createElement('h3'); heading.textContent = data.title;
        const summary = document.createElement('p'); summary.textContent = data.description;
        editor.append(heading, summary);
        if (data.fileUrl) { const link = document.createElement('a'); link.href = data.fileUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '打开原始材料'; editor.append(link); }
        const edit = document.createElement('form'); edit.className = 'badge-admin-fields';
        edit.innerHTML = `<label>内容类别<select name="category">${Object.entries(categories).map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label>
          <label>统一对象资源编号<input name="resourceId" maxlength="128" placeholder="按同一对象去重，不能用投稿编号替代"></label>
          <label>实地采集地点编号<input name="placeId" maxlength="128" placeholder="同一地点使用同一已发布资源编号"></label>
          <label>纠错问题编号<input name="issueKey" maxlength="128" placeholder="同一个问题必须使用相同编号"></label>
          <fieldset><legend>已核对的条件</legend>${Object.entries(flags).filter(([key]) => source.sourceType === 'submission' ? key !== 'citedCorrection' : source.sourceType === 'feedback' && key === 'citedCorrection').map(([key, label]) => `<label><input type="checkbox" name="${key}"> ${label}</label>`).join('')}</fieldset>
          <label>核验依据<textarea name="note" rows="4" minlength="10" maxlength="1000" required placeholder="写清材料位置、出处或授权记录位置；不要填写证件或联系方式"></textarea></label>
          <label class="badge-admin-attestation"><input type="checkbox" name="humanReviewed" required> 我已查看原材料，并核对以上分类和条件</label>
          <div class="badge-admin-actions"><button type="submit">保存核验</button><button type="button" data-badge-revoke>撤销核验</button></div>`;
        const previous = data.evidence || {};
        edit.elements.placeId.closest('label').hidden = source.sourceType !== 'submission';
        edit.elements.issueKey.closest('label').hidden = source.sourceType !== 'feedback';
        edit.querySelector('fieldset').hidden = source.sourceType === 'supplement';
        let revision = previous.revision || 0;
        ['category', 'resourceId', 'placeId', 'issueKey', 'note'].forEach(key => {
          edit.elements[key].value = previous[key] || (key === 'resourceId' ? data.resourceId : key === 'category' ? 'document' : '') || '';
        });
        Object.keys(flags).forEach(key => { if (edit.elements[key]) edit.elements[key].checked = previous[key] === true; });
        const revoke = edit.querySelector('[data-badge-revoke]'); revoke.disabled = !revision || previous.status === 'revoked';
        async function save(nextStatus) {
          if (!present() || token !== lookupToken) return;
          const payload = { action: 'saveBadgeEvidence', ...source, revision, status: nextStatus };
          ['category', 'resourceId', 'placeId', 'issueKey', 'note'].forEach(key => { payload[key] = edit.elements[key].value.trim(); });
          Object.keys(flags).forEach(key => { payload[key] = edit.elements[key]?.checked === true; });
          payload.humanReviewed = edit.elements.humanReviewed.checked;
          if (payload.note.length < 10) { status.textContent = '请填写至少十字的核验或撤销原因。'; return; }
          edit.querySelectorAll('button').forEach(b => { b.disabled = true; });
          let saved = false;
          try {
            const result = await callAdmin(payload);
            if (!present() || token !== lookupToken) return;
            revision = result.revision;
            saved = true;
            status.textContent = nextStatus === 'revoked' ? '核验已撤销，用户下次查询时将重新判断资格。' : '核验已保存，用户可以刷新徽章进度。';
            revoke.disabled = nextStatus === 'revoked';
          } catch (error) { if (present() && token === lookupToken) status.textContent = error.message || '保存失败，请重试'; }
          finally {
            edit.querySelector('button[type="submit"]').disabled = false;
            if (!saved) revoke.disabled = !revision || previous.status === 'revoked';
          }
        }
        edit.addEventListener('submit', event => { event.preventDefault(); save('confirmed'); });
        revoke.addEventListener('click', () => { if (confirm('撤销此材料的徽章核验？原投稿与已有积分会保留。')) save('revoked'); });
        editor.append(edit);
      } catch (error) { if (present() && token === lookupToken) status.textContent = error.message || '读取失败，请重试'; }
    });
  });
})();
