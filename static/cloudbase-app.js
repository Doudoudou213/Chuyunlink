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
let activeReward = null;
let rewardRedeemPending = false;
let pendingCommentRequestId = '';
let pendingCommentFingerprint = '';
let activeStoryEvidenceResult = null;
let activeStoryEvidenceView = 'story';
let activeStoryEvidenceNodeId = '';
let storyFeedbackSubmitting = false;
let activeStoryGapTask = null;
  let cloudNotifications = [];
  let cloudNotificationUnreadCount = 0;
  const cloudSupplementState = new Map();
  let publicFeedRefreshTimer = null;
  const PUBLIC_FEED_REFRESH_MS = 60 * 1000;
  let unifiedResources = [];
  let unifiedResourceSyncState = { status: 'idle', count: 0, updatedAt: null };
  let unifiedRelatedRequestId = 0;
  let activeUnifiedResourceDetail = null;
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
feedback_closed: '反馈处理',
      reward_redeemed: '兑换核销'
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
    if (String(item.type || '').startsWith('story_contribution_')) {
      if (typeof switchTab === 'function') switchTab('profile');
      document.getElementById('cloud-contribution-impact')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
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
      <section id="cloud-contribution-impact" class="overflow-hidden rounded-2xl border border-[#b68a4a]/30 bg-[#fffaf1] shadow-sm">
        <div class="flex items-stretch">
          <div class="flex w-14 shrink-0 items-center justify-center bg-[#241a17] text-[#e3bd69]"><span class="cultural-font text-2xl font-black">链</span></div>
          <div class="min-w-0 flex-1 p-4">
            <div class="flex items-start justify-between gap-3"><div><p class="text-[9px] font-black uppercase tracking-[0.16em] text-[#9e2f24]">我的文化贡献</p><h4 class="mt-1 text-sm font-bold text-stone-900">被故事采用的真实资料</h4></div><strong id="cloud-impact-adopted" class="text-2xl text-[#7d2b23]">0</strong></div>
            <div class="mt-3 grid grid-cols-2 gap-2 text-center"><div class="rounded-lg bg-white p-2"><strong id="cloud-impact-stories" class="block text-sm text-stone-800">0</strong><span class="text-[9px] text-stone-400">帮助补全故事</span></div><div class="rounded-lg bg-white p-2"><strong id="cloud-impact-points" class="block text-sm text-stone-800">0</strong><span class="text-[9px] text-stone-400">贡献额外积分</span></div></div>
            <div id="cloud-impact-recent" class="mt-3"></div>
          </div>
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
      <div id="cloud-reward-modal" class="hidden fixed inset-0 z-[92] flex items-center justify-center bg-black/70 p-4">
        <div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-[9px] font-black uppercase tracking-[0.18em] text-sandGold">Reward</p>
              <h3 id="cloud-reward-modal-title" class="mt-1 text-base font-bold text-stone-900">确认兑换</h3>
              <p id="cloud-reward-modal-sponsor" class="mt-1 text-[10px] text-stone-500"></p>
            </div>
            <button type="button" data-close-reward class="text-stone-400" aria-label="关闭">✕</button>
          </div>
          <p id="cloud-reward-modal-description" class="mt-3 rounded-xl bg-stone-50 p-3 text-[10px] leading-relaxed text-stone-600"></p>
          <div class="mt-3 grid grid-cols-2 gap-2 text-center">
            <div class="rounded-xl border border-stone-200 p-3">
              <p class="text-[9px] text-stone-400">需要积分</p>
              <p id="cloud-reward-modal-cost" class="mt-1 text-lg font-black text-deepTeal">0</p>
            </div>
            <div class="rounded-xl border border-stone-200 p-3">
              <p class="text-[9px] text-stone-400">当前积分</p>
              <p id="cloud-reward-modal-balance" class="mt-1 text-lg font-black text-deepTeal">0</p>
            </div>
          </div>
          <p id="cloud-reward-message" class="mt-2 min-h-4 text-[10px] text-red-600"></p>
          <div class="mt-2 flex gap-2">
            <button type="button" data-close-reward class="flex-1 rounded-xl bg-stone-100 py-2.5 text-xs font-bold text-stone-600">再想想</button>
            <button id="cloud-reward-confirm" type="button" class="flex-1 rounded-xl bg-deepTeal py-2.5 text-xs font-bold text-sandGold">确认兑换</button>
          </div>
          <p class="mt-3 text-center text-[9px] text-stone-400">兑换成功后积分立即扣除，凭证可在“我的兑换”中找回。</p>
        </div>
      </div>
      <div id="cloud-redemption-result-modal" class="hidden fixed inset-0 z-[94] flex items-center justify-center bg-black/75 p-4">
        <div class="w-full max-w-sm overflow-hidden rounded-3xl bg-white text-center shadow-2xl">
          <div class="bg-deepTeal px-5 pb-5 pt-6 text-white">
          <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <span class="text-xl">✓</span>
          </div>
            <p class="mt-3 text-[9px] font-black uppercase tracking-[0.22em] text-sandGold">ChuLink Voucher</p>
            <h3 class="mt-1 text-lg font-black">兑换成功</h3>
            <p id="cloud-redemption-result-title" class="mt-1 text-[10px] text-stone-200"></p>
          </div>
          <div class="px-5 pb-5 pt-4">
            <div class="rounded-2xl border border-stone-200 bg-[#fffdf8] p-4 shadow-inner">
              <div class="flex items-center justify-between gap-2">
                <p class="text-[9px] font-black uppercase tracking-[0.16em] text-stone-400">演示核销条码</p>
                <span class="rounded-full bg-amber-50 px-2 py-1 text-[8px] font-black text-amber-700">DEMO</span>
              </div>
              <div id="cloud-redemption-result-barcode" class="mt-3 min-h-[78px] w-full overflow-hidden rounded-lg bg-white px-2 py-1" aria-label="兑换码条形码"></div>
              <p id="cloud-redemption-result-code" class="mt-2 break-all font-mono text-base font-black tracking-[0.15em] text-deepTeal"></p>
              <button id="cloud-redemption-copy" type="button" class="mt-3 rounded-lg border border-deepTeal/20 bg-white px-3 py-1.5 text-[10px] font-bold text-deepTeal">复制兑换码</button>
            </div>
            <p id="cloud-redemption-result-expiry" class="mt-3 text-[10px] font-bold text-cinnabarRed"></p>
            <p id="cloud-redemption-result-instructions" class="mt-2 rounded-xl bg-stone-50 p-3 text-left text-[10px] leading-relaxed text-stone-600"></p>
            <p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-left text-[9px] leading-relaxed text-amber-800">当前为平台演示凭证，用于验证生成、展示和管理员核销流程；接入合作商家后再替换为真实权益券。</p>
            <button id="cloud-redemption-result-close" type="button" class="mt-4 w-full rounded-xl bg-deepTeal py-2.5 text-xs font-bold text-sandGold">收好兑换码</button>
          </div>
        </div>
      </div>
    `);
    document.querySelectorAll('[data-close-profile-edit]').forEach((button) => {
      button.addEventListener('click', () => document.getElementById('cloud-profile-edit-modal').classList.add('hidden'));
    });
    document.querySelectorAll('[data-close-feedback]').forEach((button) => {
      button.addEventListener('click', () => document.getElementById('cloud-feedback-modal').classList.add('hidden'));
    });
    document.querySelectorAll('[data-close-reward]').forEach((button) => {
      button.addEventListener('click', () => document.getElementById('cloud-reward-modal').classList.add('hidden'));
    });
    document.getElementById('cloud-profile-edit-form').addEventListener('submit', saveCloudNickname);
    document.getElementById('cloud-feedback-form').addEventListener('submit', submitCloudFeedback);
    document.getElementById('cloud-reward-confirm').addEventListener('click', confirmCloudRewardRedemption);
    document.getElementById('cloud-redemption-copy').addEventListener('click', copyActiveRedemptionCode);
    document.getElementById('cloud-redemption-result-close').addEventListener('click', () => {
      document.getElementById('cloud-redemption-result-modal').classList.add('hidden');
    });
  }

  function openCloudLogin() {
    injectLoginModal();
    switchCloudAuthMode('login');
    document.getElementById('cloud-login-modal').classList.remove('hidden');
  }

  function injectStoryEvidenceModal() {
    if (document.getElementById('cloud-story-evidence-modal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="cloud-story-evidence-modal" class="hidden fixed inset-0 z-[96] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
        <section class="story-evidence-shell max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl shadow-2xl sm:rounded-3xl">
          <header class="story-evidence-header sticky top-0 z-10 flex items-start justify-between gap-4 px-5 py-4">
            <div>
              <p class="text-[9px] font-black tracking-[0.24em] text-[#d7b46e]">楚韵链迹 · 共同讲述</p>
              <h2 id="cloud-story-evidence-title" class="cultural-font mt-1 text-lg font-black text-[#fff5df]">链迹故事</h2>
              <p id="cloud-story-evidence-subtitle" class="mt-1 text-[10px] text-[#e7d7c4]/70">由社区共同留下的真实文化资料</p>
            </div>
            <button id="cloud-story-evidence-close" type="button" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-[#fff5df]" aria-label="关闭链迹故事">✕</button>
          </header>
          <div id="cloud-story-evidence-content" class="p-4 sm:p-5">
            <div class="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-500">正在整理资料来源...</div>
          </div>
        </section>
        <div id="cloud-story-claim-drawer" class="hidden fixed inset-0 z-[97] flex items-end bg-black/45">
          <section class="max-h-[78vh] w-full overflow-y-auto rounded-t-3xl border-t border-[#d7b46e]/30 bg-[#fffaf1] px-5 pb-7 pt-4 shadow-2xl sm:mx-auto sm:max-w-xl">
            <div class="sticky top-0 z-10 flex items-center justify-between gap-3 bg-[#fffaf1]/95 pb-3 backdrop-blur">
              <div><p class="text-[9px] font-black tracking-[0.2em] text-[#9e2f24]">句级依据</p><h3 class="mt-1 font-black text-stone-900">这句话依据什么</h3></div>
              <button id="cloud-story-claim-close" type="button" class="flex h-11 w-11 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700" aria-label="关闭依据详情">✕</button>
            </div>
            <div id="cloud-story-claim-content"></div>
          </section>
        </div>
      </div>
    `);
    document.getElementById('cloud-story-evidence-close').addEventListener('click', closeStoryEvidence);
    document.getElementById('cloud-story-evidence-modal').addEventListener('click', (event) => {
      if (event.target.id === 'cloud-story-evidence-modal') closeStoryEvidence();
    });
    document.getElementById('cloud-story-claim-close').addEventListener('click', closeStoryClaimDrawer);
    document.getElementById('cloud-story-claim-drawer').addEventListener('click', (event) => {
      if (event.target.id === 'cloud-story-claim-drawer') closeStoryClaimDrawer();
    });
  }

  function closeStoryEvidence() {
    closeStoryClaimDrawer();
    const modal = document.getElementById('cloud-story-evidence-modal');
    if (modal) modal.classList.add('hidden');
  }

  function closeStoryClaimDrawer() {
    const drawer = document.getElementById('cloud-story-claim-drawer');
    if (drawer) drawer.classList.add('hidden');
  }

  function storyRelationLabel(value) {
    return {
      documents_feature: '建筑与工艺记录',
      documents_inscription: '题刻与文字记录',
      documents_place: '地点现状记录',
      documents_oral_history: '口述与回忆',
      shows_change_over_time: '时间变化见证',
      supports_story: '故事线索补充'
    }[value] || '故事线索补充';
  }

  function storyEvidenceMedia(submission) {
    const fileUrl = safeText(submission && submission.fileUrl);
    if (!fileUrl) return '';
    if (submission.assetType === 'audio') {
      return `<audio controls preload="none" class="mt-3 w-full" src="${fileUrl}"></audio>`;
    }
    if (submission.assetType === 'video') {
      return `<video controls preload="metadata" class="mt-3 max-h-72 w-full rounded-xl bg-black" src="${fileUrl}"></video>`;
    }
    return `<img loading="lazy" src="${fileUrl}" alt="${safeText(submission.title || '社区资料')}" class="mt-3 max-h-80 w-full rounded-xl object-cover">`;
  }

  function renderStoryBodyWithClaims(body, claims, chapterIndex) {
    const text = String(body || '');
    const positioned = (claims || [])
      .filter((claim) => Number(claim.chapterIndex) === chapterIndex && claim.text)
      .map((claim) => ({ ...claim, position: text.indexOf(claim.text) }))
      .filter((claim) => claim.position >= 0)
      .sort((left, right) => left.position - right.position || right.text.length - left.text.length);
    if (!positioned.length) return safeText(text).replace(/\n/g, '<br>');
    let cursor = 0;
    let number = 0;
    const parts = [];
    positioned.forEach((claim) => {
      if (claim.position < cursor) return;
      parts.push(safeText(text.slice(cursor, claim.position)));
      parts.push(safeText(text.slice(claim.position, claim.position + claim.text.length)));
      number += 1;
      parts.push(`<button type="button" data-story-open-claim="${safeText(claim.id)}" class="mx-1 inline-flex min-h-7 items-center rounded-full border border-[#9e2f24]/25 bg-[#9e2f24]/5 px-2 py-0.5 align-middle text-[9px] font-black text-[#8f302b]" aria-label="查看第 ${number} 条事实依据">依据 ${number}</button>`);
      cursor = claim.position + claim.text.length;
    });
    parts.push(safeText(text.slice(cursor)));
    return parts.join('').replace(/\n/g, '<br>');
  }

  function openStoryClaimDrawer(claimId) {
    const result = activeStoryEvidenceResult || {};
    const claim = (result.claims || []).find((item) => item.id === claimId);
    const drawer = document.getElementById('cloud-story-claim-drawer');
    const content = document.getElementById('cloud-story-claim-content');
    if (!claim || !drawer || !content) return;
    const sourceMap = new Map((result.items || []).map((item) => [item.id, item]));
    const sources = (claim.sourceLinkIds || []).map((id) => sourceMap.get(id)).filter(Boolean);
    content.innerHTML = `
      <blockquote class="rounded-2xl border-l-4 border-[#9e2f24] bg-white px-4 py-4 text-sm font-bold leading-7 text-stone-800">${safeText(claim.text)}</blockquote>
      <p class="mt-4 text-[10px] leading-relaxed text-stone-500">以下原始材料已经过投稿审核和管理员事实确认。它们只支撑上面这句话，不代表整篇故事的所有内容。</p>
      <div class="mt-4 space-y-3">
        ${sources.map((source, index) => {
          const submission = source.submission || {};
          return `<article class="rounded-2xl border border-[#d8c6a7] bg-white p-4">
            <div class="flex items-start gap-3"><span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#241a17] text-[10px] font-black text-[#e3bd69]">${index + 1}</span><div><h4 class="text-xs font-black text-stone-900">${safeText(submission.title || '社区文化记录')}</h4><p class="mt-1 text-[10px] leading-5 text-stone-500">${safeText(source.evidenceSummary || submission.description)}</p></div></div>
            ${storyEvidenceMedia(submission)}
            <p class="mt-3 border-t border-stone-100 pt-3 text-[9px] text-stone-400">贡献者：${safeText(submission.contributorName || '社区守护者')}${submission.regionName ? ` · ${safeText(submission.regionName)}` : ''}</p>
          </article>`;
        }).join('')}
      </div>`;
    drawer.classList.remove('hidden');
  }

  function renderStoryTrail(result) {
    const nodes = result.trail && Array.isArray(result.trail.nodes) ? result.trail.nodes.slice(0, 5) : [];
    if (nodes.length < 2) return '';
    return `
      <section class="overflow-hidden rounded-2xl border border-[#b68a4a]/25 bg-white p-4">
        <div class="flex items-end justify-between gap-3"><div><p class="text-[9px] font-black tracking-[0.18em] text-[#9e2f24]">朱漆链迹</p><h4 class="mt-1 text-sm font-black text-stone-900">这些材料为什么连在一起</h4></div><span class="text-[9px] text-stone-400">${Number(result.trail.totalEvidenceCount || nodes.length - 1)} 份资料</span></div>
        <div class="mt-4 overflow-x-auto pb-2">
          <ol class="flex min-w-max items-stretch">
            ${nodes.map((node, index) => `<li class="relative flex w-40 shrink-0 items-start ${index ? 'pl-7' : ''}">
              ${index ? '<span class="absolute left-0 top-4 h-0.5 w-7 bg-[#9e2f24]/55"></span>' : ''}
              ${node.kind === 'evidence' ? `<button type="button" data-story-trail-source="${safeText(node.sourceLinkId)}" class="w-full rounded-xl border border-[#eadbc3] bg-[#fffaf1] p-3 text-left transition hover:border-[#9e2f24]/40">` : '<div class="w-full rounded-xl bg-[#241a17] p-3 text-[#fff5df]">'}
                <span class="flex h-6 w-6 items-center justify-center rounded-full ${node.kind === 'resource' ? 'bg-[#d7b46e] text-[#241a17]' : 'bg-[#9e2f24] text-white'} text-[9px] font-black">${index + 1}</span>
                <strong class="mt-2 block text-[11px] leading-5">${safeText(node.label)}</strong>
                <span class="mt-1 block text-[9px] leading-4 ${node.kind === 'resource' ? 'text-[#eadcca]/70' : 'text-stone-500'}">${safeText(node.why)}</span>
              ${node.kind === 'evidence' ? '</button>' : '</div>'}
            </li>`).join('')}
          </ol>
        </div>
        <p class="mt-1 text-[9px] text-stone-400">点击材料节点可查看原始记录；链迹只表达已确认关系，不表示 AI 已证明历史因果。</p>
      </section>`;
  }

  function storyGraphLines(value, maxLength) {
    const text = String(value || '').trim();
    if (!text) return ['未命名'];
    const compact = text.length > maxLength * 2 ? `${text.slice(0, maxLength * 2 - 1)}…` : text;
    return compact.length > maxLength
      ? [compact.slice(0, maxLength), compact.slice(maxLength)]
      : [compact];
  }

  function storyGraphText(lines, x, color, size, weight) {
    const startY = lines.length > 1 ? -5 : 3;
    return `<text x="${x}" y="${startY}" text-anchor="middle" fill="${color}" font-size="${size}" font-weight="${weight}" font-family="'Noto Serif SC', serif">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? 14 : 0}">${safeText(line)}</tspan>`).join('')}</text>`;
  }

  function renderStoryEvidenceGraph(result) {
    const items = (result.items || []).slice(0, 16);
    const resource = result.resource || {};
    const groups = [];
    const groupMap = new Map();
    items.forEach((item) => {
      const key = item.relationType || 'supports_story';
      if (!groupMap.has(key)) {
        const group = { key, label: storyRelationLabel(key), items: [] };
        groupMap.set(key, group);
        groups.push(group);
      }
      groupMap.get(key).items.push(item);
    });
    const rowGap = 70;
    const graphHeight = Math.max(360, items.length * rowGap + 70);
    let nextY = 55;
    groups.forEach((group) => {
      group.items.forEach((item) => {
        item.__storyGraphY = nextY;
        nextY += rowGap;
      });
      group.__storyGraphY = group.items.reduce((sum, item) => sum + item.__storyGraphY, 0) / group.items.length;
    });
    const rootY = groups.reduce((sum, group) => sum + group.__storyGraphY, 0) / Math.max(1, groups.length);
    const relations = groups.map((group) => `
      <path d="M 190 ${rootY} C 235 ${rootY}, 225 ${group.__storyGraphY}, 270 ${group.__storyGraphY}" fill="none" stroke="#c5a766" stroke-width="2" stroke-linecap="round" opacity="0.8"/>
      ${group.items.map((item) => `
        <path d="M 440 ${group.__storyGraphY} C 500 ${group.__storyGraphY}, 500 ${item.__storyGraphY}, 565 ${item.__storyGraphY}" fill="none" stroke="#6e9995" stroke-width="1.6" stroke-linecap="round" opacity="0.72"/>
      `).join('')}
    `).join('');
    const groupNodes = groups.map((group) => `
      <g transform="translate(355 ${group.__storyGraphY})">
        <rect x="-85" y="-24" width="170" height="48" rx="12" fill="#f4e7c9" stroke="#c5a766" stroke-width="1.4"/>
        ${storyGraphText(storyGraphLines(group.label, 9), 0, '#5f4926', 12, 700)}
      </g>
    `).join('');
    const evidenceNodes = items.map((item, index) => {
      const submission = item.submission || {};
      const selected = activeStoryEvidenceNodeId === item.id;
      return `
        <g data-story-evidence-node="${safeText(item.id)}" transform="translate(695 ${item.__storyGraphY})" role="button" tabindex="0" style="cursor:pointer">
          <rect x="-130" y="-27" width="260" height="54" rx="13" fill="${selected ? '#173f40' : '#ffffff'}" stroke="${selected ? '#d9ad52' : '#b9cbc8'}" stroke-width="${selected ? 2.4 : 1.2}"/>
          <circle cx="-106" cy="0" r="14" fill="${selected ? '#d9ad52' : '#eaf2f0'}"/>
          <text x="-106" y="4" text-anchor="middle" fill="${selected ? '#173f40' : '#315c5c'}" font-size="10" font-weight="800">${index + 1}</text>
          ${storyGraphText(storyGraphLines(submission.title || '社区文化记录', 13), 15, selected ? '#ffffff' : '#263c3a', 12, 700)}
        </g>`;
    }).join('');
    const selectedItem = items.find((item) => item.id === activeStoryEvidenceNodeId) || items[0];
    const selectedSubmission = selectedItem && selectedItem.submission || {};
    return `
      <div class="rounded-2xl border border-[#d8c6a7] bg-[#f6eedf] p-3 shadow-inner">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
          <div>
            <p class="text-[9px] font-black uppercase tracking-[0.18em] text-[#9b733b]">真实资料关系图</p>
            <p class="mt-1 text-[10px] text-stone-500">中心资源 → 关系类型 → 已审核投稿；点击右侧节点查看依据</p>
          </div>
          <div class="flex gap-3 text-[9px] text-stone-500"><span>● 文化资源</span><span>■ 关系</span><span>□ 投稿</span></div>
        </div>
        <div class="overflow-x-auto rounded-xl border border-[#c5a766]/40 bg-[#173f40]">
          <svg class="min-w-[840px] w-full" viewBox="0 0 850 ${graphHeight}" role="img" aria-label="${safeText(resource.title || '文化资源')}链迹思维导图">
            <defs>
              <pattern id="story-graph-pattern" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#d9ad52" stroke-width="0.45" opacity="0.08"/></pattern>
            </defs>
            <rect width="850" height="${graphHeight}" fill="#173f40"/>
            <rect width="850" height="${graphHeight}" fill="url(#story-graph-pattern)"/>
            ${relations}
            <g transform="translate(115 ${rootY})">
              <rect x="-75" y="-35" width="150" height="70" rx="18" fill="#8f302b" stroke="#e6c880" stroke-width="2"/>
              ${storyGraphText(storyGraphLines(resource.title || '文化资源', 8), 0, '#fff4d6', 14, 800)}
            </g>
            ${groupNodes}
            ${evidenceNodes}
          </svg>
        </div>
        ${selectedItem ? `
          <section class="mt-3 rounded-xl border border-[#d8c6a7] bg-white p-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div><p class="text-[9px] font-black tracking-[0.14em] text-[#9b733b]">${safeText(storyRelationLabel(selectedItem.relationType))}</p><h3 class="mt-1 font-bold text-stone-900">${safeText(selectedSubmission.title || '社区文化记录')}</h3></div>
              <span class="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold text-emerald-700">已审核来源</span>
            </div>
            <p class="mt-3 text-xs leading-relaxed text-stone-600">${safeText(selectedItem.evidenceSummary)}</p>
            <div class="mt-3 flex items-center justify-between border-t border-stone-100 pt-3 text-[10px] text-stone-400">
              <span>记录者：${safeText(selectedSubmission.contributorName || '社区守护者')}</span>
              <button type="button" data-story-open-timeline="${safeText(selectedItem.id)}" class="font-bold text-deepTeal">在时间线查看 →</button>
            </div>
          </section>` : ''}
        ${(result.items || []).length > items.length ? `<p class="mt-2 text-center text-[9px] text-stone-500">图谱先展示前 ${items.length} 份资料，时间线保留全部内容。</p>` : ''}
      </div>`;
  }

  function renderStoryEvidenceGraphV2(result) {
    const items = (result.items || []).slice(0, 24);
    const resource = result.resource || {};
    const groups = [];
    const groupMap = new Map();
    items.forEach((item) => {
      const key = item.relationType || 'supports_story';
      if (!groupMap.has(key)) {
        const group = { key, label: storyRelationLabel(key), items: [] };
        groupMap.set(key, group);
        groups.push(group);
      }
      groupMap.get(key).items.push(item);
    });
    const selectedItem = items.find((item) => item.id === activeStoryEvidenceNodeId) || items[0];
    const selectedSubmission = selectedItem && selectedItem.submission || {};
    let runningIndex = 0;
    return `
      <div class="space-y-4">
        <section class="relative overflow-hidden rounded-2xl border border-[#b68a4a]/35 bg-gradient-to-br from-[#17110f] via-[#3c1b18] to-[#772a23] px-5 py-5 text-white shadow-sm">
          <div class="absolute -right-8 -top-8 h-28 w-28 rounded-full border border-white/10"></div>
          <div class="absolute -right-2 top-5 h-16 w-16 rounded-full border border-[#d9ad52]/20"></div>
          <p class="text-[9px] font-black tracking-[0.2em] text-[#e3bd69]">链迹起点</p>
          <h3 class="mt-2 text-lg font-black leading-snug">${safeText(resource.title || '湖北文化资源')}</h3>
          <p class="mt-2 max-w-xl text-xs leading-relaxed text-white/70">${items.length} 份经过审核的社区记录，从不同角度补充这条文化线索。向下阅读即可看到它们为什么被串联在一起。</p>
          <div class="mt-4 flex flex-wrap gap-2 text-[9px] font-bold">
            ${groups.map((group) => `<span class="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">${safeText(group.label)} · ${group.items.length}</span>`).join('')}
          </div>
        </section>

        <div class="space-y-5">
          ${groups.map((group) => `
            <section class="relative pl-6 sm:pl-8">
              <span class="absolute bottom-0 left-[7px] top-7 w-px bg-gradient-to-b from-[#c5a766] to-[#c5a766]/10"></span>
              <span class="absolute left-0 top-1.5 h-4 w-4 rounded-full border-4 border-[#faf8f2] bg-[#b99855] shadow-sm"></span>
              <header class="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p class="text-[9px] font-black tracking-[0.16em] text-[#9b733b]">关系 ${String(groups.indexOf(group) + 1).padStart(2, '0')}</p>
                  <h4 class="mt-1 text-sm font-black text-stone-900">${safeText(group.label)}</h4>
                </div>
                <span class="rounded-full bg-stone-100 px-2.5 py-1 text-[9px] font-bold text-stone-500">${group.items.length} 份资料</span>
              </header>
              <div class="grid gap-3 sm:grid-cols-2">
                ${group.items.map((item) => {
                  runningIndex += 1;
                  const submission = item.submission || {};
                  const selected = selectedItem && selectedItem.id === item.id;
                  return `
                    <article data-story-evidence-node="${safeText(item.id)}" role="button" tabindex="0" class="group cursor-pointer rounded-2xl border ${selected ? 'border-[#b99855] bg-[#fffaf0] ring-2 ring-[#b99855]/15' : 'border-stone-200 bg-white hover:border-[#b99855]/60'} p-4 shadow-sm transition">
                      <div class="flex items-start gap-3">
                        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${selected ? 'bg-[#241a17] text-[#e3bd69]' : 'bg-[#f3e8d7] text-[#7d2b23]'} text-[10px] font-black">${runningIndex}</span>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-start justify-between gap-2">
                            <h5 class="text-xs font-black leading-5 text-stone-800">${safeText(submission.title || '社区文化记录')}</h5>
                            <span class="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[8px] font-bold text-emerald-700">已核实</span>
                          </div>
                          <p class="mt-2 line-clamp-3 text-[11px] leading-5 text-stone-500">${safeText(item.evidenceSummary || submission.description || '这份记录补充了该资源的一条可靠线索。')}</p>
                          <p class="mt-3 border-t border-stone-100 pt-2 text-[9px] text-stone-400">${safeText(submission.contributorName || '社区记录者')}${submission.regionName ? ` · ${safeText(submission.regionName)}` : ''}</p>
                        </div>
                      </div>
                    </article>`;
                }).join('')}
              </div>
            </section>`).join('')}
        </div>

        ${selectedItem ? `
          <section class="rounded-2xl border border-[#d8c6a7] bg-[#f7f1e5] p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
            <div>
              <p class="text-[9px] font-black tracking-[0.14em] text-[#9b733b]">当前选中的原始记录</p>
              <h4 class="mt-1 text-sm font-bold text-stone-900">${safeText(selectedSubmission.title || '社区文化记录')}</h4>
              <p class="mt-1 text-[11px] leading-5 text-stone-500">${safeText(selectedItem.evidenceSummary)}</p>
            </div>
            <button type="button" data-story-open-timeline="${safeText(selectedItem.id)}" class="mt-3 min-h-11 shrink-0 rounded-xl bg-[#241a17] px-4 py-2.5 text-[10px] font-bold text-[#e3bd69] sm:mt-0">查看完整记录</button>
          </section>` : ''}
        ${(result.items || []).length > items.length ? `<p class="text-center text-[9px] text-stone-400">当前展示前 ${items.length} 份资料，完整内容保留在资料时间线中。</p>` : ''}
      </div>`;
  }

  function renderStoryEvidenceTimeline(items) {
    return `<div class="relative space-y-4 before:absolute before:bottom-5 before:left-[17px] before:top-5 before:w-px before:bg-sandGold/50">
      ${items.map((item, index) => {
        const submission = item.submission || {};
        const date = submission.createdAt ? new Date(submission.createdAt).toLocaleDateString('zh-CN') : '记录时间待补充';
        return `
          <article id="story-timeline-${safeText(item.id)}" class="relative pl-11">
            <span class="absolute left-0 top-4 z-[1] flex h-9 w-9 items-center justify-center rounded-full border-4 border-[#f3ebdd] bg-[#9e2f24] text-xs font-black text-[#fff5df]">${index + 1}</span>
            <div class="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <div class="flex flex-wrap items-start justify-between gap-2"><div><p class="text-[9px] font-black uppercase tracking-[0.14em] text-sandGold">${safeText(storyRelationLabel(item.relationType))}</p><h3 class="mt-1 font-bold text-stone-900">${safeText(submission.title || '社区文化记录')}</h3></div><span class="rounded-full bg-stone-100 px-2 py-1 text-[9px] text-stone-500">${safeText(date)}</span></div>
              <p class="mt-3 rounded-xl bg-stone-50 p-3 text-xs font-medium leading-relaxed text-stone-700">${safeText(item.evidenceSummary)}</p>
              ${storyEvidenceMedia(submission)}
              ${submission.description ? `<p class="mt-3 text-xs leading-relaxed text-stone-600">${safeText(submission.description)}</p>` : ''}
              <p class="mt-3 border-t border-stone-100 pt-3 text-[10px] text-stone-400">记录者：${safeText(submission.contributorName || '社区守护者')}${submission.regionName ? ` · ${safeText(submission.regionName)}` : ''}</p>
            </div>
          </article>`;
      }).join('')}
    </div>`;
  }

  function renderPublishedStory(result) {
    const story = result.story;
    if (!story) return '<div class="rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-500">这处资源还没有已发布的故事版本。</div>';
    const evidenceMap = new Map((result.items || []).map((item) => [item.id, item]));
    const gapTasks = Array.isArray(result.gapTasks) ? result.gapTasks : [];
    return `
      <article class="overflow-hidden rounded-2xl border border-[#b68a4a]/30 bg-[#fffaf1] shadow-[0_14px_38px_rgba(58,31,23,0.09)]">
        <header class="relative overflow-hidden bg-gradient-to-br from-[#17110f] via-[#401b18] to-[#762a23] px-5 py-6 text-white">
          <span class="absolute -bottom-8 -right-3 cultural-font text-[7rem] font-black leading-none text-white/5">楚</span>
          <p class="relative text-[9px] font-black uppercase tracking-[0.22em] text-[#d7b46e]">共同讲述 · 第 ${Number(story.version || 1)} 版</p>
          <h3 class="cultural-font relative mt-2 text-xl font-black leading-tight text-[#fff5df]">${safeText(story.title)}</h3>
          <p class="relative mt-3 text-xs leading-relaxed text-[#eadcca]/75">${safeText(story.introduction)}</p>
          ${story.revisionSummary ? `<div class="relative mt-4 rounded-xl border border-[#d7b46e]/20 bg-white/10 px-3 py-2.5 text-[10px] leading-5 text-[#f1dfbf]"><strong class="text-[#d7b46e]">本版修订</strong> · ${safeText(story.revisionSummary)}</div>` : ''}
        </header>
        <div class="space-y-5 p-5">
          ${(story.chapters || []).map((chapter, index) => {
            const sources = (chapter.sourceLinkIds || []).map((id) => evidenceMap.get(id)).filter(Boolean);
            return `
              <section class="story-chapter-rail relative pl-10">
                <span class="absolute left-0 top-0 z-[1] flex h-7 w-7 items-center justify-center rounded-full bg-[#9e2f24] text-xs font-black text-[#fff5df] shadow-[0_4px_10px_rgba(158,47,36,0.2)]">${index + 1}</span>
                <h4 class="cultural-font font-bold text-[#2b2421]">${safeText(chapter.title)}</h4>
                <p class="mt-2 text-sm leading-7 text-stone-700">${renderStoryBodyWithClaims(chapter.body, result.claims || [], index)}</p>
                <div class="mt-3 flex flex-wrap gap-2">
                  ${sources.map((source) => `<button type="button" data-story-open-source="${safeText(source.id)}" class="min-h-9 rounded-full border border-[#b68a4a]/30 bg-[#f7edda] px-3 py-1 text-[10px] font-bold text-[#735322]">来源 · ${safeText(source.submission && source.submission.title || '社区资料')}</button>`).join('')}
                </div>
              </section>`;
          }).join('')}
          ${renderStoryTrail(result)}
          ${story.closing ? `<footer class="rounded-xl bg-amber-50 p-4 text-xs leading-relaxed text-stone-700"><strong class="text-[#8f302b]">结语</strong><p class="mt-1">${safeText(story.closing)}</p></footer>` : ''}
          ${gapTasks.length ? `<section class="overflow-hidden rounded-2xl border border-[#9e2f24]/25 bg-white">
            <div class="border-b border-[#b68a4a]/20 bg-[#f8f0e2] px-4 py-3">
              <p class="text-[9px] font-black uppercase tracking-[0.14em] text-[#9e2f24]">帮助补全这段链迹</p>
              <p class="mt-1 text-[11px] leading-5 text-stone-600">任务由内容管理员发布。投稿通过审核并被采纳后，再由管理员确认积分。</p>
            </div>
            <div class="divide-y divide-stone-100">${gapTasks.map((task) => {
              const typeLabel = { image: '照片', audio: '录音', video: '视频', any: '照片、录音或视频' }[task.requestedAssetType] || '资料';
              const chapter = task.chapterIndex == null ? '整篇故事' : `第 ${Number(task.chapterIndex) + 1} 章`;
              return `<article class="p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
                <div class="min-w-0"><div class="flex flex-wrap gap-2"><span class="rounded-full bg-[#9e2f24]/8 px-2 py-1 text-[9px] font-bold text-[#8f302b]">${safeText(chapter)}</span><span class="rounded-full bg-stone-100 px-2 py-1 text-[9px] text-stone-500">征集${safeText(typeLabel)}</span></div><h4 class="mt-2 text-sm font-bold text-stone-900">${safeText(task.title)}</h4><p class="mt-1 text-[11px] leading-5 text-stone-600">${safeText(task.description)}</p>${Number(task.rewardPoints) > 0 ? `<p class="mt-2 text-[10px] font-bold text-[#8a6b32]">审核采纳后可获 ${Number(task.rewardPoints)} 积分 · 不自动发放</p>` : ''}</div>
                <button type="button" data-story-gap-task="${safeText(task.id)}" class="mt-3 min-h-11 shrink-0 rounded-xl bg-[#241a17] px-4 text-xs font-bold text-[#e3bd69] sm:mt-0">带着任务去采集</button>
              </article>`;
            }).join('')}</div>
          </section>` : ''}
          <p class="border-t border-stone-100 pt-3 text-[9px] leading-relaxed text-stone-400">本故事由已确认链迹资料编排，并经管理员审核发布。点击每章来源可回到对应的原始社区记录。</p>
          <section class="rounded-2xl border border-[#b68a4a]/25 bg-[#f8f0e2] p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="text-[10px] font-black tracking-[0.08em] text-[#8f302b]">一起校准这段讲述</p>
                <p class="mt-1 text-xs leading-relaxed text-[#66574c]">发现史实、来源或表述问题，可以直接指出具体章节。</p>
              </div>
              <button type="button" data-story-feedback-toggle class="min-h-11 rounded-full border border-[#9e2f24]/25 bg-white px-4 text-xs font-bold text-[#8f302b]">纠正或补充</button>
            </div>
            <form id="cloud-story-feedback-form" class="mt-4 hidden space-y-3 border-t border-[#b68a4a]/20 pt-4">
              <div class="grid gap-3 sm:grid-cols-2">
                <label class="text-[10px] font-bold text-stone-600">反馈类型
                  <select id="cloud-story-feedback-kind" class="mt-1 min-h-11 w-full rounded-xl border border-[#b68a4a]/30 bg-white px-3 text-xs text-stone-700 outline-none focus:border-[#9e2f24] focus:ring-2 focus:ring-[#9e2f24]/10">
                    <option value="content_error">内容可能有误</option>
                    <option value="source_suggestion">可以补充来源</option>
                    <option value="wording">表述可以更准确</option>
                  </select>
                </label>
                <label class="text-[10px] font-bold text-stone-600">对应位置
                  <select id="cloud-story-feedback-chapter" class="mt-1 min-h-11 w-full rounded-xl border border-[#b68a4a]/30 bg-white px-3 text-xs text-stone-700 outline-none focus:border-[#9e2f24] focus:ring-2 focus:ring-[#9e2f24]/10">
                    <option value="-1">整篇故事</option>
                    ${(story.chapters || []).map((chapter, index) => `<option value="${index}">第 ${index + 1} 章 · ${safeText(chapter.title)}</option>`).join('')}
                  </select>
                </label>
              </div>
              <label class="block text-[10px] font-bold text-stone-600">具体说明
                <textarea id="cloud-story-feedback-content" rows="4" maxlength="1200" required placeholder="请写明哪里需要调整；如有书目、照片或口述来源，也可在这里说明。" class="mt-1 w-full resize-none rounded-xl border border-[#b68a4a]/30 bg-white p-3 text-sm leading-relaxed text-stone-700 outline-none focus:border-[#9e2f24] focus:ring-2 focus:ring-[#9e2f24]/10"></textarea>
              </label>
              <p class="text-[9px] leading-relaxed text-stone-400">需要上传照片、音频或视频时，请回到相关投稿，使用“补充这段链迹”。</p>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <p id="cloud-story-feedback-message" class="min-h-4 text-[10px] text-[#9e2f24]"></p>
                <button type="submit" class="min-h-11 rounded-xl bg-[#9e2f24] px-5 text-xs font-bold text-[#fff5df] disabled:opacity-50">提交给内容管理员</button>
              </div>
            </form>
          </section>
        </div>
      </article>`;
  }

  function openStoryFeedbackForm() {
    if (!isStableAccount(cloudUser)) {
      openCloudLogin();
      if (typeof showToast === 'function') showToast('登录后可以提交故事纠错', 'log-in');
      return;
    }
    const form = document.getElementById('cloud-story-feedback-form');
    if (!form) return;
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) document.getElementById('cloud-story-feedback-content')?.focus();
  }

  async function submitStoryFeedback(event) {
    event.preventDefault();
    if (storyFeedbackSubmitting || !activeStoryEvidenceResult || !activeStoryEvidenceResult.story) return;
    const story = activeStoryEvidenceResult.story;
    const resource = activeStoryEvidenceResult.resource || {};
    const content = document.getElementById('cloud-story-feedback-content').value.trim();
    const message = document.getElementById('cloud-story-feedback-message');
    if (content.length < 5) {
      message.textContent = '请至少填写 5 个字，方便管理员核对。';
      return;
    }
    storyFeedbackSubmitting = true;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    message.textContent = '正在提交并绑定当前故事版本…';
    try {
      await callCore({
        action: 'createFeedback',
        type: 'story_correction',
        content,
        page: location.pathname || '/',
        resourceId: resource.id,
        storyId: story.id,
        storyVersion: story.version,
        chapterIndex: Number(document.getElementById('cloud-story-feedback-chapter').value),
        correctionKind: document.getElementById('cloud-story-feedback-kind').value
      });
      event.currentTarget.innerHTML = '<div class="rounded-xl border border-[#6f7d5e]/25 bg-[#f2f4ec] p-4 text-xs leading-relaxed text-[#4f5f43]"><strong>已提交并记录当前故事版本。</strong><br>管理员处理后，回复会出现在个人中心；原始故事不会被自动改写。</div>';
      refreshCloudProfile().catch(() => {});
      if (typeof showToast === 'function') showToast('故事反馈已提交', 'check-circle');
    } catch (error) {
      message.textContent = error.message || '提交失败，请稍后重试。';
      button.disabled = false;
    } finally {
      storyFeedbackSubmitting = false;
    }
  }

  function bindStoryEvidenceControls() {
    const content = document.getElementById('cloud-story-evidence-content');
    if (!content) return;
    content.querySelectorAll('[data-story-view]').forEach((button) => {
      button.addEventListener('click', () => switchStoryEvidenceView(button.dataset.storyView));
    });
    content.querySelectorAll('[data-story-evidence-node]').forEach((node) => {
      const select = () => {
        activeStoryEvidenceNodeId = node.dataset.storyEvidenceNode;
        renderStoryEvidence(activeStoryEvidenceResult);
      };
      node.addEventListener('click', select);
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') select();
      });
    });
    content.querySelectorAll('[data-story-open-timeline]').forEach((timelineButton) => {
      timelineButton.addEventListener('click', () => switchStoryEvidenceView('timeline', timelineButton.dataset.storyOpenTimeline));
    });
    content.querySelectorAll('[data-story-open-source]').forEach((sourceButton) => {
      sourceButton.addEventListener('click', () => switchStoryEvidenceView('timeline', sourceButton.dataset.storyOpenSource));
    });
    content.querySelectorAll('[data-story-open-claim]').forEach((claimButton) => {
      claimButton.addEventListener('click', () => openStoryClaimDrawer(claimButton.dataset.storyOpenClaim));
    });
    content.querySelectorAll('[data-story-trail-source]').forEach((trailButton) => {
      trailButton.addEventListener('click', () => switchStoryEvidenceView('timeline', trailButton.dataset.storyTrailSource));
    });
    content.querySelector('[data-story-feedback-toggle]')?.addEventListener('click', openStoryFeedbackForm);
    content.querySelectorAll('[data-story-gap-task]').forEach((button) => {
      button.addEventListener('click', () => startStoryGapTask(button.dataset.storyGapTask));
    });
    content.querySelector('#cloud-story-feedback-form')?.addEventListener('submit', submitStoryFeedback);
  }

  function clearStoryGapTask() {
    activeStoryGapTask = null;
    const panel = document.getElementById('collect-gap-task-context');
    if (panel) panel.classList.add('hidden');
  }

  function startStoryGapTask(taskId) {
    const task = (activeStoryEvidenceResult && activeStoryEvidenceResult.gapTasks || []).find((item) => item.id === taskId);
    if (!task) return;
    activeStoryGapTask = { ...task };
    closeStoryEvidence();
    if (typeof switchTab === 'function') switchTab('collect');
    const panel = document.getElementById('collect-gap-task-context');
    if (panel) {
      panel.classList.remove('hidden');
      document.getElementById('collect-gap-task-title').textContent = task.title || '定向资料征集';
      document.getElementById('collect-gap-task-description').textContent = task.description || '';
      document.getElementById('collect-gap-task-reward').textContent = Number(task.rewardPoints) > 0
        ? `审核通过并被管理员采纳后，可确认 ${Number(task.rewardPoints)} 积分。`
        : '投稿仍需经过人工审核与采纳确认。';
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const description = document.getElementById('collect-description');
    if (description && !description.value.trim()) description.value = `回应资料征集「${task.title}」：`;
    if (typeof showToast === 'function') showToast('已带入征集任务，请按要求采集', 'clipboard-check');
  }

  function switchStoryEvidenceView(view, focusId) {
    activeStoryEvidenceView = view === 'timeline' ? 'timeline' : view === 'story' ? 'story' : 'graph';
    if (focusId) activeStoryEvidenceNodeId = focusId;
    renderStoryEvidence(activeStoryEvidenceResult);
    if (focusId && activeStoryEvidenceView === 'timeline') {
      requestAnimationFrame(() => document.getElementById(`story-timeline-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  }

  function renderStoryEvidence(result) {
    const content = document.getElementById('cloud-story-evidence-content');
    const items = result.items || [];
    const resource = result.resource || {};
    document.getElementById('cloud-story-evidence-title').textContent = resource.title || '链迹故事';
    document.getElementById('cloud-story-evidence-subtitle').textContent = items.length
      ? `${items.length} 份资料 · ${Number(result.contributorCount || 0)} 位记录者共同讲述`
      : '等待社区共同补充的文化线索';
    activeStoryEvidenceResult = result;
    if (activeStoryEvidenceView === 'story' && !result.story) activeStoryEvidenceView = 'timeline';
    if (!activeStoryEvidenceNodeId && items[0]) activeStoryEvidenceNodeId = items[0].id;
    if (!items.length) {
      content.innerHTML = `
        <div class="rounded-2xl border border-dashed border-sandGold/60 bg-white p-7 text-center">
          <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-xl">链</div>
          <h3 class="mt-3 font-bold text-stone-800">这条链迹还缺少第一份资料</h3>
          <p class="mx-auto mt-2 max-w-md text-xs leading-relaxed text-stone-500">用户投稿审核通过后，管理员会把可靠资料关联到这里。你也可以拍摄现状、记录题刻或补充口述。</p>
          <button type="button" onclick="closeStoryEvidence(); if (typeof switchTab === 'function') switchTab('collect')" class="mt-4 rounded-xl bg-deepTeal px-5 py-2.5 text-xs font-bold text-sandGold">补充一条线索</button>
        </div>`;
      return;
    }
    content.innerHTML = `
      <div class="story-evidence-tabs mb-4 grid ${result.story ? 'grid-cols-3' : 'grid-cols-2'} gap-1 rounded-xl p-1">
        ${result.story ? `<button type="button" data-story-view="story" class="story-evidence-tab ${activeStoryEvidenceView === 'story' ? 'is-active' : ''}">故事讲述</button>` : ''}
        <button type="button" data-story-view="timeline" class="story-evidence-tab ${activeStoryEvidenceView === 'timeline' ? 'is-active' : ''}">来源记录</button>
        <button type="button" data-story-view="graph" class="story-evidence-tab ${activeStoryEvidenceView === 'graph' ? 'is-active' : ''}">链迹图</button>
      </div>
      <div class="story-source-note rounded-2xl p-4">
        <p class="text-[10px] font-black tracking-[0.08em] text-[#9e2f24]">资料来源说明</p>
        <p class="mt-1 text-xs leading-relaxed text-[#66574c]">以下内容均来自已审核的社区投稿，并由管理员确认与“${safeText(resource.title)}”相关。原始记录保持不变，可继续补充和修订关系。</p>
      </div>
      <div class="mt-5">${activeStoryEvidenceView === 'graph' ? renderStoryEvidenceGraphV2(result) : activeStoryEvidenceView === 'timeline' ? renderStoryEvidenceTimeline(items) : renderPublishedStory(result)}</div>`;
    bindStoryEvidenceControls();
  }

  async function openStoryEvidence(resourceId, resourceTitle, preferredView = 'story') {
    injectStoryEvidenceModal();
    const modal = document.getElementById('cloud-story-evidence-modal');
    const content = document.getElementById('cloud-story-evidence-content');
    document.getElementById('cloud-story-evidence-title').textContent = resourceTitle || '链迹故事';
    document.getElementById('cloud-story-evidence-subtitle').textContent = '正在读取已审核资料来源';
    content.innerHTML = '<div class="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-500">正在整理资料来源...</div>';
    modal.classList.remove('hidden');
    activeStoryEvidenceView = preferredView === 'graph' ? 'graph' : preferredView === 'timeline' ? 'timeline' : 'story';
    activeStoryEvidenceNodeId = '';
    activeStoryEvidenceResult = null;
    try {
      await ensureCloudUser();
      const result = await callCore({ action: 'getStoryEvidence', resourceId });
      renderStoryEvidence(result);
    } catch (error) {
      content.innerHTML = `<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">${safeText(error.message || '链迹资料暂时无法读取')}</div>`;
    }
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
      story_correction: '故事纠错',
      other: '其他'
    }[type] || '其他';
  }

  function feedbackStatusLabel(status) {
    return {
      open: '处理中',
      resolved: '已回复',
      accepted_for_revision: '已纳入修订',
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
            ${item.storyContext ? `<p class="mt-1 text-[9px] font-bold text-[#8f302b]">${safeText(item.storyContext.resourceTitle || '链迹故事')} · 第 ${Number(item.storyContext.storyVersion || 1)} 版${item.storyContext.chapterTitle ? ` · ${safeText(item.storyContext.chapterTitle)}` : ''}</p>` : ''}
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

  function redemptionStatusLabel(status) {
    return {
      issued: '待使用',
      redeemed: '已核销',
      expired: '已过期',
      cancelled: '已取消'
    }[status] || '待使用';
  }

  function redemptionStatusClass(status) {
    return {
      issued: 'bg-emerald-50 text-emerald-700',
      redeemed: 'bg-stone-100 text-stone-500',
      expired: 'bg-amber-50 text-amber-700',
      cancelled: 'bg-red-50 text-red-600'
    }[status] || 'bg-stone-100 text-stone-500';
  }

  function renderCloudRewards() {
    const rewardList = document.getElementById('cloud-reward-list');
    const redemptionList = document.getElementById('cloud-my-redemptions');
    const redemptionCount = document.getElementById('cloud-redemption-count');
    if (!rewardList || !latestBootstrap) return;
    const rewards = latestBootstrap.rewards || [];
    const points = Number(latestBootstrap.profile && latestBootstrap.profile.points || 0);
    rewardList.innerHTML = rewards.length ? rewards.map((reward) => {
      const soldOut = Number(reward.inventoryRemaining) <= 0;
      const insufficient = points < Number(reward.pointsCost || 0);
      return `
        <article class="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 items-start gap-2.5">
              <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sandGold/30 bg-sandGold/10 text-sm font-black text-deepTeal">${safeText(reward.icon || '礼')}</div>
              <div class="min-w-0">
                <h5 class="text-xs font-bold leading-relaxed text-stone-800">${safeText(reward.title)}</h5>
                <p class="mt-0.5 text-[9px] text-stone-500">${safeText(reward.sponsor)}</p>
                <p class="mt-1 line-clamp-2 text-[9px] leading-relaxed text-stone-400">${safeText(reward.description)}</p>
              </div>
            </div>
            <button type="button" data-reward-id="${safeText(reward.id)}" ${soldOut ? 'disabled' : ''} class="shrink-0 rounded-lg px-3 py-2 text-[10px] font-bold ${soldOut ? 'cursor-not-allowed bg-stone-100 text-stone-400' : 'bg-deepTeal text-sandGold shadow'}">
              ${soldOut ? '已领完' : `${Number(reward.pointsCost || 0)} 积分`}
            </button>
          </div>
          <div class="mt-2 flex items-center justify-between border-t border-stone-100 pt-2 text-[9px]">
            <span class="text-stone-400">剩余 ${Math.max(0, Number(reward.inventoryRemaining) || 0)} 份 · 兑换后 ${Number(reward.validDays) || 30} 天内有效</span>
            ${!soldOut && insufficient ? '<span class="font-bold text-amber-600">积分暂不足</span>' : ''}
          </div>
        </article>
      `;
    }).join('') : '<div class="rounded-xl border border-stone-200 bg-white p-3 text-xs text-stone-500">暂无可兑换福利。</div>';
    rewardList.querySelectorAll('[data-reward-id]').forEach((button) => {
      button.addEventListener('click', () => openCloudReward(button.dataset.rewardId));
    });

    const redemptions = latestBootstrap.myRedemptions || [];
    if (redemptionCount) redemptionCount.textContent = `${redemptions.length} 张`;
    if (!redemptionList) return;
    if (!isStableAccount(cloudUser)) {
      redemptionList.innerHTML = '<button type="button" data-login-for-redemptions class="w-full rounded-xl border border-stone-200 bg-white p-3 text-left text-xs text-stone-500">登录正式账号后可查看和长期保存兑换凭证。</button>';
      const login = redemptionList.querySelector('[data-login-for-redemptions]');
      if (login) login.addEventListener('click', openCloudLogin);
      return;
    }
    redemptionList.innerHTML = redemptions.length ? redemptions.map((item, index) => `
      <article class="rounded-xl border border-stone-200 bg-white p-3">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-xs font-bold text-stone-800">${safeText(item.rewardTitle)}</p>
            <p class="mt-0.5 text-[9px] text-stone-400">${safeText(item.sponsor)}</p>
          </div>
          <span class="shrink-0 rounded-full px-2 py-1 text-[9px] font-bold ${redemptionStatusClass(item.status)}">${safeText(redemptionStatusLabel(item.status))}</span>
        </div>
        <div class="mt-2 flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-2.5 py-2">
          <code class="break-all text-[11px] font-black tracking-wide text-deepTeal">${safeText(item.code)}</code>
          <div class="flex shrink-0 gap-1">
            <button type="button" data-view-redemption="${index}" class="rounded-md bg-deepTeal px-2 py-1 text-[9px] font-bold text-sandGold shadow-sm">查看条码</button>
            <button type="button" data-copy-redemption="${safeText(item.code)}" class="rounded-md bg-white px-2 py-1 text-[9px] font-bold text-deepTeal shadow-sm">复制</button>
          </div>
        </div>
        <p class="mt-2 text-[9px] text-stone-400">有效期至 ${safeText(displayDate(item.expiresAt))} · 已扣 ${Number(item.pointsCost || 0)} 积分</p>
      </article>
    `).join('') : '<div class="rounded-xl border border-stone-200 bg-white p-3 text-xs text-stone-500">暂无兑换记录。</div>';
    redemptionList.querySelectorAll('[data-copy-redemption]').forEach((button) => {
      button.addEventListener('click', () => copyTextValue(button.dataset.copyRedemption));
    });
    redemptionList.querySelectorAll('[data-view-redemption]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = redemptions[Number(button.dataset.viewRedemption)];
        if (item) showCloudRedemptionResult(item);
      });
    });
    if (window.lucide) lucide.createIcons();
  }

  function openCloudReward(rewardId) {
    if (!isStableAccount(cloudUser)) {
      openCloudLogin();
      if (typeof showToast === 'function') showToast('登录正式账号后才能兑换，以便长期保存凭证', 'log-in');
      return;
    }
    const rewards = latestBootstrap && latestBootstrap.rewards || [];
    activeReward = rewards.find((item) => item.id === rewardId) || null;
    if (!activeReward) {
      if (typeof showToast === 'function') showToast('该福利信息已更新，请刷新后重试', 'alert-circle');
      return;
    }
    injectProductModals();
    document.getElementById('cloud-reward-modal-title').textContent = activeReward.title || '确认兑换';
    document.getElementById('cloud-reward-modal-sponsor').textContent = activeReward.sponsor || '';
    document.getElementById('cloud-reward-modal-description').textContent = activeReward.description || '请兑换前确认使用说明。';
    document.getElementById('cloud-reward-modal-cost').textContent = Number(activeReward.pointsCost || 0).toLocaleString();
    document.getElementById('cloud-reward-modal-balance').textContent = Number(latestBootstrap.profile && latestBootstrap.profile.points || 0).toLocaleString();
    document.getElementById('cloud-reward-message').textContent = '';
    document.getElementById('cloud-reward-modal').classList.remove('hidden');
  }

  function createClientRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  async function confirmCloudRewardRedemption() {
    if (!activeReward || rewardRedeemPending) return;
    const message = document.getElementById('cloud-reward-message');
    const button = document.getElementById('cloud-reward-confirm');
    rewardRedeemPending = true;
    button.disabled = true;
    button.textContent = '正在生成凭证…';
    message.textContent = '';
    try {
      const result = await callCore({
        action: 'redeemReward',
        rewardId: activeReward.id,
        clientRequestId: createClientRequestId()
      });
      document.getElementById('cloud-reward-modal').classList.add('hidden');
      showCloudRedemptionResult(result.redemption);
      await refreshCloudProfile();
    } catch (error) {
      message.textContent = error.message || '兑换失败，请稍后重试';
    } finally {
      rewardRedeemPending = false;
      button.disabled = false;
      button.textContent = '确认兑换';
    }
  }

  function showCloudRedemptionResult(redemption) {
    injectProductModals();
    document.getElementById('cloud-redemption-result-title').textContent = redemption.rewardTitle || '反哺福利';
    const code = String(redemption.code || '').toUpperCase();
    document.getElementById('cloud-redemption-result-code').textContent = code;
    renderCode39Barcode(document.getElementById('cloud-redemption-result-barcode'), code);
    document.getElementById('cloud-redemption-result-expiry').textContent = `有效期至 ${displayDate(redemption.expiresAt)}`;
    document.getElementById('cloud-redemption-result-instructions').textContent = redemption.redemptionInstructions || '请向商家出示兑换码。';
    document.getElementById('cloud-redemption-result-modal').classList.remove('hidden');
  }

  const CODE39_PATTERNS = {
    '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
    '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
    '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', 'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw',
    'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn',
    'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
    'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww',
    'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn',
    'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn', 'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw',
    'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
    '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
    '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn'
  };

  function renderCode39Barcode(container, rawValue) {
    if (!container) return;
    const value = String(rawValue || '').toUpperCase().split('').filter((character) => CODE39_PATTERNS[character]).join('');
    if (!value) {
      container.innerHTML = '<p class="py-6 text-[10px] text-stone-400">暂无可生成的兑换码</p>';
      return;
    }
    const narrow = 2;
    const wide = 5;
    const gap = 2;
    const quiet = 14;
    let x = quiet;
    const bars = [];
    `*${value}*`.split('').forEach((character) => {
      CODE39_PATTERNS[character].split('').forEach((kind, index) => {
        const width = kind === 'w' ? wide : narrow;
        if (index % 2 === 0) bars.push(`<rect x="${x}" y="7" width="${width}" height="56" rx="0.35"/>`);
        x += width;
      });
      x += gap;
    });
    const width = x + quiet - gap;
    container.innerHTML = `<svg viewBox="0 0 ${width} 70" width="100%" height="70" preserveAspectRatio="none" role="img" aria-label="Code 39 条形码"><rect width="${width}" height="70" fill="#fff"/><g fill="#172f30">${bars.join('')}</g></svg>`;
  }

  async function copyTextValue(value) {
    const text = String(value || '');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const input = document.createElement('textarea');
      input.value = text;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    if (typeof showToast === 'function') showToast('兑换码已复制', 'copy');
  }

  function copyActiveRedemptionCode() {
    const code = document.getElementById('cloud-redemption-result-code');
    return copyTextValue(code && code.textContent);
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
          ${item.gapTaskId ? `<span class="rounded-full bg-amber-50 px-2 py-0.5 font-bold text-amber-800">定向征集 · ${safeText(item.gapTaskTitle || '共同补全')}</span>` : ''}
        </div>
        ${item.reviewNote ? `<p class="mt-2 rounded-lg bg-stone-50 p-2 text-[10px] text-stone-600">审核意见：${safeText(item.reviewNote)}</p>` : ''}
        ${item.status === 'approved' ? `<p class="mt-2 text-[10px] font-bold text-emerald-600">已发放 +${Number(item.rewardPoints || 100)} 流光积分</p>` : ''}
      </article>
    `).join('') : `<div class="rounded-xl border border-stone-200 bg-white p-3 text-xs text-stone-500">${
      allItems.length ? '当前筛选条件下没有投稿。' : '还没有云端上传记录。'
    }</div>`;
  }

  function renderCloudContributionImpact(data) {
    const impact = data.contributionImpact || {};
    const items = Array.isArray(impact.items) ? impact.items : [];
    const adopted = document.getElementById('cloud-impact-adopted');
    const stories = document.getElementById('cloud-impact-stories');
    const points = document.getElementById('cloud-impact-points');
    const recent = document.getElementById('cloud-impact-recent');
    if (!adopted || !stories || !points || !recent) return;
    adopted.textContent = Number(impact.adoptedCount || 0);
    stories.textContent = Number(impact.storyCount || 0);
    points.textContent = `+${Number(impact.totalRewardPoints || 0)}`;
    recent.innerHTML = items.length
      ? `<details class="rounded-xl border border-[#b68a4a]/20 bg-white px-3 py-2"><summary class="cursor-pointer text-[10px] font-bold text-[#7d2b23]">查看最近采用记录</summary><div class="mt-2 space-y-2">${items.slice(0, 4).map((item) => `<article class="border-t border-stone-100 pt-2 first:border-0 first:pt-0"><p class="text-[10px] font-bold text-stone-700">${safeText(item.storyTitle || item.taskTitle || '楚韵故事')}</p><p class="mt-0.5 text-[9px] text-stone-400">${safeText(item.taskTitle || '资料补充')}${item.rewardStatus === 'awarded' ? ` · 已获 +${Number(item.rewardPointsAwarded || 0)} 积分` : item.rewardStatus === 'pending_manual_confirmation' ? ' · 积分待管理员确认' : ''}</p></article>`).join('')}</div></details>`
      : '<p class="text-[10px] leading-5 text-stone-400">资料被故事采用后，贡献记录会出现在这里。</p>';
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
    renderCloudContributionImpact(data);
    renderCloudFeedback();
renderCloudRewards();
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

  function resourceAliasId(resource, type) {
    const aliases = Array.isArray(resource && resource.legacyAliases)
      ? resource.legacyAliases
      : [];
    const alias = aliases.find((item) => item && item.type === type && item.id);
    return alias ? String(alias.id) : '';
  }

  function resourceRegionText(region, separator = ' · ') {
    if (!region || typeof region !== 'object') return '';
    return [region.city, region.district]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(separator);
  }

  function resourceCollectableText(value) {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object') return '';
    return String(value.title || value.name || value.label || value.description || '').trim();
  }

  function unifiedResourceTypeText(type) {
    return {
      landmark: '文化点位',
      hotspot: '守护热点',
      activity: '社区活动',
      article: '文化导读',
      experience: '文化体验',
      route: '游览路线'
    }[type] || '文化资源';
  }

  function injectUnifiedResourceDetailModal() {
    if (document.getElementById('cloud-resource-detail-modal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="cloud-resource-detail-modal" class="hidden fixed inset-0 z-[94] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
        <section class="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-[#f3ebdd] shadow-2xl sm:rounded-3xl">
          <header class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-gradient-to-br from-[#17110f] via-[#351815] to-[#6c2721] px-5 py-4 text-white">
            <div class="min-w-0">
              <p id="cloud-resource-detail-kicker" class="text-[9px] font-black tracking-[0.22em] text-[#d7b46e]">统一文化资源</p>
              <h2 id="cloud-resource-detail-title" class="cultural-font mt-1 text-lg font-black leading-tight text-[#fff5df]">资源详情</h2>
              <p id="cloud-resource-detail-region" class="mt-1 text-[10px] text-[#eadcca]/70"></p>
            </div>
            <button type="button" data-close-resource-detail class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-[#fff5df]" aria-label="关闭资源详情">✕</button>
          </header>
          <div id="cloud-resource-detail-content" class="p-4 sm:p-5">
            <div class="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-500">正在整理资源内容…</div>
          </div>
        </section>
      </div>`);
    document.querySelectorAll('[data-close-resource-detail]').forEach((button) => button.addEventListener('click', closeUnifiedResourceDetail));
    document.getElementById('cloud-resource-detail-modal').addEventListener('click', (event) => {
      if (event.target.id === 'cloud-resource-detail-modal') closeUnifiedResourceDetail();
    });
  }

  function closeUnifiedResourceDetail() {
    document.getElementById('cloud-resource-detail-modal')?.classList.add('hidden');
    activeUnifiedResourceDetail = null;
  }

  function unifiedResourceLegacyContent(resource) {
    const contentId = resourceAliasId(resource, 'content');
    if (!contentId || typeof getDiscoverFeedItemById !== 'function') return null;
    return getDiscoverFeedItemById(contentId);
  }

  function unifiedResourceVisitDetail(resource) {
    const landmarkId = resourceAliasId(resource, 'landmark') || String(resource.id || '');
    if (typeof mapPlannerDetails !== 'undefined' && mapPlannerDetails[landmarkId]) return mapPlannerDetails[landmarkId];
    const transport = resource.transport && typeof resource.transport === 'object' ? resource.transport : {};
    const access = Array.isArray(transport.modes) ? transport.modes.map(resourceCollectableText).filter(Boolean) : [];
    const collect = Array.isArray(resource.collectables) ? resource.collectables.map(resourceCollectableText).filter(Boolean) : [];
    if (!access.length && !collect.length) return null;
    return { area: resourceRegionText(resource.region), access, collect, arrival: '' };
  }

  function unifiedResourceRoutePlan(resource) {
    const routeId = resourceAliasId(resource, 'activity') || String(resource.id || '');
    if (typeof communityRoutePlans === 'undefined' || !Array.isArray(communityRoutePlans)) return null;
    return communityRoutePlans.find((item) => item.id === routeId) || null;
  }

  function renderUnifiedResourceDetail(resource) {
    const content = document.getElementById('cloud-resource-detail-content');
    if (!content) return;
    const legacyContent = unifiedResourceLegacyContent(resource);
    const visit = unifiedResourceVisitDetail(resource);
    const route = unifiedResourceRoutePlan(resource);
    const region = resourceRegionText(resource.region) || '湖北';
    const access = visit && Array.isArray(visit.access) ? visit.access.filter(Boolean) : [];
    const collect = visit && Array.isArray(visit.collect) ? visit.collect.filter(Boolean) : [];
    const routeSteps = route && Array.isArray(route.steps) ? route.steps : [];
    const completeness = Math.max(0, Math.min(100, Number(resource.completeness) || 0));
    document.getElementById('cloud-resource-detail-kicker').textContent = `统一文化资源 · ${unifiedResourceTypeText(resource.type)}`;
    document.getElementById('cloud-resource-detail-title').textContent = resource.title || '资源详情';
    document.getElementById('cloud-resource-detail-region').textContent = `${region}${completeness ? ` · 资料完整度 ${completeness}%` : ''}`;
    content.innerHTML = `
      <article class="overflow-hidden rounded-2xl border border-[#b68a4a]/25 bg-[#fffaf1] shadow-[0_14px_38px_rgba(58,31,23,0.08)]">
        <div class="border-l-4 border-[#9e2f24] p-5">
          <p class="text-[9px] font-black tracking-[0.16em] text-[#9e2f24]">文化导读</p>
          <p class="cultural-font mt-2 text-base font-bold leading-7 text-[#2b2421]">${safeText(resource.summary || '这项文化资源正在由社区持续补充。')}</p>
          ${legacyContent && legacyContent.researchValue ? `<p class="mt-3 text-xs leading-6 text-stone-600">${safeText(legacyContent.researchValue)}</p>` : ''}
        </div>
      </article>
      <button type="button" data-resource-story class="mt-4 flex min-h-11 w-full items-center justify-between rounded-2xl bg-[#241a17] px-4 text-left text-[#fff5df] shadow-[0_8px_24px_rgba(36,26,23,0.14)]">
        <span><span class="block text-xs font-bold">阅读共同故事</span><span class="mt-0.5 block text-[9px] text-[#d7b46e]">先读已审核讲述，再按需查看来源和链迹图</span></span>
        <span class="text-lg text-[#d7b46e]">›</span>
      </button>
      ${visit ? `
        <details class="mt-4 overflow-hidden rounded-2xl border border-[#b68a4a]/25 bg-white">
          <summary class="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-bold text-[#2b2421]">到访与采集提示<span class="text-[#9e2f24]">展开</span></summary>
          <div class="space-y-4 border-t border-stone-100 px-4 py-4 text-xs leading-relaxed text-stone-600">
            ${visit.stay ? `<p><strong class="text-stone-800">建议停留：</strong>${safeText(visit.stay)}</p>` : ''}
            ${visit.arrival ? `<p><strong class="text-stone-800">现场提示：</strong>${safeText(visit.arrival)}</p>` : ''}
            ${access.length ? `<div><p class="font-bold text-stone-800">到达方式</p><div class="mt-2 flex flex-wrap gap-2">${access.map((item) => `<span class="rounded-full bg-[#f3ebdd] px-3 py-1.5 text-[10px]">${safeText(item)}</span>`).join('')}</div></div>` : ''}
            ${collect.length ? `<div><p class="font-bold text-stone-800">适合补充</p><ul class="mt-2 space-y-2">${collect.map((item) => `<li class="flex gap-2"><span class="text-[#9e2f24]">◆</span><span>${safeText(item)}</span></li>`).join('')}</ul></div>` : ''}
          </div>
        </details>` : ''}
      ${routeSteps.length ? `
        <details class="mt-4 overflow-hidden rounded-2xl border border-[#b68a4a]/25 bg-white">
          <summary class="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-bold text-[#2b2421]">路线步骤 · ${routeSteps.length} 站<span class="text-[#9e2f24]">展开</span></summary>
          <div class="border-t border-stone-100 px-4 py-4">
            <ol class="space-y-4">${routeSteps.map((step, index) => `<li class="relative pl-10"><span class="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-[#9e2f24] text-[10px] font-black text-[#fff5df]">${index + 1}</span><p class="text-xs font-bold text-stone-800">${safeText(step.title || `第 ${index + 1} 站`)}</p><p class="mt-1 text-[10px] leading-relaxed text-stone-500">${safeText(step.guide || step.desc || '')}</p>${step.stay ? `<p class="mt-1 text-[9px] font-bold text-[#8b672d]">${safeText(step.stay)}</p>` : ''}</li>`).join('')}</ol>
          </div>
        </details>` : ''}
      <div class="mt-4 grid gap-2 sm:grid-cols-2">
        ${resourceAliasId(resource, 'landmark') ? '<button type="button" data-resource-map class="min-h-11 rounded-xl border border-[#9e2f24]/20 bg-white px-4 text-xs font-bold text-[#8f302b]">在地图中查看</button>' : ''}
        ${resourceAliasId(resource, 'content') ? '<button type="button" data-resource-legacy-content class="min-h-11 rounded-xl border border-[#b68a4a]/30 bg-white px-4 text-xs font-bold text-[#735322]">查看关联投稿</button>' : ''}
        ${resourceAliasId(resource, 'activity') ? '<button type="button" data-resource-route class="min-h-11 rounded-xl border border-[#9e2f24]/20 bg-white px-4 text-xs font-bold text-[#8f302b]">在地图规划路线</button>' : ''}
      </div>
      <p class="mt-4 text-center text-[9px] leading-relaxed text-stone-400">开放时间、票务和道路状态可能变化，请以场馆及地图服务当天信息为准。</p>`;
    content.querySelector('[data-resource-story]')?.addEventListener('click', () => {
      closeUnifiedResourceDetail();
      window.openStoryEvidence?.(resource.id, resource.title, 'story');
    });
    content.querySelector('[data-resource-map]')?.addEventListener('click', () => {
      const landmarkId = resourceAliasId(resource, 'landmark');
      const landmark = typeof heritageLandmarks !== 'undefined' ? heritageLandmarks.find((item) => item.id === landmarkId) : null;
      closeUnifiedResourceDetail();
      if (landmark && typeof switchTab === 'function') {
        switchTab('map');
        setTimeout(() => { focusLandmark(landmark); selectMapPlannerPoint(landmark.id, { focusMap: true }); }, 120);
      }
    });
    content.querySelector('[data-resource-legacy-content]')?.addEventListener('click', () => {
      const contentId = resourceAliasId(resource, 'content');
      closeUnifiedResourceDetail();
      if (contentId && typeof openDiscoverDetail === 'function') setTimeout(() => openDiscoverDetail(contentId), 0);
    });
    content.querySelector('[data-resource-route]')?.addEventListener('click', () => {
      const routeId = resourceAliasId(resource, 'activity');
      closeUnifiedResourceDetail();
      if (routeId && typeof openActivityRoutesOnMap === 'function') openActivityRoutesOnMap(routeId);
    });
  }

  async function openUnifiedResourceDetail(resourceId) {
    injectUnifiedResourceDetailModal();
    const fallback = unifiedResources.find((item) => item.id === resourceId) || null;
    const modal = document.getElementById('cloud-resource-detail-modal');
    const content = document.getElementById('cloud-resource-detail-content');
    modal.classList.remove('hidden');
    document.getElementById('cloud-resource-detail-title').textContent = fallback && fallback.title || '资源详情';
    document.getElementById('cloud-resource-detail-region').textContent = '正在读取统一资源内容';
    content.innerHTML = '<div class="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-500">正在整理资源内容…</div>';
    try {
      const result = await callCore({ action: 'getResourceDetail', resourceId });
      activeUnifiedResourceDetail = result && result.item || fallback;
      if (!activeUnifiedResourceDetail) throw new Error('没有找到这项文化资源');
      renderUnifiedResourceDetail(activeUnifiedResourceDetail);
    } catch (error) {
      if (fallback) {
        activeUnifiedResourceDetail = fallback;
        renderUnifiedResourceDetail(fallback);
        return;
      }
      content.innerHTML = `<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">${safeText(error.message || '资源详情暂时无法读取')}</div>`;
    }
  }

  function setUnifiedResourceSyncState(status, count = 0, error = '') {
    unifiedResourceSyncState = {
      status,
      count: Number(count || 0),
      error: String(error || ''),
      updatedAt: new Date().toISOString()
    };
    window.chulinkResources = unifiedResources;
    window.chulinkResourceSync = { ...unifiedResourceSyncState };

    const statusElement = document.getElementById('resource-sync-status');
    if (!statusElement) return;
    if (status === 'ready' && count > 0) {
      statusElement.textContent = `${count} 项云端资源已同步`;
      statusElement.className = 'text-[9px] font-bold text-emerald-700';
      return;
    }
    statusElement.textContent = '本地数据可用';
    statusElement.className = 'text-[9px] text-stone-400';
  }

  function attachResourceMetadata(target, resource) {
    if (!target || !resource) return;
    target.resourceId = String(resource.id || '');
    target.resourceType = String(resource.type || '');
    target.categoryIds = Array.isArray(resource.categoryIds) ? resource.categoryIds.slice() : [];
    target.tags = Array.isArray(resource.tags) ? resource.tags.slice() : [];
    target.capabilities = resource.capabilities && typeof resource.capabilities === 'object'
      ? { ...resource.capabilities }
      : {};
    target.relatedResourceIds = Array.isArray(resource.relatedResourceIds)
      ? resource.relatedResourceIds.slice()
      : [];
    target.resourceCompleteness = Number(resource.completeness || 0);
  }

  function mergeLandmarkResource(resource) {
    if (typeof heritageLandmarks === 'undefined' || !Array.isArray(heritageLandmarks)) return;
    const landmarkId = resourceAliasId(resource, 'landmark');
    if (!landmarkId) return;
    const landmark = heritageLandmarks.find((item) => item.id === landmarkId);
    if (!landmark) return;

    if (resource.title) landmark.title = resource.title;
    if (resource.summary) landmark.desc = resource.summary;
    if (resource.location) {
      const latitude = Number(resource.location.latitude);
      const longitude = Number(resource.location.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        landmark.coords = [latitude, longitude];
        landmark.coordinateSystem = resource.location.coordinateSystem || 'gcj02';
      }
    }
    attachResourceMetadata(landmark, resource);

    if (typeof mapPlannerDetails === 'undefined') return;
    const currentDetail = mapPlannerDetails[landmarkId] || {};
    const area = resourceRegionText(resource.region);
    const transport = resource.transport && typeof resource.transport === 'object'
      ? resource.transport
      : {};
    const transportModes = Array.isArray(transport.modes)
      ? transport.modes.map(resourceCollectableText).filter(Boolean)
      : [];
    const access = transportModes.length
      ? transportModes
      : (Array.isArray(transport.access) ? transport.access.map(resourceCollectableText).filter(Boolean) : []);
    const collect = Array.isArray(resource.collectables)
      ? resource.collectables.map(resourceCollectableText).filter(Boolean)
      : [];
    mapPlannerDetails[landmarkId] = {
      ...currentDetail,
      ...(area ? { area } : {}),
      ...(access.length ? { access } : {}),
      ...(collect.length ? { collect } : {})
    };
  }

  function mergeContentResource(resource) {
    const contentId = resourceAliasId(resource, 'content');
    if (!contentId) return;
    const collections = [];
    if (typeof discoverLiveFeedItems !== 'undefined' && Array.isArray(discoverLiveFeedItems)) {
      collections.push(discoverLiveFeedItems);
    }
    if (typeof discoverLiveCandidates !== 'undefined' && Array.isArray(discoverLiveCandidates)) {
      collections.push(discoverLiveCandidates);
    }
    const item = collections.flat().find((candidate) => candidate.id === contentId);
    if (!item) return;
    if (resource.title) item.title = resource.title;
    if (resource.summary) item.description = resource.summary;
    const region = resourceRegionText(resource.region, '');
    if (region) item.region = region;
    attachResourceMetadata(item, resource);
  }

  function mergeRouteResource(resource) {
    if (typeof communityRoutePlans === 'undefined' || !Array.isArray(communityRoutePlans)) return;
    const routeId = resourceAliasId(resource, 'activity');
    if (!routeId) return;
    const route = communityRoutePlans.find((item) => item.id === routeId);
    if (!route) return;
    if (resource.title) route.title = resource.title;
    if (resource.summary) route.desc = resource.summary;
    if (resource.region && resource.region.city) route.city = String(resource.region.city);
    if (resource.location) {
      const latitude = Number(resource.location.latitude);
      const longitude = Number(resource.location.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) route.center = [latitude, longitude];
    }
    attachResourceMetadata(route, resource);
  }

  function applyUnifiedResources(items) {
    unifiedResources = Array.isArray(items) ? items.filter((item) => item && item.id) : [];
    unifiedResources.forEach((resource) => {
      mergeLandmarkResource(resource);
      mergeContentResource(resource);
      mergeRouteResource(resource);
    });
    setUnifiedResourceSyncState('ready', unifiedResources.length);
    if (typeof refreshUnifiedResourceUi === 'function') refreshUnifiedResourceUi();
  }

  async function loadUnifiedResources() {
    setUnifiedResourceSyncState('loading');
    try {
      const result = await callCore({ action: 'getResources', limit: 100 });
      applyUnifiedResources(result && result.items);
    } catch (error) {
      unifiedResources = [];
      setUnifiedResourceSyncState('fallback', 0, error && error.message);
      console.warn('[CloudBase resources] 使用本地兼容数据', error);
    }
  }

  async function loadUnifiedRelatedResources(itemId) {
    const item = typeof getDiscoverFeedItemById === 'function'
      ? getDiscoverFeedItemById(itemId)
      : null;
    const resourceId = String(item && item.resourceId || '');
    if (!resourceId || typeof renderDiscoverRelatedResources !== 'function') return;
    const requestId = ++unifiedRelatedRequestId;
    renderDiscoverRelatedResources(resourceId, [], { loading: true });
    try {
      const result = await callCore({ action: 'searchResources', resourceId, limit: 4 });
      if (requestId !== unifiedRelatedRequestId) return;
      renderDiscoverRelatedResources(resourceId, result && result.items || []);
    } catch (error) {
      if (requestId !== unifiedRelatedRequestId) return;
      renderDiscoverRelatedResources(resourceId, [], { error: true });
      console.warn('[CloudBase related resources]', error);
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
      const fingerprint = [
        activeInteractionTarget.targetType,
        activeInteractionTarget.targetId,
        activeReplyCommentId,
        content
      ].join('|');
      if (!pendingCommentRequestId || pendingCommentFingerprint !== fingerprint) {
        pendingCommentRequestId = createClientRequestId();
        pendingCommentFingerprint = fingerprint;
      }
      await callCore({
        action: 'createComment',
        ...interactionPayload(activeInteractionTarget),
        parentId: activeReplyCommentId,
        content,
        clientRequestId: pendingCommentRequestId
      });
      pendingCommentRequestId = '';
      pendingCommentFingerprint = '';
      input.value = '';
      const counter = document.getElementById('cloud-comment-count');
      if (counter) counter.textContent = '0/500';
      activeReplyCommentId = '';
      updateReplyIndicator();
      await loadCloudInteractions(activeInteractionTarget);
      if (typeof showToast === 'function') showToast('评论已发布', 'message-square');
    } catch (error) {
      const isBusy = /TransactionBusy|Transaction is busy|DATABASE_TRANSACTION_FAIL|COMMENT_SERVICE_BUSY/i.test(`${error.code || ''} ${error.message || ''}`);
      const message = isBusy ? '当前参与评论的人较多，请稍等几秒再试' : error.message;
      if (typeof showToast === 'function') showToast(message, 'alert-circle');
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
      const mine = slotRecords.find((record) => record.isMine && ['pending', 'approved', 'rejected'].includes(record.status));
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
      return result;
    } catch (error) {
      console.warn('[CloudBase supplements]', error);
      return null;
    }
  }

  async function startQuickStorySupplement(itemId) {
    const item = findApprovedItem(itemId);
    if (!item) return;
    if (!isStableAccount(cloudUser)) {
      openCloudLogin();
      if (typeof showToast === 'function') showToast('登录后即可补充这段链迹', 'log-in');
      return;
    }
    const submissionId = rawSubmissionId(item.id || item.feedId);
    let state = cloudSupplementState.get(submissionId);
    if (!state) state = await loadCloudSupplements(item);
    const records = state && Array.isArray(state.items) ? state.items : [];
    const slots = typeof getDefaultSupplementSlots === 'function' ? getDefaultSupplementSlots(item) : [];
    const recommended = slots.find((slot) => !records.some((record) => (
      record.slotId === slot.id && record.isMine && ['pending', 'approved'].includes(record.status)
    )));
    if (!recommended) {
      if (typeof showToast === 'function') showToast(slots.length ? '你已完成这条链迹的可用补充' : '这条内容暂时没有可补充位置', 'info');
      return;
    }
    triggerCloudSupplementUpload(item.id || item.feedId, recommended.id);
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
    loadUnifiedRelatedResources(itemId);
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
        regionName: '湖北',
        aiAnalysisConsent: document.getElementById('collect-ai-consent')?.checked === true,
        materialAnalysisConsent: document.getElementById('collect-material-consent')?.checked === true,
        gapTaskId: activeStoryGapTask && activeStoryGapTask.id || ''
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
      const aiConsent = document.getElementById('collect-ai-consent');
      if (aiConsent) aiConsent.checked = false;
      clearStoryGapTask();
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
    injectStoryEvidenceModal();
    document.getElementById('collect-gap-task-clear')?.addEventListener('click', clearStoryGapTask);
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
  window.startQuickStorySupplement = startQuickStorySupplement;
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
  window.openStoryEvidence = openStoryEvidence;
  window.closeStoryEvidence = closeStoryEvidence;
  window.openUnifiedResourceDetail = openUnifiedResourceDetail;
  window.closeUnifiedResourceDetail = closeUnifiedResourceDetail;
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
    await loadUnifiedResources();
    await loadCloudPublicFeed();
    scheduleCloudPublicFeedRefresh();
  });
})();
