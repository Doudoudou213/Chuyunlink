(function (root) {
  'use strict';
  // A question-led index into the current editorial draft. No chat, model calls,
  // storage, invented answers, visit registration or second modal.
  function create(host, hooks = {}) {
    if (!host || !root.ChuJourneyInquiryData) return null;
    const main = document.getElementById('journey-reading-main'), audio = document.getElementById('audio');
    if (!main) return null;
    host.innerHTML = '<button type="button" id="journey-inquiry-entry" aria-expanded="false" aria-controls="journey-inquiry-panel"><span>问这一景</span><span aria-hidden="true">循文找答 ↗</span></button>' +
      '<div id="journey-inquiry-panel" hidden><button type="button" id="journey-inquiry-back">← 回到原文</button>' +
      '<h3 id="journey-inquiry-heading" tabindex="-1">问这一景</h3><p class="journey-inquiry-note">研究稿摘读 · 未审，非 AI 生成</p>' +
      '<div id="journey-inquiry-options" role="group" aria-label="选择一个关于本景的问题"></div>' +
      '<p id="journey-inquiry-status" role="status" aria-live="polite"></p>' +
      '<article id="journey-inquiry-answer" tabindex="-1" aria-label="研究稿相关段落" hidden></article>' +
      '<ol id="journey-inquiry-sources" aria-label="本段对应出处" hidden></ol>' +
      '<p class="journey-inquiry-note">摘录现有研究稿，不是现场信息；正式导览仍需人工审稿与核验。</p></div>';
    const $ = id => host.querySelector('#'+id);
    const entry = $('journey-inquiry-entry'), panel = $('journey-inquiry-panel'), back = $('journey-inquiry-back');
    const options = $('journey-inquiry-options'), answer = $('journey-inquiry-answer'), sources = $('journey-inquiry-sources'), status = $('journey-inquiry-status');
    let revision = 0, questions = [], signature = '', shown = false, scroll = null, audioWasHidden = false;
    const contentSignature = items => JSON.stringify([hooks.revision?.() || null,items]);
    function usable() {
      if (document.hidden || host.hidden || !host.getClientRects().length) return false;
      const dialog = host.closest('dialog');
      return !dialog || (dialog.open && dialog.dataset.state !== 'closing' && dialog.getAttribute('aria-busy') === 'false');
    }
    function eraseAnswer() {
      answer.hidden = true;answer.replaceChildren();sources.hidden = true;sources.replaceChildren();
      for (const button of options.children) button.setAttribute('aria-pressed','false');
    }
    function cancel() {
      revision++;entry.removeAttribute('aria-busy');
      for (const button of options.children) button.removeAttribute('aria-busy');
      status.textContent = '';
    }
    function reset({restore = false} = {}) {
      cancel();eraseAnswer();options.replaceChildren();
      panel.hidden = true;entry.hidden = false;entry.setAttribute('aria-expanded','false');main.hidden = false;
      if (shown && audio) audio.hidden = audioWasHidden;
      shown = false;
      if (restore && !host.hidden && entry.getClientRects().length) {
        entry.focus({preventScroll:true});
        if (scroll?.element?.isConnected) scroll.element.scrollTop = scroll.top;
        else if (scroll) window.scrollTo({top:scroll.top,behavior:'instant'});
      }
      scroll = null;
    }
    function clear() {
      reset();questions = [];signature = '';host.hidden = true;
    }
    function mount(items) {
      clear();
      if (!Array.isArray(items) || !items.length) return;
      questions = items;signature = contentSignature(items);host.hidden = false;
    }
    function paintOptions() {
      options.replaceChildren();
      for (const question of questions) {
        const button = document.createElement('button');button.type = 'button';
        button.dataset.question = question.id;button.textContent = question.label;
        button.setAttribute('aria-pressed','false');button.setAttribute('aria-controls',answer.id);
        button.addEventListener('click',() => choose(question.id,button));options.append(button);
      }
    }
    function accept(items) {
      if (!Array.isArray(items) || !items.length) {clear();return false;}
      questions = items;signature = contentSignature(items);return true;
    }
    async function open() {
      if (!usable() || entry.getAttribute('aria-busy') === 'true') return;
      const ticket = ++revision;entry.setAttribute('aria-busy','true');
      try {
        const latest = await hooks.verify?.();
        if (ticket !== revision || !usable()) return;
        if (!accept(latest)) return;
        const body = host.closest('#journey-leaf-body');
        scroll = {element:body,top:body ? body.scrollTop : window.scrollY};
        shown = true;audioWasHidden = audio?.hidden || false;hooks.onEnter?.();
        main.hidden = true;if (audio) audio.hidden = true;
        entry.hidden = true;entry.setAttribute('aria-expanded','true');panel.hidden = false;
        paintOptions();eraseAnswer();status.textContent = '选一个问题，查看原文与出处。';
        if (body) body.scrollTop = 0;
        $('journey-inquiry-heading').focus({preventScroll:Boolean(body)});
      } catch { /* Controller removes expired or withdrawn content. */ }
      finally {if (ticket === revision) entry.removeAttribute('aria-busy');}
    }
    async function choose(id,button) {
      if (!shown || !usable() || button.getAttribute('aria-busy') === 'true') return;
      const ticket = ++revision, previous = signature;
      for (const item of options.children) item.removeAttribute('aria-busy');
      eraseAnswer();button.setAttribute('aria-busy','true');status.textContent = '正在核对这一段……';
      try {
        const latest = await hooks.verify?.();
        if (ticket !== revision || !shown || !usable()) return;
        if (!accept(latest)) return;
        if (signature !== previous) {
          paintOptions();status.textContent = '问题或资料已更新，请重新选择。';options.firstElementChild?.focus({preventScroll:true});return;
        }
        const question = questions.find(item => item.id === id);
        if (!question) {eraseAnswer();return;}
        const heading = document.createElement('h4');heading.textContent = question.label;answer.append(heading);
        for (const text of question.paragraphs) {
          const paragraph = document.createElement('p');paragraph.textContent = text;answer.append(paragraph);
        }
        for (const source of question.sources) {
          const li = document.createElement('li'), link = document.createElement('a'), excerpt = document.createElement('p'), credit = document.createElement('p');
          link.href = source.url;link.rel = 'noopener noreferrer';link.target = '_blank';link.textContent = source.title+' ↗';
          excerpt.textContent = source.excerpt;credit.textContent = source.credit;credit.className = 'journey-inquiry-note';
          li.append(link,excerpt,credit);sources.append(li);
        }
        button.setAttribute('aria-pressed','true');answer.hidden = false;sources.hidden = false;
        status.textContent = '已找到对应原文，下方可查阅出处。';answer.focus({preventScroll:true});
        answer.scrollIntoView({block:'nearest',behavior:'instant'});
      } catch { /* The outer gate owns error/retry state, never a cached answer. */ }
      finally {if (ticket === revision) button.removeAttribute('aria-busy');}
    }
    // Background rechecks can revoke or revise the optional capability even if
    // the reading fingerprint itself did not change.
    function reconcile(items) {
      if (host.hidden) return;
      const next = contentSignature(items || []);
      if (next === signature) return;
      const focused = host.contains(document.activeElement);
      const hadPanel = shown;
      cancel();eraseAnswer();
      if (!accept(items)) {
        if (focused) {
          const target = document.getElementById('reading-copy')?.closest('dialog')?.querySelector('h2') ||
            document.querySelector('#reading > summary');
          target?.focus({preventScroll:true});
        }
        return;
      }
      if (hadPanel) {
        paintOptions();status.textContent = '问题或资料已更新，请重新选择。';
        if (focused) options.firstElementChild?.focus({preventScroll:true});
      }
    }
    entry.addEventListener('click',open);back.addEventListener('click',() => reset({restore:true}));
    return {mount,reset,cancel,clear,reconcile};
  }
  root.ChuJourneyInquiry = {create};
})(window);
