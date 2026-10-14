/* Paper gallery; progress and claims are verified by the authenticated service. */
(() => {
  'use strict';
  function initialize() {
    const api = window.ChuBadgeCatalog;
    const grid = document.getElementById('paper-badge-catalog');
    const preview = document.querySelector('#paper-profile-badges .paper-profile-badge-row');
    const dialog = document.getElementById('paper-badge-dialog');
    const profile = document.getElementById('view-profile');
    if (!api || !grid || !preview || !dialog || !profile || grid.dataset.ready) return;
    grid.dataset.ready = 'true';
    // Preview buttons must work while the full gallery's parent is collapsed.
    document.body.append(dialog);
    let opener = null;
    let request = null;
    let scrollLock = null;
    const byId = id => document.getElementById(id);
    function image(badge, small = false) {
      const img = document.createElement('img');
      img.src = badge.image;
      img.alt = '';
      img.width = 512;
      img.height = 512;
      img.style.setProperty('--badge-art-scale', badge.artScale);
      img.decoding = 'async';
      img.loading = small ? 'eager' : 'lazy';
      img.addEventListener('error', () => {
        img.hidden = true;
        img.parentElement.classList.add('badge-art-unavailable');
        const notice = document.createElement('span');
        notice.className = 'badge-image-fallback';
        notice.textContent = '图样暂未载入';
        img.after(notice);
      }, { once: true });
      return img;
    }
    function button(badge, small = false) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = small ? 'paper-badge-preview-item' : 'paper-badge-item';
      item.dataset.badgeId = badge.id;
      item.setAttribute('aria-label', badge.name + '，查看图样与获取条件');
      item.setAttribute('aria-haspopup', 'dialog');
      item.setAttribute('aria-controls', 'paper-badge-dialog');
      const title = document.createElement('span');
      title.className = 'paper-badge-name';
      title.textContent = badge.name;
      item.append(image(badge, small), title);
      if (!small) {
        const group = document.createElement('span');
        group.className = 'paper-badge-group';
        group.textContent = badge.group;
        item.append(group);
      }
      item.addEventListener('click', () => open(badge, item));
      return item;
    }
    function release() {
      request?.abort();
      request = null;
      if (scrollLock) {
        document.documentElement.style.overflow = scrollLock.html;
        document.body.style.overflow = scrollLock.body;
        scrollLock = null;
      }
      if (opener?.isConnected && !profile.classList.contains('hidden')) opener.focus({ preventScroll: true });
      opener = null;
    }
    async function open(badge, target) {
      request?.abort();
      request = new AbortController();
      const currentRequest = request;
      opener = target;
      byId('paper-badge-dialog-title').textContent = badge.name;
      byId('paper-badge-dialog-theme').textContent = badge.theme;
      byId('paper-badge-dialog-story').textContent = badge.story;
      byId('paper-badge-dialog-note').textContent = badge.note;
      const artwork = image(badge, true);
      artwork.alt = badge.alt;
      byId('paper-badge-dialog-art').replaceChildren(artwork);
      byId('paper-badge-dialog-art').classList.remove('badge-art-unavailable');
      byId('paper-badge-dialog-rules').replaceChildren(...badge.requirements.map(requirement => {
        const li = document.createElement('li');
        li.textContent = requirement.label;
        return li;
      }));
      const status = byId('paper-badge-dialog-status');
      status.textContent = '正在核对获取进度…';
      status.dataset.eligibility = 'loading';
      const render = result => {
        status.dataset.eligibility = result.status;
        const labels = {
          login_required: '登录后查看你的获取进度', not_connected: '图样已收录 · 获取条件核验暂未开放',
          in_progress: '继续记录，下一件藏品等你来点亮', eligible: '条件已达成，可以收下这枚徽章',
          earned: '已收入你的荆楚徽章图鉴', needs_review: '相关采集状态有变化，徽章暂待复核'
        };
        status.replaceChildren(document.createTextNode(labels[result.status] || '暂无法查询获取状态'));
        if (result.progress?.length) {
          const progress = document.createElement('ul');
          progress.className = 'paper-badge-progress';
          result.progress.forEach((p, index) => {
            const item = document.createElement('li');
            item.textContent = badge.requirements[index].label + ' ' + (p.current === null ? '待接入核验' : `${p.current} / ${p.target}`);
            progress.append(item);
          });
          status.append(progress);
        }
        if (badge.id === 'lamplight' && result.status === 'in_progress') {
          const learn = document.createElement('button');
          learn.type = 'button'; learn.className = 'paper-badge-claim'; learn.textContent = '开始采集小课';
          learn.addEventListener('click', () => startLesson());
          status.append(learn);
        }
        if (result.status === 'eligible' || result.status === 'login_required') {
          const action = document.createElement('button');
          action.type = 'button';
          action.className = 'paper-badge-claim';
          action.textContent = result.status === 'login_required' ? '去登录' : '收下徽章';
          action.addEventListener('click', async () => {
            if (result.status === 'login_required') { dialog.close(); window.openCloudLogin?.(); return; }
            action.disabled = true;
            action.textContent = '正在核验…';
            try {
              const next = await api.claim(badge.id, { signal: currentRequest.signal });
              if (request === currentRequest && !currentRequest.signal.aborted && dialog.open) render(next);
            } catch (error) {
              if (request !== currentRequest || currentRequest.signal.aborted || !dialog.open) return;
              action.disabled = false;
              action.textContent = '重新核验并领取';
              const notice = status.querySelector('.paper-badge-error') || document.createElement('span');
              notice.className = 'paper-badge-error';
              notice.textContent = '暂未完成领取，请重试；已领取的徽章不会重复发放。';
              status.append(notice);
            }
          });
          status.append(action);
        }
      };
      async function startLesson(lessonId) {
        status.textContent = '正在展开小课…';
        try {
          const result = await api.lesson(lessonId, { signal: currentRequest.signal });
          if (request !== currentRequest || currentRequest.signal.aborted || !dialog.open) return;
          if (result.complete) {
            const checked = await api.checkEligibility(badge.id, { signal: currentRequest.signal });
            if (request === currentRequest && !currentRequest.signal.aborted && dialog.open) render(checked);
            return;
          }
          const lesson = result.lesson;
          if (!lesson || !Array.isArray(lesson.options) || lesson.options.length > 6) throw new Error('课程暂不可用');
          status.replaceChildren();
          const title = document.createElement('h3'); title.textContent = lesson.title;
          const body = document.createElement('p'); body.textContent = lesson.body;
          const question = document.createElement('p'); question.textContent = lesson.question;
          const options = document.createElement('div'); options.className = 'paper-badge-lesson-options';
          const response = document.createElement('p'); response.setAttribute('role', 'status');
          lesson.options.forEach((label, index) => {
            const option = document.createElement('button'); option.type = 'button'; option.textContent = label;
            option.addEventListener('click', async () => {
              options.querySelectorAll('button').forEach(b => { b.disabled = true; });
              response.textContent = '正在核对答案…';
              try {
                const checked = await api.answer(lesson.id, lesson.token, index, { signal: currentRequest.signal });
                if (request !== currentRequest || currentRequest.signal.aborted || !dialog.open) return;
                response.textContent = (checked.correct ? '答对了。' : '再想一想。') + checked.explanation;
                const next = document.createElement('button'); next.type = 'button'; next.className = 'paper-badge-claim';
                next.textContent = checked.correct ? '继续下一课' : '再学一次';
                next.addEventListener('click', () => startLesson(checked.correct ? undefined : lesson.id));
                status.append(next);
              } catch (error) {
                if (request !== currentRequest || currentRequest.signal.aborted || !dialog.open) return;
                response.textContent = '本次答案暂未确认，可以重试。';
                options.querySelectorAll('button').forEach(b => { b.disabled = false; });
              }
            });
            options.append(option);
          });
          status.append(title, body, question, options, response);
        } catch (error) {
          if (request !== currentRequest || currentRequest.signal.aborted || !dialog.open) return;
          status.textContent = '小课暂未载入，请稍后重新打开。';
        }
      }
      if (!dialog.open) {
        dialog.showModal();
        scrollLock = { html: document.documentElement.style.overflow, body: document.body.style.overflow };
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
      }
      dialog.scrollTop = 0;
      byId('paper-badge-dialog-close').focus({ preventScroll: true });
      try {
        const result = await api.checkEligibility(badge.id, { signal: currentRequest.signal });
        if (request !== currentRequest || currentRequest.signal.aborted || !dialog.open) return;
        render(result);
      } catch (error) {
        if (error.name !== 'AbortError' && request === currentRequest && dialog.open) {
          status.dataset.eligibility = 'unavailable';
          status.textContent = '暂无法查询获取状态，请稍后重新打开。图样仍可浏览。';
        }
      }
    }
    preview.replaceChildren(...api.catalog.slice(0, 3).map(badge => button(badge, true)));
    grid.replaceChildren(...api.catalog.map(badge => button(badge)));
    byId('paper-badge-dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', release);
    // Do not dismiss while selecting rules inside the sheet.
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    new MutationObserver(() => {
      if (profile.classList.contains('hidden') && dialog.open) dialog.close();
    }).observe(profile, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
