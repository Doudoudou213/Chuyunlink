(function () {
  const ENV_ID = 'chulink-legacy-d8god1687a5d60743';
  const REGION = 'ap-shanghai';
  const CORE_FUNCTION = 'appCore';
  const AI_REVIEW_FUNCTION = 'aiReview';
  const AI_REVIEW_ENABLED = window.CHULINK_AI_REVIEW_ENABLED === true;
  const MAX_FILE_BYTES = 25 * 1024 * 1024;

  let cloudApp = null;
  let cloudAuth = null;
  let cloudUser = null;
  let bootstrapPromise = null;
  let latestBootstrap = null;
  let activeInteractionSubmissionId = '';
  let activeInteractionTarget = null;
  let activeReplyCommentId = '';
  let loadedInteractionComments = [];
  let interactionHasMoreComments = false;
  let activeReportTargetType = 'submission';
  let activeReportTargetId = '';
  let activeSubmissionFilter = 'all';
  let activeCloudSupplement = null;
  let registerVerificationInfo = null;
  let resetVerificationInfo = null;
  let cloudNotifications = [];
  let cloudNotificationUnreadCount = 0;
  const cloudSupplementState = new Map();
  let publicFeedRefreshTimer = null;
  const PUBLIC_FEED_REFRESH_MS = 60 * 1000;
  const legacyToggleSubmissionLike = typeof toggleSubmissionLike === 'function'
    ? toggleSubmissionLike
    : null;
  const legacyOpenDiscoverDetail = typeof openDiscoverDetail === 'function'
    ? openDiscoverDetail
    : null;
  const legacyTriggerDiscoverSupplementUpload = typeof triggerDiscoverSupplementUpload === 'function'
    ? triggerDiscoverSupplementUpload
    : null;
  const legacyRenderSupplementSlots = typeof renderSupplementSlots === 'function'
    ? renderSupplementSlots
    : null;
  const legacyHandleDiscoverSupplementUpload = typeof handleDiscoverSupplementUpload === 'function'
    ? handleDiscoverSupplementUpload
    : null;

  function safeText(value) {
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function statusLabel(status) {
    return {
      pending: '待审核',
      approved: '已通过',
      rejected: '已拒绝',
      needs_revision: '需修改'
    }[status] || status || '未知';
  }

  function statusClass(status) {
    return {
      pending: 'border-amber-200 bg-amber-50 text-amber-700',
      approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      rejected: 'border-red-200 bg-red-50 text-red-700',
      needs_revision: 'border-blue-200 bg-blue-50 text-blue-700'
    }[status] || 'border-stone-200 bg-stone-50 text-stone-600';
  }

  function displayDate(value) {
    if (!value) return '刚刚';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '刚刚' : date.toLocaleString('zh-CN');
  }

  function notificationTypeLabel(type) {
    return {
      comment_reply: '评论回复',
      submission_comment: '投稿互动',
      comment_hidden: '内容处理',
      comment_restored: '内容恢复',
      report_resolved: '举报处理',
      report_dismissed: '举报复核',
      feedback_resolved: '反馈回复',
      feedback_closed: '反馈处理'
    }[type] || '互动消息';
  }

  function updateNotificationEntry() {
    const stable = isStableAccount(cloudUser);
    const entry = document.getElementById('header-notification-entry');
    const badge = document.getElementById('header-notification-badge');
    if (entry) {
      entry.classList.toggle('hidden', !stable);
      entry.classList.toggle('flex', stable);
    }
    if (badge) {
      badge.textContent = cloudNotificationUnreadCount > 99 ? '99+' : String(cloudNotificationUnreadCount);
      badge.classList.toggle('hidden', !stable || cloudNotificationUnreadCount === 0);
    }
  }

  function renderCloudNotifications() {
    const list = document.getElementById('cloud-notification-list');
    const summary = document.getElementById('cloud-notification-summary');
    const readAll = document.getElementById('cloud-notification-read-all');
    updateNotificationEntry();
    if (!list || !summary) return;
    summary.textContent = cloudNotificationUnreadCount
      ? `${cloudNotificationUnreadCount} 条未读消息`
      : '消息均已读';
    if (readAll) readAll.classList.toggle('hidden', cloudNotificationUnreadCount === 0);
    list.innerHTML = cloudNotifications.length ? cloudNotifications.map((item) => `
      <button type="button" data-notification-id="${safeText(item.id)}" class="block w-full rounded-xl border ${item.isRead ? 'border-stone-200 bg-white' : 'border-sandGold/40 bg-sandGold/5'} p-3 text-left transition hover:border-deepTeal/30">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="rounded-full ${item.isRead ? 'bg-stone-100 text-stone-500' : 'bg-deepTeal text-sandGold'} px-2 py-0.5 text-[9px] font-bold">${safeText(notificationTypeLabel(item.type))}</span>
              ${item.actorName ? `<span class="text-[9px] text-stone-400">${safeText(item.actorName)}</span>` : ''}
            </div>
            <p class="mt-2 text-xs font-bold text-stone-800">${safeText(item.title || '互动消息')}</p>
            <p class="mt-1 line-clamp-2 text-[10px] leading-relaxed text-stone-600">${safeText(item.message || '')}</p>
            <p class="mt-1.5 text-[9px] text-stone-400">${safeText(displayDate(item.createdAt))}${item.targetTitle ? ` · ${safeText(item.targetTitle)}` : ''}</p>
          </div>
          ${item.isRead ? '' : '<span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-cinnabarRed"></span>'}
        </div>
      </button>
    `).join('') : '<div class="rounded-xl border border-stone-200 bg-stone-50 p-6 text-center text-xs text-stone-500">暂时没有互动消息。</div>';
  }

  async function loadCloudNotifications() {
    if (!isStableAccount(cloudUser)) {
      cloudNotifications = [];
      cloudNotificationUnreadCount = 0;
      updateNotificationEntry();
      return;
    }
    try {
      const result = await callCore({ action: 'getNotifications', limit: 40 });
      cloudNotifications = result.items || [];
      cloudNotificationUnreadCount = Number(result.unreadCount || 0);
      renderCloudNotifications();
    } catch (error) {
      console.warn('[CloudBase notifications]', error);
    }
  }

  async function openCloudNotifications() {
    try {
      await requireInteractiveAccount();
      const modal = document.getElementById('cloud-notification-modal');
      if (modal) modal.classList.remove('hidden');
      await loadCloudNotifications();
      if (window.lucide) lucide.createIcons();
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message, 'alert-circle');
    }
  }

  function closeCloudNotifications() {
    const modal = document.getElementById('cloud-notification-modal');
    if (modal) modal.classList.add('hidden');
  }

  async function openCloudNotification(notificationId) {
    const item = cloudNotifications.find((notification) => notification.id === notificationId);
    if (!item) return;
    if (!item.isRead) {
      try {
        await callCore({ action: 'markNotificationRead', notificationId });
        item.isRead = true;
        cloudNotificationUnreadCount = Math.max(0, cloudNotificationUnreadCount - 1);
        renderCloudNotifications();
      } catch (error) {
        if (typeof showToast === 'function') showToast(error.message, 'alert-circle');
        return;
      }
    }
    closeCloudNotifications();
    if (item.targetType && item.targetId) {
      openCloudDiscussion(item.targetType, item.targetId, item.targetTitle || '内容讨论');
    }
  }

  async function markAllCloudNotificationsRead() {
    try {
      await callCore({ action: 'markNotificationRead', all: true });
      cloudNotifications.forEach((item) => { item.isRead = true; });
      cloudNotificationUnreadCount = 0;
      renderCloudNotifications();
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message, 'alert-circle');
    }
  }

  function reviewStageLabel(status) {
    return {
      not_requested: '等待人工复核',
      queued: '初审排队中',
      processing: '初审中',
      completed: '初审完成，待人工复核',
      failed: '已转人工复核',
      enqueue_failed: '已转人工复核'
    }[status] || '等待人工复核';
  }

  function maskedUid(uid) {
    const value = String(uid || '');
    if (value.length <= 8) return value;
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
  }

  function randomPart() {
    return Math.random().toString(36).slice(2, 10);
  }

  function fileExtension(file) {
    const fileName = String(file && file.name || '');
    const matched = fileName.match(/\.([a-zA-Z0-9]{1,8})$/);
    if (matched) return matched[1].toLowerCase();
    const mimeMap = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
      'video/mp4': 'mp4',
      'video/webm': 'webm'
    };
    return mimeMap[file && file.type] || 'bin';
  }

  async function ensureCloudUser() {
    if (!window.cloudbase) throw new Error('CloudBase SDK 加载失败');
    if (!cloudApp) {
      cloudApp = window.cloudbase.init({ env: ENV_ID, region: REGION });
      cloudAuth = cloudApp.auth({ persistence: 'local' });
    }
    let state = await cloudAuth.getLoginState();
    if (!state) {
      await cloudAuth.anonymousAuthProvider().signIn();
      state = await cloudAuth.getLoginState();
    }
    cloudUser = state && state.user;
    if (!cloudUser || !(cloudUser.uid || cloudUser.id)) {
      throw new Error('没有取得 CloudBase 用户身份');
    }
    return cloudUser;
  }

  async function callCloudFunction(name, data) {
    await ensureCloudUser();
    const response = await cloudApp.callFunction({ name, data });
    let result = response && response.result !== undefined ? response.result : response;
    if (typeof result === 'string') {
      try { result = JSON.parse(result); } catch (_) {}
    }
    return result;
  }

  async function callCore(data) {
    const result = await callCloudFunction(CORE_FUNCTION, data);
    if (!result || result.ok !== true) {
      const error = result && result.error;
      const failure = new Error(error && error.message ? error.message : '云端请求失败');
      failure.code = error && error.code ? error.code : 'FUNCTION_FAILED';
      throw failure;
    }
    return result;
  }

  async function planCloudRoute(payload = {}) {
    return callCore({
      action: 'planRoute',
      mode: payload.mode || 'transit',
      points: Array.isArray(payload.points) ? payload.points : []
    });
  }

  function deferredAiReview(regionName) {
    return {
      approved: false,
      decision: 'needs_review',
      qualityScore: 0,
      category: '待人工复核素材',
      provider: 'manual-review',
      aiUsed: false,
      issues: ['ai_review_not_enabled'],
      suggestions: [`素材已保存到 ${regionName || '湖北'} 的 CloudBase 待审核池，等待管理员人工确认。`]
    };
  }

  async function requestCloudAiReview(payload = {}) {
    if (!AI_REVIEW_ENABLED) {
      return { status: 202, data: deferredAiReview(payload.regionName) };
    }
    const result = await callCloudFunction(AI_REVIEW_FUNCTION, {
      action: 'precheck',
      regionName: payload.regionName || '湖北',
      assetType: payload.assetType || 'image',
      fileName: payload.fileName || '',
      location: payload.locationPayload || null
    });
    if (!result || result.ok !== true) {
      const error = result && result.error;
      throw new Error(error && error.message ? error.message : '云端 AI 初筛失败');
    }
    return {
      status: Number(result.status) || 200,
      data: result.review || result
    };
  }

  async function verifyCloudLocation(payload = {}) {
    if (!AI_REVIEW_ENABLED) {
      return {
        status: 200,
        data: { success: true, regionName: '湖北', provider: 'browser-gps' }
      };
    }
    const result = await callCloudFunction(AI_REVIEW_FUNCTION, {
      action: 'verifyLocation',
      location: payload
    });
    if (!result || result.ok !== true) {
      const error = result && result.error;
      throw new Error(error && error.message ? error.message : '云端定位校验失败');
    }
    return {
      status: Number(result.status) || 200,
      data: result.location || result
    };
  }

  async function enqueueCloudAiReview(submissionId) {
    if (!AI_REVIEW_ENABLED || !submissionId) {
      return { enabled: false, status: 'not_requested' };
    }
    try {
      const result = await callCloudFunction(AI_REVIEW_FUNCTION, {
        action: 'enqueue',
        submissionId
      });
      if (!result || result.ok !== true) {
        const error = result && result.error;
        throw new Error(error && error.message ? error.message : 'AI 审核排队失败');
      }
      return {
        enabled: true,
        status: result.status || 'queued',
        taskId: result.taskId || ''
      };
    } catch (error) {
      console.warn('[CloudBase AI review]', error);
      return { enabled: true, status: 'enqueue_failed', error: error.message || 'AI 审核排队失败' };
    }
  }

  async function resolveFileUrls(items) {
    const fileList = [...new Set((items || []).map((item) => item.fileID || item.imageFileID).filter(Boolean))];
    if (!fileList.length) return new Map();
    const result = await cloudApp.getTempFileURL({ fileList });
    const urls = new Map();
    for (const file of result.fileList || []) {
      urls.set(file.fileID, file.tempFileURL || file.download_url || '');
    }
    return urls;
  }

  function isStableAccount(user) {
    return Boolean(user && (user.email || user.username || user.phoneNumber));
  }

  function injectAccountUi() {
    const profileView = document.getElementById('view-profile');
    if (!profileView || document.getElementById('cloud-profile-card')) return;

    const legacyCard = document.getElementById('legacy-profile-card');
    if (legacyCard) legacyCard.classList.add('hidden');

    profileView.insertAdjacentHTML('afterbegin', `
      <section id="cloud-profile-card" class="rounded-2xl border border-sandGold/30 bg-deepTeal p-4 text-white shadow-lg">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <p class="text-[10px] text-stone-300">个人中心</p>
              <span id="cloud-account-badge" class="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[9px] font-bold text-stone-200">连接中</span>
            </div>
            <h4 id="cloud-profile-name" class="cultural-font mt-1 truncate text-base font-bold text-sandGold">正在连接...</h4>
            <p id="cloud-profile-uid" class="mt-1 break-all font-mono text-[9px] text-stone-300"></p>
          </div>
          <div class="shrink-0 text-right">
            <p class="text-[9px] text-stone-300">流光积分</p>
            <p id="cloud-profile-points" class="text-xl font-bold text-sandGold">0</p>
          </div>
        </div>
        <div class="mt-3 grid grid-cols-4 gap-2 text-center">
          <div class="rounded-lg bg-white/10 p-2"><p id="cloud-stat-total" class="font-bold text-sandGold">0</p><p class="text-[9px] text-stone-300">全部投稿</p></div>
          <div class="rounded-lg bg-white/10 p-2"><p id="cloud-stat-pending" class="font-bold text-sandGold">0</p><p class="text-[9px] text-stone-300">待审核</p></div>
          <div class="rounded-lg bg-white/10 p-2"><p id="cloud-stat-approved" class="font-bold text-sandGold">0</p><p class="text-[9px] text-stone-300">已通过</p></div>
          <div class="rounded-lg bg-white/10 p-2"><p id="cloud-stat-attention" class="font-bold text-sandGold">0</p><p class="text-[9px] text-stone-300">需处理</p></div>
        </div>
        <p id="cloud-account-hint" class="mt-3 rounded-lg border border-white/10 bg-black/10 px-2.5 py-2 text-[9px] leading-relaxed text-stone-300"></p>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button id="cloud-profile-upload" type="button" class="rounded-lg border border-white/20 bg-white/10 px-2 py-2 text-[10px] font-bold">继续投稿</button>
          <button id="cloud-profile-edit" type="button" class="rounded-lg border border-white/20 bg-white/10 px-2 py-2 text-[10px] font-bold">编辑资料</button>
          <button id="cloud-feedback-open" type="button" class="rounded-lg border border-white/20 bg-white/10 px-2 py-2 text-[10px] font-bold">意见反馈</button>
          <button id="cloud-notification-open" type="button" class="rounded-lg border border-white/20 bg-white/10 px-2 py-2 text-[10px] font-bold">我的消息</button>
          <button id="cloud-account-action" type="button" class="rounded-lg bg-sandGold px-2 py-2 text-[10px] font-bold text-deepTeal">账号登录</button>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3">
          <button type="button" data-profile-feature="profile-badges-section" class="rounded-lg bg-white/10 px-2 py-2 text-[10px] font-bold text-stone-100">查看徽章</button>
          <button type="button" data-profile-feature="profile-coupons-section" class="rounded-lg bg-white/10 px-2 py-2 text-[10px] font-bold text-stone-100">兑换优惠券</button>
        </div>
      </section>
      <section class="space-y-2">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-bold uppercase tracking-wider text-stone-500">我的投稿</h4>
          <button id="cloud-record-refresh" type="button" class="text-[10px] font-bold text-deepTeal">刷新</button>
        </div>
        <div id="cloud-record-filters" class="flex gap-1.5 overflow-x-auto pb-1">
          <button type="button" data-cloud-filter="all" class="shrink-0 rounded-full bg-deepTeal px-2.5 py-1 text-[9px] font-bold text-white">全部</button>
          <button type="button" data-cloud-filter="pending" class="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[9px] font-bold text-stone-500">待审核</button>
          <button type="button" data-cloud-filter="approved" class="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[9px] font-bold text-stone-500">已通过</button>
          <button type="button" data-cloud-filter="attention" class="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[9px] font-bold text-stone-500">需处理</button>
        </div>
        <div id="cloud-my-submissions" class="space-y-2">
          <div class="rounded-xl border border-stone-200 bg-white p-3 text-xs text-stone-500">正在读取...</div>
        </div>
      </section>
      <section class="space-y-2">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-bold uppercase tracking-wider text-stone-500">我的反馈</h4>
          <button id="cloud-feedback-add" type="button" class="text-[10px] font-bold text-deepTeal">提交反馈</button>
        </div>
        <div id="cloud-my-feedback" class="space-y-2">
          <div class="rounded-xl border border-stone-200 bg-white p-3 text-xs text-stone-500">正在读取...</div>
        </div>
      </section>
    `);

    document.getElementById('cloud-account-action').addEventListener('click', () => {
      if (isStableAccount(cloudUser)) {
        signOutCloudAccount();
      } else {
        openCloudLogin();
      }
    });
    document.getElementById('cloud-profile-upload').addEventListener('click', () => {
      if (typeof switchTab === 'function') switchTab('collect');
    });
    document.getElementById('cloud-profile-edit').addEventListener('click', editCloudNickname);
    document.getElementById('cloud-feedback-open').addEventListener('click', openCloudFeedback);
    document.getElementById('cloud-notification-open').addEventListener('click', openCloudNotifications);
    document.getElementById('cloud-feedback-add').addEventListener('click', openCloudFeedback);
    document.getElementById('cloud-record-refresh').addEventListener('click', refreshCloudProfile);
    document.getElementById('cloud-record-filters').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-cloud-filter]');
      if (!button) return;
      activeSubmissionFilter = button.dataset.cloudFilter || 'all';
      renderCloudSubmissionRecords();
    });
    document.querySelectorAll('[data-profile-feature]').forEach((button) => {
      button.addEventListener('click', () => toggleProfileFeature(button.dataset.profileFeature));
    });
  }

  function toggleProfileFeature(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const shouldOpen = section.classList.contains('hidden');
    ['profile-badges-section', 'profile-coupons-section'].forEach((id) => {
      const candidate = document.getElementById(id);
      if (candidate) candidate.classList.add('hidden');
    });
    document.querySelectorAll('[data-profile-feature]').forEach((button) => {
      const selected = shouldOpen && button.dataset.profileFeature === sectionId;
      button.classList.toggle('bg-sandGold', selected);
      button.classList.toggle('text-deepTeal', selected);
      button.classList.toggle('bg-white/10', !selected);
      button.classList.toggle('text-stone-100', !selected);
    });
    if (shouldOpen) {
      section.classList.remove('hidden');
      setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  }

  function injectLoginModal() {
    if (document.getElementById('cloud-login-modal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="cloud-login-modal" class="hidden fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
        <div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
          <div class="flex items-start justify-between">
            <div>
              <h3 id="cloud-auth-title" class="text-lg font-bold text-deepTeal">登录账号</h3>
              <p id="cloud-auth-subtitle" class="mt-1 text-[10px] text-stone-500">登录后可在不同设备继续查看积分、投稿和反馈。</p>
            </div>
            <button id="cloud-login-close" type="button" class="text-stone-400">✕</button>
          </div>
          <div class="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1">
            <button type="button" data-auth-mode="login" class="rounded-lg bg-white px-2 py-2 text-[10px] font-bold text-deepTeal shadow-sm">登录</button>
            <button type="button" data-auth-mode="register" class="rounded-lg px-2 py-2 text-[10px] font-bold text-stone-500">注册</button>
            <button type="button" data-auth-mode="reset" class="rounded-lg px-2 py-2 text-[10px] font-bold text-stone-500">忘记密码</button>
          </div>
          <form id="cloud-login-form" data-auth-panel="login" class="mt-4 space-y-3">
            <input id="cloud-login-username" autocomplete="username" placeholder="邮箱或用户名" class="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-sandGold" required>
            <input id="cloud-login-password" type="password" autocomplete="current-password" placeholder="密码" class="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-sandGold" required>
            <p id="cloud-login-message" class="min-h-4 text-[10px] text-red-600"></p>
            <button type="submit" class="w-full rounded-xl bg-deepTeal px-3 py-2.5 text-sm font-bold text-sandGold">登录</button>
          </form>
          <form id="cloud-register-form" data-auth-panel="register" class="mt-4 hidden space-y-3">
            <input id="cloud-register-email" type="email" autocomplete="email" placeholder="邮箱" class="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-sandGold" required>
            <div class="flex gap-2">
              <input id="cloud-register-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位验证码" class="min-w-0 flex-1 rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-sandGold" required>
              <button id="cloud-register-send-code" type="button" class="shrink-0 rounded-xl border border-deepTeal px-3 py-2 text-[10px] font-bold text-deepTeal">发送验证码</button>
            </div>
            <input id="cloud-register-username" autocomplete="username" minlength="5" maxlength="24" placeholder="登录用户名（5-24 位字母、数字、_ 或 -）" class="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-sandGold" required>
            <input id="cloud-register-nickname" autocomplete="nickname" maxlength="40" placeholder="公开昵称" class="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-sandGold" required>
            <input id="cloud-register-password" type="password" autocomplete="new-password" minlength="8" placeholder="密码（至少 8 位，包含字母和数字）" class="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-sandGold" required>
            <input id="cloud-register-confirm" type="password" autocomplete="new-password" minlength="8" placeholder="再次输入密码" class="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-sandGold" required>
            <p id="cloud-register-message" class="min-h-4 text-[10px] text-red-600"></p>
            <button type="submit" class="w-full rounded-xl bg-deepTeal px-3 py-2.5 text-sm font-bold text-sandGold">注册并登录</button>
          </form>
          <form id="cloud-reset-form" data-auth-panel="reset" class="mt-4 hidden space-y-3">
            <input id="cloud-reset-email" type="email" autocomplete="email" placeholder="注册邮箱" class="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-sandGold" required>
            <div class="flex gap-2">
              <input id="cloud-reset-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位验证码" class="min-w-0 flex-1 rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-sandGold" required>
              <button id="cloud-reset-send-code" type="button" class="shrink-0 rounded-xl border border-deepTeal px-3 py-2 text-[10px] font-bold text-deepTeal">发送验证码</button>
            </div>
            <input id="cloud-reset-password" type="password" autocomplete="new-password" minlength="8" placeholder="新密码（至少 8 位，包含字母和数字）" class="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-sandGold" required>
            <input id="cloud-reset-confirm" type="password" autocomplete="new-password" minlength="8" placeholder="再次输入新密码" class="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-sandGold" required>
            <p id="cloud-reset-message" class="min-h-4 text-[10px] text-red-600"></p>
            <button type="submit" class="w-full rounded-xl bg-deepTeal px-3 py-2.5 text-sm font-bold text-sandGold">确认重设密码</button>
          </form>
          <p class="mt-3 text-[9px] leading-relaxed text-stone-400">验证码和密码由 CloudBase 身份认证处理；平台不会在业务数据库中保存密码。</p>
        </div>
      </div>
    `);
    document.getElementById('cloud-login-close').addEventListener('click', closeCloudLogin);
    document.getElementById('cloud-login-form').addEventListener('submit', loginCloudAccount);
    document.getElementById('cloud-register-form').addEventListener('submit', registerCloudAccount);
    document.getElementById('cloud-reset-form').addEventListener('submit', resetCloudPassword);
    document.getElementById('cloud-register-send-code').addEventListener('click', () => sendCloudEmailCode('register'));
    document.getElementById('cloud-reset-send-code').addEventListener('click', () => sendCloudEmailCode('reset'));
    document.querySelectorAll('[data-auth-mode]').forEach((button) => {
      button.addEventListener('click', () => switchCloudAuthMode(button.dataset.authMode));
    });
  }

  function injectProductModals() {
    if (document.getElementById('cloud-profile-edit-modal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="cloud-profile-edit-modal" class="hidden fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4">
        <div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-base font-bold text-stone-900">编辑个人资料</h3>
              <p class="mt-1 text-[10px] text-stone-500">昵称会展示在公开投稿、评论和点赞记录中。</p>
            </div>
            <button type="button" data-close-profile-edit class="text-stone-400">✕</button>
          </div>
          <form id="cloud-profile-edit-form" class="mt-4 space-y-3">
            <div>
              <label for="cloud-profile-nickname" class="text-xs font-bold text-stone-700">公开昵称</label>
              <input id="cloud-profile-nickname" maxlength="40" class="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-deepTeal" required>
            </div>
            <p id="cloud-profile-edit-message" class="min-h-4 text-[10px] text-red-600"></p>
            <div class="flex gap-2">
              <button type="button" data-close-profile-edit class="flex-1 rounded-xl bg-stone-100 py-2.5 text-xs font-bold text-stone-600">取消</button>
              <button type="submit" class="flex-1 rounded-xl bg-deepTeal py-2.5 text-xs font-bold text-sandGold">保存</button>
            </div>
          </form>
        </div>
      </div>
      <div id="cloud-feedback-modal" class="hidden fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4">
        <div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-base font-bold text-stone-900">意见反馈</h3>
              <p class="mt-1 text-[10px] text-stone-500">反馈会进入管理台，处理结果可在个人中心查看。</p>
            </div>
            <button type="button" data-close-feedback class="text-stone-400">✕</button>
          </div>
          <form id="cloud-feedback-form" class="mt-4 space-y-3">
            <div>
              <label for="cloud-feedback-type" class="text-xs font-bold text-stone-700">反馈类型</label>
              <select id="cloud-feedback-type" class="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-deepTeal">
                <option value="suggestion">产品建议</option>
                <option value="bug">功能异常</option>
                <option value="content">内容问题</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div>
              <label for="cloud-feedback-content" class="text-xs font-bold text-stone-700">具体说明</label>
              <textarea id="cloud-feedback-content" rows="5" maxlength="1200" placeholder="请说明遇到的问题、所在页面或希望增加的功能…" class="mt-1 w-full resize-none rounded-xl border border-stone-200 p-3 text-sm outline-none focus:border-deepTeal" required></textarea>
            </div>
            <p id="cloud-feedback-message" class="min-h-4 text-[10px] text-red-600"></p>
            <div class="flex gap-2">
              <button type="button" data-close-feedback class="flex-1 rounded-xl bg-stone-100 py-2.5 text-xs font-bold text-stone-600">取消</button>
              <button type="submit" class="flex-1 rounded-xl bg-deepTeal py-2.5 text-xs font-bold text-sandGold">提交</button>
            </div>
          </form>
        </div>
      </div>
    `);
    document.querySelectorAll('[data-close-profile-edit]').forEach((button) => {
      button.addEventListener('click', () => document.getElementById('cloud-profile-edit-modal').classList.add('hidden'));
    });
    document.querySelectorAll('[data-close-feedback]').forEach((button) => {
      button.addEventListener('click', () => document.getElementById('cloud-feedback-modal').classList.add('hidden'));
    });
    document.getElementById('cloud-profile-edit-form').addEventListener('submit', saveCloudNickname);
    document.getElementById('cloud-feedback-form').addEventListener('submit', submitCloudFeedback);
  }

  function openCloudLogin() {
    injectLoginModal();
    switchCloudAuthMode('login');
    document.getElementById('cloud-login-modal').classList.remove('hidden');
  }

  function closeCloudLogin() {
    const modal = document.getElementById('cloud-login-modal');
    if (modal) modal.classList.add('hidden');
  }

  function switchCloudAuthMode(mode) {
    const selectedMode = ['login', 'register', 'reset'].includes(mode) ? mode : 'login';
    const titles = {
      login: ['登录账号', '登录后可在不同设备继续查看积分、投稿和反馈。'],
      register: ['创建普通用户账号', '使用邮箱验证码注册，成功后会自动登录。'],
      reset: ['重设密码', '验证注册邮箱后设置一个新密码。']
    };
    const [title, subtitle] = titles[selectedMode];
    const titleNode = document.getElementById('cloud-auth-title');
    const subtitleNode = document.getElementById('cloud-auth-subtitle');
    if (titleNode) titleNode.textContent = title;
    if (subtitleNode) subtitleNode.textContent = subtitle;
    document.querySelectorAll('[data-auth-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.authPanel !== selectedMode);
    });
    document.querySelectorAll('[data-auth-mode]').forEach((button) => {
      const selected = button.dataset.authMode === selectedMode;
      button.className = selected
        ? 'rounded-lg bg-white px-2 py-2 text-[10px] font-bold text-deepTeal shadow-sm'
        : 'rounded-lg px-2 py-2 text-[10px] font-bold text-stone-500';
    });
  }

  function isValidCloudEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  }

  function isStrongCloudPassword(value) {
    const password = String(value || '');
    return password.length >= 8 && password.length <= 64 && /[A-Za-z]/.test(password) && /\d/.test(password);
  }

  function cloudAuthErrorMessage(error, fallback) {
    const rawCode = String(error && (
      error.code ||
      error.error_code ||
      error.errorCode ||
      (error.error && error.error.code) ||
      (error.data && (error.data.code || error.data.error_code))
    ) || '');
    const code = rawCode.toLowerCase();
    const message = String(error && (
      error.message ||
      error.msg ||
      error.error_message ||
      (error.error && (error.error.message || error.error.msg)) ||
      (error.data && (error.data.message || error.data.msg))
    ) || '');
    if (/verification.*(invalid|wrong)|invalid.*verification/.test(code + message)) return '验证码不正确，请重新输入';
    if (/verification.*expired|expired.*verification/.test(code + message)) return '验证码已过期，请重新发送';
    if (/email.*(exist|bound|register)|already.*email/.test(code + message)) return '该邮箱已经注册，请直接登录或重设密码';
    if (/username.*(exist|bound|register)|already.*username/.test(code + message)) return '该登录用户名已被使用，请换一个';
    if (/too.*many|frequency|rate.*limit|429/.test(code + message)) return '操作过于频繁，请稍后再试';
    if (/password/.test(code) && /invalid|weak|format/.test(code + message)) return '密码不符合要求，请使用 8-64 位且包含字母和数字';
    const detail = message || rawCode;
    return detail ? `${fallback}（${detail}）` : fallback;
  }

  function startCloudCodeCountdown(button) {
    let remaining = 60;
    button.disabled = true;
    button.classList.add('opacity-50', 'cursor-not-allowed');
    button.textContent = `${remaining} 秒后重发`;
    const timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(timer);
        button.disabled = false;
        button.classList.remove('opacity-50', 'cursor-not-allowed');
        button.textContent = '重新发送';
        return;
      }
      button.textContent = `${remaining} 秒后重发`;
    }, 1000);
  }

  async function sendCloudEmailCode(mode) {
    const isRegister = mode === 'register';
    const emailInput = document.getElementById(isRegister ? 'cloud-register-email' : 'cloud-reset-email');
    const message = document.getElementById(isRegister ? 'cloud-register-message' : 'cloud-reset-message');
    const button = document.getElementById(isRegister ? 'cloud-register-send-code' : 'cloud-reset-send-code');
    const email = emailInput.value.trim().toLowerCase();
    if (!isValidCloudEmail(email)) {
      message.className = 'min-h-4 text-[10px] text-red-600';
      message.textContent = '请输入有效邮箱地址';
      emailInput.focus();
      return;
    }
    button.disabled = true;
    message.className = 'min-h-4 text-[10px] text-stone-500';
    message.textContent = '正在发送验证码...';
    try {
      await ensureCloudUser();
      const verificationInfo = await cloudAuth.getVerification({ email });
      if (isRegister && verificationInfo && verificationInfo.is_user) {
        throw Object.assign(new Error('该邮箱已经注册，请直接登录或重设密码'), { code: 'EMAIL_ALREADY_REGISTERED' });
      }
      const record = { email, verificationInfo };
      if (isRegister) registerVerificationInfo = record;
      else resetVerificationInfo = record;
      message.className = 'min-h-4 text-[10px] text-emerald-600';
      message.textContent = '验证码已发送，请检查收件箱和垃圾邮件';
      startCloudCodeCountdown(button);
    } catch (error) {
      button.disabled = false;
      message.className = 'min-h-4 text-[10px] text-red-600';
      message.textContent = cloudAuthErrorMessage(error, '验证码发送失败，请稍后重试');
    }
  }

  async function registerCloudAccount(event) {
    event.preventDefault();
    const email = document.getElementById('cloud-register-email').value.trim().toLowerCase();
    const verificationCode = document.getElementById('cloud-register-code').value.trim();
    const username = document.getElementById('cloud-register-username').value.trim();
    const nickname = document.getElementById('cloud-register-nickname').value.trim();
    const password = document.getElementById('cloud-register-password').value;
    const confirmPassword = document.getElementById('cloud-register-confirm').value;
    const message = document.getElementById('cloud-register-message');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const fail = (text) => {
      message.className = 'min-h-4 text-[10px] text-red-600';
      message.textContent = text;
    };
    if (!registerVerificationInfo || registerVerificationInfo.email !== email) return fail('请先向当前邮箱发送验证码');
    if (!/^\d{6}$/.test(verificationCode)) return fail('请输入邮件中的 6 位验证码');
    if (!/^[A-Za-z0-9_-]{5,24}$/.test(username)) return fail('登录用户名需为 5-24 位字母、数字、_ 或 -');
    if (!nickname || nickname.length > 40) return fail('请输入 1-40 个字的公开昵称');
    if (!isStrongCloudPassword(password)) return fail('密码需为 8-64 位，并同时包含字母和数字');
    if (password !== confirmPassword) return fail('两次输入的密码不一致');
    button.disabled = true;
    message.className = 'min-h-4 text-[10px] text-stone-500';
    message.textContent = '正在验证并创建账号...';
    try {
      const usernameUsed = await cloudAuth.isUsernameRegistered(username);
      if (usernameUsed) throw Object.assign(new Error('该登录用户名已被使用，请换一个'), { code: 'USERNAME_EXISTS' });
      const tokenResult = await cloudAuth.verify({
        verification_id: registerVerificationInfo.verificationInfo.verification_id,
        verification_code: verificationCode
      });
      const verificationToken = tokenResult.verification_token || tokenResult.verificationToken;
      if (!verificationToken) throw new Error('验证码验证未返回有效凭证');
      await cloudAuth.signUp({
        email,
        username,
        name: nickname,
        password,
        verification_code: verificationCode,
        verification_token: verificationToken
      });
      registerVerificationInfo = null;
      message.className = 'min-h-4 text-[10px] text-emerald-600';
      message.textContent = '注册成功，正在进入个人中心...';
      setTimeout(() => location.reload(), 700);
    } catch (error) {
      console.error('[CloudBase register failed]', error);
      message.className = 'min-h-4 text-[10px] text-red-600';
      message.textContent = cloudAuthErrorMessage(error, '注册失败，请检查信息后重试');
      try {
        if (!await cloudAuth.getLoginState()) await cloudAuth.anonymousAuthProvider().signIn();
      } catch (_) {}
    } finally {
      button.disabled = false;
    }
  }

  async function resetCloudPassword(event) {
    event.preventDefault();
    const email = document.getElementById('cloud-reset-email').value.trim().toLowerCase();
    const verificationCode = document.getElementById('cloud-reset-code').value.trim();
    const password = document.getElementById('cloud-reset-password').value;
    const confirmPassword = document.getElementById('cloud-reset-confirm').value;
    const message = document.getElementById('cloud-reset-message');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const fail = (text) => {
      message.className = 'min-h-4 text-[10px] text-red-600';
      message.textContent = text;
    };
    if (!resetVerificationInfo || resetVerificationInfo.email !== email) return fail('请先向当前邮箱发送验证码');
    if (!/^\d{6}$/.test(verificationCode)) return fail('请输入邮件中的 6 位验证码');
    if (!isStrongCloudPassword(password)) return fail('新密码需为 8-64 位，并同时包含字母和数字');
    if (password !== confirmPassword) return fail('两次输入的新密码不一致');
    button.disabled = true;
    message.className = 'min-h-4 text-[10px] text-stone-500';
    message.textContent = '正在验证并重设密码...';
    try {
      const tokenResult = await cloudAuth.verify({
        verification_id: resetVerificationInfo.verificationInfo.verification_id,
        verification_code: verificationCode
      });
      const verificationToken = tokenResult.verification_token || tokenResult.verificationToken;
      if (!verificationToken) throw new Error('验证码验证未返回有效凭证');
      await cloudAuth.resetPassword({
        email,
        new_password: password,
        verification_token: verificationToken
      });
      resetVerificationInfo = null;
      event.currentTarget.reset();
      document.getElementById('cloud-login-username').value = email;
      document.getElementById('cloud-login-message').className = 'min-h-4 text-[10px] text-emerald-600';
      document.getElementById('cloud-login-message').textContent = '密码已重设，请使用新密码登录';
      switchCloudAuthMode('login');
      document.getElementById('cloud-login-password').focus();
    } catch (error) {
      message.className = 'min-h-4 text-[10px] text-red-600';
      message.textContent = cloudAuthErrorMessage(error, '密码重设失败，请重新发送验证码后再试');
    } finally {
      button.disabled = false;
    }
  }

  async function loginCloudAccount(event) {
    event.preventDefault();
    const username = document.getElementById('cloud-login-username').value.trim();
    const password = document.getElementById('cloud-login-password').value;
    const message = document.getElementById('cloud-login-message');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    message.textContent = '正在登录...';
    try {
      if (await cloudAuth.getLoginState()) await cloudAuth.signOut();
      await cloudAuth.signIn({ username, password });
      message.className = 'min-h-4 text-[10px] text-emerald-600';
      message.textContent = '登录成功，正在刷新云端资料...';
      setTimeout(() => location.reload(), 500);
    } catch (error) {
      message.className = 'min-h-4 text-[10px] text-red-600';
      message.textContent = error.message || '登录失败';
      try { await cloudAuth.anonymousAuthProvider().signIn(); } catch (_) {}
    } finally {
      button.disabled = false;
    }
  }

  async function signOutCloudAccount() {
    if (!confirm('退出当前云端账号并切换为游客身份？')) return;
    await cloudAuth.signOut();
    await cloudAuth.anonymousAuthProvider().signIn();
    location.reload();
  }

  async function editCloudNickname() {
    if (!latestBootstrap) return;
    if (!isStableAccount(cloudUser)) {
      openCloudLogin();
      if (typeof showToast === 'function') showToast('登录正式账号后可长期保存个人昵称', 'log-in');
      return;
    }
    injectProductModals();
    document.getElementById('cloud-profile-nickname').value = latestBootstrap.profile.nickname || '';
    document.getElementById('cloud-profile-edit-message').textContent = '';
    document.getElementById('cloud-profile-edit-modal').classList.remove('hidden');
  }

  async function saveCloudNickname(event) {
    event.preventDefault();
    const nickname = document.getElementById('cloud-profile-nickname').value.trim();
    const message = document.getElementById('cloud-profile-edit-message');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (!nickname) {
      message.textContent = '昵称不能为空';
      return;
    }
    button.disabled = true;
    try {
      await callCore({ action: 'updateProfile', nickname });
      await refreshCloudProfile();
      document.getElementById('cloud-profile-edit-modal').classList.add('hidden');
      if (typeof showToast === 'function') showToast('个人资料已保存', 'check-circle');
    } catch (error) {
      message.textContent = error.message || '保存失败';
    } finally {
      button.disabled = false;
    }
  }

  function feedbackTypeLabel(type) {
    return {
      suggestion: '产品建议',
      bug: '功能异常',
      content: '内容问题',
      other: '其他'
    }[type] || '其他';
  }

  function feedbackStatusLabel(status) {
    return {
      open: '处理中',
      resolved: '已回复',
      dismissed: '已关闭'
    }[status] || '处理中';
  }

  function renderCloudFeedback() {
    const list = document.getElementById('cloud-my-feedback');
    if (!list || !latestBootstrap) return;
    const items = latestBootstrap.myFeedback || [];
    list.innerHTML = items.length ? items.map((item) => `
      <article class="rounded-xl border border-stone-200 bg-white p-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-xs font-bold text-stone-800">${safeText(feedbackTypeLabel(item.type))}</p>
            <p class="mt-1 line-clamp-2 text-[10px] leading-relaxed text-stone-500">${safeText(item.content)}</p>
          </div>
          <span class="shrink-0 rounded-full bg-stone-100 px-2 py-1 text-[9px] font-bold text-stone-600">${safeText(feedbackStatusLabel(item.status))}</span>
        </div>
        ${item.response ? `<p class="mt-2 rounded-lg bg-emerald-50 p-2 text-[10px] leading-relaxed text-emerald-800">处理回复：${safeText(item.response)}</p>` : ''}
        <p class="mt-2 text-[9px] text-stone-400">${safeText(displayDate(item.createdAt))}</p>
      </article>
    `).join('') : '<div class="rounded-xl border border-stone-200 bg-white p-3 text-xs text-stone-500">还没有提交过反馈。</div>';
  }

  function openCloudFeedback() {
    if (!isStableAccount(cloudUser)) {
      openCloudLogin();
      if (typeof showToast === 'function') showToast('登录后可以提交反馈并查看处理结果', 'log-in');
      return;
    }
    injectProductModals();
    document.getElementById('cloud-feedback-message').textContent = '';
    document.getElementById('cloud-feedback-modal').classList.remove('hidden');
  }

  async function submitCloudFeedback(event) {
    event.preventDefault();
    const type = document.getElementById('cloud-feedback-type').value;
    const content = document.getElementById('cloud-feedback-content').value.trim();
    const message = document.getElementById('cloud-feedback-message');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (content.length < 5) {
      message.textContent = '请至少填写 5 个字';
      return;
    }
    button.disabled = true;
    try {
      await callCore({
        action: 'createFeedback',
        type,
        content,
        page: location.pathname || '/'
      });
      event.currentTarget.reset();
      document.getElementById('cloud-feedback-modal').classList.add('hidden');
      await refreshCloudProfile();
      if (typeof showToast === 'function') showToast('反馈已提交，我们会在个人中心回复', 'check-circle');
    } catch (error) {
      message.textContent = error.message || '提交失败';
    } finally {
      button.disabled = false;
    }
  }

  function renderCloudSubmissionRecords() {
    const list = document.getElementById('cloud-my-submissions');
    if (!list || !latestBootstrap) return;
    const allItems = latestBootstrap.mySubmissions || [];
    const items = allItems.filter((item) => {
      if (activeSubmissionFilter === 'all') return true;
      if (activeSubmissionFilter === 'attention') {
        return item.status === 'rejected' || item.status === 'needs_revision';
      }
      return item.status === activeSubmissionFilter;
    });
    document.querySelectorAll('[data-cloud-filter]').forEach((button) => {
      const selected = button.dataset.cloudFilter === activeSubmissionFilter;
      button.classList.toggle('bg-deepTeal', selected);
      button.classList.toggle('text-white', selected);
      button.classList.toggle('bg-stone-100', !selected);
      button.classList.toggle('text-stone-500', !selected);
    });
    list.innerHTML = items.length ? items.map((item) => `
      <article class="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate text-xs font-bold text-stone-800">${safeText(item.title || '未命名素材')}</p>
            <p class="mt-1 text-[9px] text-stone-400">${safeText(displayDate(item.createdAt))} · ${safeText(item.assetType)}</p>
          </div>
          <span class="shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusClass(item.status)}">${safeText(statusLabel(item.status))}</span>
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5 text-[9px]">
          <span class="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">${safeText(reviewStageLabel(item.aiReviewStatus))}</span>
          <span class="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">审核编号 ${safeText(item.id)}</span>
        </div>
        ${item.reviewNote ? `<p class="mt-2 rounded-lg bg-stone-50 p-2 text-[10px] text-stone-600">审核意见：${safeText(item.reviewNote)}</p>` : ''}
        ${item.status === 'approved' ? `<p class="mt-2 text-[10px] font-bold text-emerald-600">已发放 +${Number(item.rewardPoints || 100)} 流光积分</p>` : ''}
      </article>
    `).join('') : `<div class="rounded-xl border border-stone-200 bg-white p-3 text-xs text-stone-500">${
      allItems.length ? '当前筛选条件下没有投稿。' : '还没有云端上传记录。'
    }</div>`;
  }

  function renderCloudProfile(data) {
    latestBootstrap = data;
    const profile = data.profile || {};
    const stats = data.stats || {};
    const uid = profile.uid || cloudUser && (cloudUser.uid || cloudUser.id) || '';
    const stable = isStableAccount(cloudUser);
    document.getElementById('cloud-profile-name').textContent = profile.nickname || '楚韵守护者';
    document.getElementById('cloud-profile-uid').textContent = `身份编号 ${maskedUid(uid)}`;
    document.getElementById('cloud-account-badge').textContent = stable ? '正式账号' : '游客';
    document.getElementById('cloud-account-hint').textContent = stable
      ? '资料、积分、投稿和反馈已同步，可在其他设备登录后继续使用。'
      : '当前为游客身份：本机可以投稿和查看记录，但清理浏览器数据或更换设备后可能无法找回。建议登录正式账号。';
    document.getElementById('cloud-profile-points').textContent = Number(profile.points || 0).toLocaleString();
    document.getElementById('cloud-stat-total').textContent = Number(stats.total || 0);
    document.getElementById('cloud-stat-pending').textContent = Number(stats.pending || 0);
    document.getElementById('cloud-stat-approved').textContent = Number(stats.approved || 0);
    document.getElementById('cloud-stat-attention').textContent =
      Number(stats.rejected || 0) + Number(stats.needs_revision || 0);
    document.getElementById('cloud-account-action').textContent = stable ? '退出账号' : '账号登录';
    const headerAccount = document.getElementById('header-account-entry');
    if (headerAccount) {
      headerAccount.title = stable ? '打开个人中心' : '登录账号';
      headerAccount.setAttribute('aria-label', stable ? '打开个人中心' : '登录账号');
      headerAccount.classList.toggle('text-sandGold', stable);
      headerAccount.classList.toggle('text-stone-200', !stable);
      headerAccount.classList.toggle('border-sandGold/40', stable);
    }
    const legacyPoints = document.getElementById('user-points');
    if (legacyPoints) legacyPoints.textContent = Number(profile.points || 0).toLocaleString();
    try { userPoints = Number(profile.points || 0); } catch (_) {}
    renderCloudSubmissionRecords();
    renderCloudFeedback();
    updateNotificationEntry();
  }

  async function refreshCloudProfile() {
    injectAccountUi();
    bootstrapPromise = callCore({ action: 'bootstrap' });
    try {
      renderCloudProfile(await bootstrapPromise);
      await loadCloudNotifications();
    } catch (error) {
      const list = document.getElementById('cloud-my-submissions');
      if (list) list.innerHTML = `<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">${safeText(error.message)}</div>`;
    }
  }

  async function mapPublicItems(items) {
    return (items || []).map((item) => {
      const fileID = item.fileID || item.imageFileID || '';
      const fileUrl = item.fileUrl || '';
      const mapped = {
        ...item,
        id: `approved-${item.id}`,
        feedId: `approved-${item.id}`,
        fileUrl,
        thumbnailUrl: item.assetType === 'image' ? fileUrl : '',
        regionName: item.regionName || '湖北',
        contributorName: item.contributorName || '楚韵守护者',
        qualityScore: Number(item.completeness || 60),
        comments: Number(item.commentCount || 0),
        commentCount: Number(item.commentCount || 0),
        likes: Number(item.likeCount || 0),
        likeCount: Number(item.likeCount || 0),
        board: item.board || (Number(item.completeness || 60) >= 82 ? 'share' : 'needs'),
        completeness: Number(item.completeness || 60),
        approvedSupplements: item.approvedSupplements || []
      };
      if (typeof discoverLikeState !== 'undefined') {
        discoverLikeState[mapped.feedId] = Boolean(item.viewerLiked);
      }
      return mapped;
    });
  }

  function rawSubmissionId(value) {
    return String(value || '').replace(/^approved-/, '');
  }

  function findApprovedItem(value) {
    const id = String(value || '');
    if (typeof approvedSubmissionItems === 'undefined') return null;
    return approvedSubmissionItems.find((item) =>
      item.id === id || item.feedId === id || rawSubmissionId(item.id) === rawSubmissionId(id)
    ) || null;
  }

  const DISCUSSABLE_DISCOVER_CONTENT_IDS = new Set([
    'share-yellow-crane-tower',
    'share-wudang-ancient-buildings',
    'share-mingxianling',
    'share-hubei-museum-bells',
    'share-jingzhou-city-wall',
    'live-new-jingzhou-inscription',
    'live-new-enshi-door',
    'live-new-wudang-stone',
    'live-new-suizhou-pattern'
  ]);

  function setDiscoverDiscussionEntryAvailable(available) {
    const entry = document.getElementById('cloud-discover-discussion-entry');
    if (entry) entry.classList.toggle('hidden', !available);
  }

  function normalizeInteractionTarget(value) {
    if (value && typeof value === 'object' && value.targetType && value.targetId) {
      return {
        targetType: String(value.targetType),
        targetId: rawSubmissionId(value.targetId),
        targetTitle: String(value.targetTitle || value.title || '内容讨论')
      };
    }
    const item = typeof value === 'string' ? findApprovedItem(value) : value;
    if (!item || !String(item.feedId || item.id || '').startsWith('approved-')) return null;
    return {
      targetType: 'submission',
      targetId: rawSubmissionId(item.id || item.feedId),
      targetTitle: String(item.title || '社区投稿')
    };
  }

  function interactionPayload(target) {
    const payload = {
      targetType: target.targetType,
      targetId: target.targetId
    };
    if (target.targetType === 'submission') payload.submissionId = target.targetId;
    return payload;
  }

  async function requireInteractiveAccount() {
    const user = await ensureCloudUser();
    if (!isStableAccount(user)) {
      openCloudLogin();
      const error = new Error('请先登录正式账号后再参与互动');
      error.code = 'STABLE_ACCOUNT_REQUIRED';
      throw error;
    }
    return user;
  }

  function updateApprovedInteractionState(submissionId, data) {
    const item = findApprovedItem(submissionId);
    if (!item) return;
    if (data.likeCount != null) {
      item.likes = Number(data.likeCount || 0);
      item.likeCount = Number(data.likeCount || 0);
    }
    if (data.commentCount != null) {
      item.comments = Number(data.commentCount || 0);
      item.commentCount = Number(data.commentCount || 0);
    }
    if (data.viewerLiked != null && typeof discoverLikeState !== 'undefined') {
      discoverLikeState[item.feedId || item.id] = Boolean(data.viewerLiked);
      item.viewerLiked = Boolean(data.viewerLiked);
    }
  }

  function renderCloudComments(result) {
    const panel = document.getElementById('cloud-interaction-panel');
    const title = document.getElementById('cloud-interaction-title');
    const summary = document.getElementById('cloud-interaction-summary');
    const list = document.getElementById('cloud-comment-list');
    const likeUsers = document.getElementById('cloud-like-users');
    const loadMore = document.getElementById('cloud-comment-load-more');
    if (!panel || !summary || !list) return;
    panel.classList.remove('hidden');
    if (title) title.textContent = result.targetTitle || (activeInteractionTarget && activeInteractionTarget.targetTitle) || '内容讨论';
    summary.textContent = result.targetType === 'submission'
      ? `${Number(result.likeCount || 0)} 个赞 · ${Number(result.commentCount || 0)} 条评论`
      : `${Number(result.commentCount || 0)} 条评论 · 登录后可参与交流`;
    const likers = result.likers || [];
    if (likeUsers) {
      likeUsers.classList.toggle('hidden', !likers.length);
      likeUsers.classList.toggle('flex', Boolean(likers.length));
      likeUsers.innerHTML = likers.length
        ? `<span class="text-[9px] text-stone-400">最近点赞</span>${likers.map((name) => `<span class="rounded-full bg-sandGold/15 px-2 py-1 text-[9px] font-bold text-deepTeal">${safeText(name)}</span>`).join('')}`
        : '';
    }
    if (loadMore) loadMore.classList.toggle('hidden', !interactionHasMoreComments);
    const comments = loadedInteractionComments;
    list.innerHTML = comments.length ? comments.map((comment) => `
      <article class="${comment.parentId ? 'ml-5 border-l-2 border-sandGold/30 pl-2' : ''} rounded-lg bg-stone-50 p-2.5">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate text-[10px] font-bold text-deepTeal">${safeText(comment.authorName || '社区用户')}</p>
            <p class="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-stone-600">${safeText(comment.content)}</p>
            <p class="mt-1 text-[9px] text-stone-400">${safeText(displayDate(comment.createdAt))}</p>
          </div>
          <div class="flex shrink-0 gap-2 text-[9px] font-bold">
            <button type="button" onclick="window.replyCloudComment('${safeText(comment.id)}')" class="text-deepTeal">回复</button>
            ${comment.isMine
              ? `<button type="button" onclick="window.deleteCloudComment('${safeText(comment.id)}')" class="text-red-600">删除</button>`
              : `<button type="button" onclick="window.reportCloudContent('comment','${safeText(comment.id)}')" class="text-red-600">举报</button>`}
          </div>
        </div>
      </article>
    `).join('') : '<div class="rounded-lg bg-stone-50 p-3 text-center text-[10px] text-stone-400">还没有评论，来留下第一条友善交流吧。</div>';
  }

  async function loadCloudInteractions(itemOrId, options = {}) {
    const append = options.append === true;
    const target = normalizeInteractionTarget(itemOrId || activeInteractionTarget);
    const panel = document.getElementById('cloud-interaction-panel');
    if (!target) {
      if (panel) panel.classList.add('hidden');
      return;
    }
    activeInteractionTarget = target;
    activeInteractionSubmissionId = target.targetType === 'submission' ? target.targetId : '';
    if (!append) {
      activeReplyCommentId = '';
      loadedInteractionComments = [];
      interactionHasMoreComments = false;
      updateReplyIndicator();
    }
    if (panel) panel.classList.remove('hidden');
    const list = document.getElementById('cloud-comment-list');
    if (list && !append) list.innerHTML = '<div class="rounded-lg bg-stone-50 p-3 text-center text-[10px] text-stone-400">正在读取云端互动...</div>';
    try {
      const result = await callCore({
        action: 'getInteractions',
        ...interactionPayload(target),
        commentOffset: append ? loadedInteractionComments.length : 0,
        commentLimit: 10
      });
      const incoming = result.comments || [];
      if (append) {
        const knownIds = new Set(loadedInteractionComments.map((comment) => comment.id));
        loadedInteractionComments = loadedInteractionComments.concat(
          incoming.filter((comment) => !knownIds.has(comment.id))
        );
      } else {
        loadedInteractionComments = incoming;
      }
      interactionHasMoreComments = Boolean(result.hasMoreComments);
      if (target.targetType === 'submission') updateApprovedInteractionState(target.targetId, result);
      renderCloudComments(result);
      if (target.targetType === 'submission' && typeof renderDiscoverFeed === 'function') renderDiscoverFeed();
    } catch (error) {
      if (list) list.innerHTML = `<div class="rounded-lg bg-red-50 p-3 text-[10px] text-red-700">${safeText(error.message)}</div>`;
    }
  }

  async function openCloudDiscussion(targetType, targetId, targetTitle) {
    const target = normalizeInteractionTarget({ targetType, targetId, targetTitle });
    if (!target) return;
    const modal = document.getElementById('cloud-discussion-modal');
    const reportButton = document.getElementById('cloud-report-submission');
    if (reportButton) reportButton.classList.toggle('hidden', target.targetType !== 'submission');
    if (modal) modal.classList.remove('hidden');
    await loadCloudInteractions(target);
    if (window.lucide) lucide.createIcons();
  }

  function openActiveCloudDiscussion() {
    if (!activeInteractionTarget) {
      if (typeof showToast === 'function') showToast('暂时无法读取这条内容的讨论', 'alert-circle');
      return;
    }
    openCloudDiscussion(
      activeInteractionTarget.targetType,
      activeInteractionTarget.targetId,
      activeInteractionTarget.targetTitle
    );
  }

  function closeCloudDiscussion() {
    const modal = document.getElementById('cloud-discussion-modal');
    if (modal) modal.classList.add('hidden');
    activeReplyCommentId = '';
    updateReplyIndicator();
  }

  async function toggleCloudLike(id) {
    if (!String(id || '').startsWith('approved-')) {
      if (legacyToggleSubmissionLike) legacyToggleSubmissionLike(id);
      return;
    }
    try {
      await requireInteractiveAccount();
      const result = await callCore({
        action: 'toggleLike',
        submissionId: rawSubmissionId(id)
      });
      updateApprovedInteractionState(id, {
        likeCount: result.likeCount,
        viewerLiked: result.liked
      });
      if (typeof renderDiscoverFeed === 'function') renderDiscoverFeed();
      if (activeInteractionSubmissionId === rawSubmissionId(id)) {
        await loadCloudInteractions(id);
      }
      if (typeof showToast === 'function') {
        showToast(result.liked ? '点赞成功' : '已取消点赞', 'thumbs-up');
      }
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message, 'alert-circle');
    }
  }

  function updateReplyIndicator(authorName = '') {
    const indicator = document.getElementById('cloud-reply-indicator');
    const label = document.getElementById('cloud-reply-label');
    if (!indicator || !label) return;
    indicator.classList.toggle('hidden', !activeReplyCommentId);
    indicator.classList.toggle('flex', Boolean(activeReplyCommentId));
    label.textContent = activeReplyCommentId ? `正在回复 ${authorName || '这条评论'}` : '';
  }

  async function submitCloudComment(event) {
    event.preventDefault();
    const input = document.getElementById('cloud-comment-input');
    const content = input ? input.value.trim() : '';
    if (!activeInteractionTarget || !content) {
      if (typeof showToast === 'function') showToast('请输入评论内容', 'message-square');
      return;
    }
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await requireInteractiveAccount();
      await callCore({
        action: 'createComment',
        ...interactionPayload(activeInteractionTarget),
        parentId: activeReplyCommentId,
        content
      });
      input.value = '';
      const counter = document.getElementById('cloud-comment-count');
      if (counter) counter.textContent = '0/500';
      activeReplyCommentId = '';
      updateReplyIndicator();
      await loadCloudInteractions(activeInteractionTarget);
      if (typeof showToast === 'function') showToast('评论已发布', 'message-square');
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message, 'alert-circle');
    } finally {
      button.disabled = false;
    }
  }

  async function deleteCloudComment(commentId) {
    if (!confirm('确定删除这条评论吗？')) return;
    try {
      await requireInteractiveAccount();
      await callCore({ action: 'deleteComment', commentId });
      await loadCloudInteractions(activeInteractionTarget);
      if (typeof showToast === 'function') showToast('评论已删除', 'trash-2');
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message, 'alert-circle');
    }
  }

  function closeCloudReportModal() {
    const modal = document.getElementById('cloud-report-modal');
    if (modal) modal.classList.add('hidden');
    activeReportTargetType = 'submission';
    activeReportTargetId = '';
    const message = document.getElementById('cloud-report-message');
    if (message) message.textContent = '';
  }

  async function reportCloudContent(targetType, targetId) {
    try {
      await requireInteractiveAccount();
      activeReportTargetType = targetType === 'comment' ? 'comment' : 'submission';
      activeReportTargetId = targetId || (activeInteractionTarget && activeInteractionTarget.targetId) || activeInteractionSubmissionId;
      const modal = document.getElementById('cloud-report-modal');
      const label = document.getElementById('cloud-report-target-label');
      const detail = document.getElementById('cloud-report-detail');
      const message = document.getElementById('cloud-report-message');
      if (label) label.textContent = activeReportTargetType === 'comment' ? '举报这条评论' : '举报当前作品';
      if (detail) detail.value = '';
      if (message) message.textContent = '';
      if (modal) modal.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message, 'alert-circle');
    }
  }

  async function submitCloudReport(event) {
    event.preventDefault();
    const reason = document.getElementById('cloud-report-reason').value;
    const detail = document.getElementById('cloud-report-detail').value.trim();
    const message = document.getElementById('cloud-report-message');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    if (message) {
      message.className = 'min-h-4 text-[10px] text-stone-500';
      message.textContent = '正在提交举报...';
    }
    try {
      await requireInteractiveAccount();
      await callCore({
        action: 'createReport',
        submissionId: activeInteractionSubmissionId,
        targetType: activeReportTargetType,
        targetId: activeReportTargetId || activeInteractionSubmissionId,
        reason,
        detail
      });
      closeCloudReportModal();
      if (typeof showToast === 'function') showToast('举报已提交，管理员将进行处理', 'shield-check');
    } catch (error) {
      if (message) {
        message.className = 'min-h-4 text-[10px] text-red-600';
        message.textContent = error.message;
      }
    } finally {
      button.disabled = false;
    }
  }

  function cloudSupplementAssetType(file) {
    const mime = String(file && file.type || '').toLowerCase();
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    return 'image';
  }

  function renderCloudSupplementSlots(item) {
    if (!item || !String(item.feedId || item.id || '').startsWith('approved-')) {
      if (legacyRenderSupplementSlots) legacyRenderSupplementSlots(item);
      return;
    }
    const container = document.getElementById('discover-supplement-slots');
    if (!container || typeof getDefaultSupplementSlots !== 'function') return;
    const submissionId = rawSubmissionId(item.id || item.feedId);
    const state = cloudSupplementState.get(submissionId);
    const records = state && Array.isArray(state.items) ? state.items : [];
    const slots = getDefaultSupplementSlots(item);
    container.innerHTML = slots.map((slot) => {
      const slotRecords = records.filter((record) => record.slotId === slot.id);
      const mine = slotRecords.find((record) => ['pending', 'approved', 'rejected'].includes(record.status));
      const approved = slotRecords.filter((record) => record.status === 'approved');
      const isPending = mine && mine.status === 'pending';
      const isMineApproved = mine && mine.status === 'approved';
      const isRejected = mine && mine.status === 'rejected';
      const disabled = Boolean(isPending || isMineApproved);
      const buttonText = isPending
        ? '已提交，等待管理员审核'
        : isMineApproved
          ? `审核已通过，获得 ${Number(mine.rewardPoints || slot.reward || 0)} 积分`
          : isRejected
            ? '按审核意见重新上传'
            : approved.length
              ? '继续补充新的佐证资料'
              : '上传补充资料';
      const evidence = approved.length
        ? `<div class="mt-2 space-y-1.5">${approved.slice(0, 3).map((record) => `
            <div class="flex items-center justify-between rounded-lg bg-emerald-50 px-2 py-1.5 text-[10px] text-emerald-800">
              <span>已采纳 · ${safeText(record.contributorName || '社区用户')}</span>
              ${record.fileUrl ? `<a href="${safeText(record.fileUrl)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="font-bold underline">查看资料</a>` : ''}
            </div>
          `).join('')}</div>`
        : '';
      return `
        <div class="rounded-xl border ${approved.length ? 'border-emerald-200 bg-emerald-50/40' : 'border-stone-200 bg-white'} p-3">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-xs font-bold text-stone-800">${safeText(slot.title)}</p>
              <p class="mt-1 text-[10px] leading-relaxed text-stone-500">${safeText(slot.desc)}</p>
              ${isRejected && mine.reviewNote ? `<p class="mt-1 text-[10px] font-semibold text-red-600">审核意见：${safeText(mine.reviewNote)}</p>` : ''}
            </div>
            <span class="shrink-0 rounded-full bg-sandGold/20 px-2 py-0.5 text-[10px] font-bold text-deepTeal">+${Number(slot.reward || 30)}</span>
          </div>
          ${evidence}
          <button type="button" ${disabled ? 'disabled' : ''} onclick="triggerDiscoverSupplementUpload('${safeText(item.id || item.feedId)}', '${safeText(slot.id)}')" class="mt-2 flex w-full items-center justify-center rounded-lg ${disabled ? 'cursor-not-allowed bg-stone-200 text-stone-500' : 'bg-deepTeal text-sandGold'} px-3 py-2 text-xs font-bold">
            ${safeText(buttonText)}
          </button>
        </div>
      `;
    }).join('');
    if (window.lucide) lucide.createIcons();
  }

  async function loadCloudSupplements(itemOrId) {
    const item = typeof itemOrId === 'string' ? findApprovedItem(itemOrId) : itemOrId;
    if (!item || !String(item.feedId || item.id || '').startsWith('approved-')) return;
    const submissionId = rawSubmissionId(item.id || item.feedId);
    try {
      const result = await callCore({ action: 'getSupplements', submissionId });
      cloudSupplementState.set(submissionId, result);
      item.completeness = Number(result.completeness || item.completeness || 60);
      item.qualityScore = item.completeness;
      item.board = result.board || (item.completeness >= 82 ? 'share' : 'needs');
      if (activeInteractionSubmissionId === submissionId || document.getElementById('discover-detail-modal')?.classList.contains('hidden') === false) {
        renderCloudSupplementSlots(item);
      }
      if (typeof renderDiscoverFeed === 'function') renderDiscoverFeed();
    } catch (error) {
      console.warn('[CloudBase supplements]', error);
    }
  }

  function triggerCloudSupplementUpload(itemId, slotId) {
    const item = findApprovedItem(itemId);
    if (!item) {
      if (legacyTriggerDiscoverSupplementUpload) legacyTriggerDiscoverSupplementUpload(itemId, slotId);
      return;
    }
    if (!isStableAccount(cloudUser)) {
      openCloudLogin();
      if (typeof showToast === 'function') showToast('登录正式账号后才能补充资料', 'log-in');
      return;
    }
    activeCloudSupplement = { item, submissionId: rawSubmissionId(item.id || item.feedId), slotId };
    if (legacyTriggerDiscoverSupplementUpload) legacyTriggerDiscoverSupplementUpload(itemId, slotId);
  }

  async function submitCloudSupplement(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    const context = activeCloudSupplement;
    if (!file || !context) {
      if (file && legacyHandleDiscoverSupplementUpload) legacyHandleDiscoverSupplementUpload(event);
      return;
    }
    let uploadedFileID = '';
    try {
      await requireInteractiveAccount();
      if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error('补充文件大小必须在 25MB 以内');
      const assetType = cloudSupplementAssetType(file);
      const uid = cloudUser.uid || cloudUser.id;
      const cloudPath = `supplements/${uid}/${Date.now()}-${randomPart()}.${fileExtension(file)}`;
      if (typeof showToast === 'function') showToast('正在上传补充资料…', 'upload-cloud');
      const upload = await cloudApp.uploadFile({ cloudPath, filePath: file });
      uploadedFileID = upload.fileID || '';
      if (!uploadedFileID) throw new Error('云存储未返回 fileID');
      await callCore({
        action: 'createSupplement',
        submissionId: context.submissionId,
        slotId: context.slotId,
        assetType,
        mimeType: file.type || '',
        size: file.size,
        fileID: uploadedFileID,
        cloudPath
      });
      await loadCloudSupplements(context.item);
      if (typeof showToast === 'function') showToast('补充资料已提交，管理员通过后发放积分', 'clock');
    } catch (error) {
      if (uploadedFileID) {
        try { await cloudApp.deleteFile({ fileList: [uploadedFileID] }); } catch (_) {}
      }
      if (typeof showToast === 'function') showToast(error.message || '补充资料提交失败', 'alert-circle');
    } finally {
      input.value = '';
      activeCloudSupplement = null;
    }
  }

  function openCloudDiscoverDetail(itemId) {
    if (legacyOpenDiscoverDetail) legacyOpenDiscoverDetail(itemId);
    const approvedItem = findApprovedItem(itemId);
    if (approvedItem) {
      setDiscoverDiscussionEntryAvailable(true);
      loadCloudInteractions(approvedItem);
      loadCloudSupplements(approvedItem);
      return;
    }

    const discoverItem = typeof getDiscoverFeedItemById === 'function'
      ? getDiscoverFeedItemById(itemId)
      : null;
    if (discoverItem && DISCUSSABLE_DISCOVER_CONTENT_IDS.has(String(discoverItem.id || ''))) {
      const target = {
        targetType: 'content',
        targetId: String(discoverItem.id),
        targetTitle: String(discoverItem.title || '发现内容')
      };
      setDiscoverDiscussionEntryAvailable(true);
      loadCloudInteractions(target);
      return;
    }

    activeInteractionTarget = null;
    activeInteractionSubmissionId = '';
    setDiscoverDiscussionEntryAvailable(false);
  }

  async function loadCloudPublicFeed() {
    try {
      if (typeof loadDiscoverLikes === 'function') loadDiscoverLikes();
      const result = await callCore({ action: 'getPublic', limit: 50 });
      approvedSubmissionItems = await mapPublicItems(result.items || []);
      if (typeof renderDiscoverFeed === 'function') renderDiscoverFeed();
    } catch (error) {
      console.warn('[CloudBase public feed]', error);
      if (typeof renderDiscoverFeed === 'function') renderDiscoverFeed();
    }
  }

  function scheduleCloudPublicFeedRefresh() {
    if (publicFeedRefreshTimer) return;
    publicFeedRefreshTimer = setInterval(() => {
      const discoverView = document.getElementById('view-discover');
      if (!discoverView || discoverView.classList.contains('hidden') || document.hidden) return;
      loadCloudPublicFeed();
    }, PUBLIC_FEED_REFRESH_MS);
  }

  async function submitToCloud(event) {
    event.preventDefault();
    if (!selectedUploadFile) {
      if (typeof showToast === 'function') showToast('请先选择或录制一个素材', 'upload-cloud');
      return;
    }
    if (selectedUploadFile.size <= 0 || selectedUploadFile.size > MAX_FILE_BYTES) {
      if (typeof showToast === 'function') showToast('素材大小必须在 25MB 以内', 'alert-circle');
      return;
    }
    if (!currentLocation || !currentLocation.isReal) {
      if (typeof showToast === 'function') showToast('请先点击定位按钮取得真实 GPS', 'map-pin');
      return;
    }

    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    const originalHtml = submitButton.innerHTML;
    submitButton.disabled = true;
      submitButton.textContent = '正在上传...';
    let uploadedFileID = '';
    try {
      const user = await ensureCloudUser();
      const uid = user.uid || user.id;
      const cloudPath = `submissions/${uid}/${Date.now()}-${randomPart()}.${fileExtension(selectedUploadFile)}`;
      const upload = await cloudApp.uploadFile({
        cloudPath,
        filePath: selectedUploadFile,
        onUploadProgress(progress) {
          if (!progress || !progress.total) return;
          submitButton.textContent = `正在上传 ${Math.round(progress.loaded / progress.total * 100)}%`;
        }
      });
      uploadedFileID = upload.fileID;
      if (!uploadedFileID) throw new Error('云存储未返回 fileID');

      const result = await callCore({
        action: 'createSubmission',
        fileID: uploadedFileID,
        cloudPath,
        title: selectedUploadFile.name || '未命名文化采集素材',
        description: typeof getCollectDescription === 'function' ? getCollectDescription() : '',
        assetType: typeof getSelectedAssetType === 'function' ? getSelectedAssetType() : 'image',
        mimeType: selectedUploadFile.type || '',
        size: selectedUploadFile.size,
        longitude: currentLocation.longitude,
        latitude: currentLocation.latitude,
        locationAccuracy: currentLocation.accuracy,
        regionName: '湖北'
      });
      const aiTask = await enqueueCloudAiReview(result.submission.id);

      if (typeof showToast === 'function') {
        const queueLabel = aiTask.status === 'queued' ? '，已进入初审' : '，已进入人工审核';
        showToast(`投稿成功${queueLabel}，审核编号 ${result.submission.id || ''}`, 'check-circle');
      }
      if (typeof resetFilePreview === 'function') {
        resetFilePreview({ stopPropagation() {} });
      }
      const description = document.getElementById('collect-description');
      if (description) description.value = '';
      await refreshCloudProfile();
      if (typeof switchTab === 'function') switchTab('profile');
    } catch (error) {
      if (uploadedFileID) {
        try { await cloudApp.deleteFile({ fileList: [uploadedFileID] }); } catch (_) {}
      }
      if (typeof showToast === 'function') showToast(error.message || '云端投稿失败', 'alert-circle');
      else alert(error.message || '云端投稿失败');
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = originalHtml;
      if (window.lucide) lucide.createIcons();
    }
  }

  function prepareFormalCloudUi() {
    injectAccountUi();
    injectLoginModal();
    injectProductModals();
    const headerAccount = document.getElementById('header-account-entry');
    if (headerAccount && !headerAccount.dataset.cloudBound) {
      headerAccount.dataset.cloudBound = 'true';
      headerAccount.addEventListener('click', async () => {
        try {
          const user = await ensureCloudUser();
          if (isStableAccount(user)) {
            if (typeof switchTab === 'function') switchTab('profile');
          } else {
            openCloudLogin();
          }
        } catch (error) {
          if (typeof showToast === 'function') showToast(error.message || '账号服务暂不可用', 'alert-circle');
        }
      });
    }
    if (typeof setCloudAiMode === 'function') setCloudAiMode(AI_REVIEW_ENABLED);
    const collectForm = document.getElementById('collect-form');
    const submitButton = collectForm && collectForm.querySelector('button[type="submit"] span');
    if (submitButton) submitButton.textContent = '上传并提交审核';
  }

  loadApprovedSubmissionFeed = loadCloudPublicFeed;
  handleUploadSubmit = submitToCloud;
  window.openCloudLogin = openCloudLogin;
  window.refreshCloudProfile = refreshCloudProfile;
  window.requestCloudAiReview = requestCloudAiReview;
  window.verifyCloudLocation = verifyCloudLocation;
  window.planCloudRoute = planCloudRoute;
  window.submitCloudSubmission = submitToCloud;
  window.toggleSubmissionLike = toggleCloudLike;
  window.openDiscoverDetail = openCloudDiscoverDetail;
  window.renderSupplementSlots = renderCloudSupplementSlots;
  window.triggerDiscoverSupplementUpload = triggerCloudSupplementUpload;
  window.handleDiscoverSupplementUpload = submitCloudSupplement;
  window.replyCloudComment = (commentId) => {
    activeReplyCommentId = commentId;
    const comment = loadedInteractionComments.find((item) => item.id === commentId);
    updateReplyIndicator(comment && comment.authorName);
    const input = document.getElementById('cloud-comment-input');
    if (input) input.focus();
  };
  window.deleteCloudComment = deleteCloudComment;
  window.reportCloudContent = reportCloudContent;
  window.openCloudDiscussion = openCloudDiscussion;
  window.openActiveCloudDiscussion = openActiveCloudDiscussion;
  window.closeCloudDiscussion = closeCloudDiscussion;
  window.openCloudNotifications = openCloudNotifications;
  window.submitCloudManualReview = async () => {
    throw new Error('请使用正式提交按钮将素材写入 CloudBase 审核池');
  };

  document.addEventListener('DOMContentLoaded', async () => {
    prepareFormalCloudUi();
    const notificationEntry = document.getElementById('header-notification-entry');
    if (notificationEntry) notificationEntry.addEventListener('click', openCloudNotifications);
    const notificationClose = document.getElementById('cloud-notification-close');
    if (notificationClose) notificationClose.addEventListener('click', closeCloudNotifications);
    const notificationReadAll = document.getElementById('cloud-notification-read-all');
    if (notificationReadAll) notificationReadAll.addEventListener('click', markAllCloudNotificationsRead);
    const notificationList = document.getElementById('cloud-notification-list');
    if (notificationList) notificationList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-notification-id]');
      if (button) openCloudNotification(button.dataset.notificationId);
    });
    const commentForm = document.getElementById('cloud-comment-form');
    if (commentForm) commentForm.addEventListener('submit', submitCloudComment);
    const commentInput = document.getElementById('cloud-comment-input');
    if (commentInput) commentInput.addEventListener('input', () => {
      const counter = document.getElementById('cloud-comment-count');
      if (counter) counter.textContent = `${commentInput.value.length}/500`;
    });
    const cancelReply = document.getElementById('cloud-reply-cancel');
    if (cancelReply) cancelReply.addEventListener('click', () => {
      activeReplyCommentId = '';
      updateReplyIndicator();
    });
    const reportSubmission = document.getElementById('cloud-report-submission');
    if (reportSubmission) reportSubmission.addEventListener('click', () => {
      reportCloudContent('submission', activeInteractionSubmissionId);
    });
    const discussionClose = document.getElementById('cloud-discussion-close');
    if (discussionClose) discussionClose.addEventListener('click', closeCloudDiscussion);
    const loadMoreComments = document.getElementById('cloud-comment-load-more');
    if (loadMoreComments) loadMoreComments.addEventListener('click', async () => {
      loadMoreComments.disabled = true;
      try {
        await loadCloudInteractions(activeInteractionTarget, { append: true });
      } finally {
        loadMoreComments.disabled = false;
      }
    });
    const reportForm = document.getElementById('cloud-report-form');
    if (reportForm) reportForm.addEventListener('submit', submitCloudReport);
    const reportClose = document.getElementById('cloud-report-close');
    if (reportClose) reportClose.addEventListener('click', closeCloudReportModal);
    const reportCancel = document.getElementById('cloud-report-cancel');
    if (reportCancel) reportCancel.addEventListener('click', closeCloudReportModal);
    await refreshCloudProfile();
    await loadCloudPublicFeed();
    scheduleCloudPublicFeedRefresh();
  });
})();
