(function () {
  const ENV_ID = 'chulink-legacy-d8god1687a5d60743';
  const REGION = 'ap-shanghai';
  const CORE_FUNCTION = 'appCore';
  const MAX_FILE_BYTES = 25 * 1024 * 1024;

  let cloudApp = null;
  let cloudAuth = null;
  let cloudUser = null;
  let bootstrapPromise = null;
  let latestBootstrap = null;

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

  async function callCore(data) {
    await ensureCloudUser();
    const response = await cloudApp.callFunction({ name: CORE_FUNCTION, data });
    let result = response && response.result !== undefined ? response.result : response;
    if (typeof result === 'string') {
      try { result = JSON.parse(result); } catch (_) {}
    }
    if (!result || result.ok !== true) {
      const error = result && result.error;
      const failure = new Error(error && error.message ? error.message : '云端请求失败');
      failure.code = error && error.code ? error.code : 'FUNCTION_FAILED';
      throw failure;
    }
    return result;
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

    const legacyCard = profileView.firstElementChild;
    if (legacyCard) legacyCard.classList.add('hidden');

    profileView.insertAdjacentHTML('afterbegin', `
      <section id="cloud-profile-card" class="rounded-2xl border border-sandGold/30 bg-deepTeal p-4 text-white shadow-lg">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-[10px] text-stone-300">CloudBase 云端身份</p>
            <h4 id="cloud-profile-name" class="cultural-font mt-1 truncate text-base font-bold text-sandGold">正在连接...</h4>
            <p id="cloud-profile-uid" class="mt-1 break-all font-mono text-[9px] text-stone-300"></p>
          </div>
          <div class="shrink-0 text-right">
            <p class="text-[9px] text-stone-300">流光积分</p>
            <p id="cloud-profile-points" class="text-xl font-bold text-sandGold">0</p>
          </div>
        </div>
        <div class="mt-3 grid grid-cols-3 gap-2 text-center">
          <div class="rounded-lg bg-white/10 p-2"><p id="cloud-stat-total" class="font-bold text-sandGold">0</p><p class="text-[9px] text-stone-300">全部投稿</p></div>
          <div class="rounded-lg bg-white/10 p-2"><p id="cloud-stat-pending" class="font-bold text-sandGold">0</p><p class="text-[9px] text-stone-300">待审核</p></div>
          <div class="rounded-lg bg-white/10 p-2"><p id="cloud-stat-approved" class="font-bold text-sandGold">0</p><p class="text-[9px] text-stone-300">已通过</p></div>
        </div>
        <div class="mt-3 flex gap-2">
          <button id="cloud-profile-edit" type="button" class="flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-[10px] font-bold">修改昵称</button>
          <button id="cloud-account-action" type="button" class="flex-1 rounded-lg bg-sandGold px-3 py-2 text-[10px] font-bold text-deepTeal">账号登录</button>
        </div>
      </section>
      <section class="space-y-2">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-bold uppercase tracking-wider text-stone-500">我的云端上传记录</h4>
          <button id="cloud-record-refresh" type="button" class="text-[10px] font-bold text-deepTeal">刷新</button>
        </div>
        <div id="cloud-my-submissions" class="space-y-2">
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
    document.getElementById('cloud-profile-edit').addEventListener('click', editCloudNickname);
    document.getElementById('cloud-record-refresh').addEventListener('click', refreshCloudProfile);
  }

  function injectLoginModal() {
    if (document.getElementById('cloud-login-modal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="cloud-login-modal" class="hidden fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
        <div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
          <div class="flex items-start justify-between">
            <div>
              <h3 class="cultural-font text-lg font-bold text-deepTeal">登录云端账号</h3>
              <p class="mt-1 text-[10px] text-stone-500">登录后可跨浏览器保留积分和上传记录。</p>
            </div>
            <button id="cloud-login-close" type="button" class="text-stone-400">✕</button>
          </div>
          <form id="cloud-login-form" class="mt-4 space-y-3">
            <input id="cloud-login-username" autocomplete="username" placeholder="邮箱或用户名" class="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-sandGold" required>
            <input id="cloud-login-password" type="password" autocomplete="current-password" placeholder="密码" class="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-sandGold" required>
            <p id="cloud-login-message" class="min-h-4 text-[10px] text-red-600"></p>
            <button type="submit" class="w-full rounded-xl bg-deepTeal px-3 py-2.5 text-sm font-bold text-sandGold">登录</button>
          </form>
          <p class="mt-3 text-[9px] leading-relaxed text-stone-400">没有正式账号时可继续使用游客身份。管理员账号需在 CloudBase 身份认证中创建并加入管理员 UID 白名单。</p>
        </div>
      </div>
    `);
    document.getElementById('cloud-login-close').addEventListener('click', closeCloudLogin);
    document.getElementById('cloud-login-form').addEventListener('submit', loginCloudAccount);
  }

  function openCloudLogin() {
    injectLoginModal();
    document.getElementById('cloud-login-modal').classList.remove('hidden');
  }

  function closeCloudLogin() {
    const modal = document.getElementById('cloud-login-modal');
    if (modal) modal.classList.add('hidden');
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
    const current = latestBootstrap.profile.nickname || '';
    const nickname = prompt('请输入新的昵称（最多 40 个字）', current);
    if (nickname == null || !nickname.trim()) return;
    try {
      await callCore({ action: 'updateProfile', nickname: nickname.trim() });
      await refreshCloudProfile();
      if (typeof showToast === 'function') showToast('昵称已保存到云端', 'check-circle');
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message, 'alert-circle');
    }
  }

  function renderCloudProfile(data) {
    latestBootstrap = data;
    const profile = data.profile || {};
    const stats = data.stats || {};
    const uid = profile.uid || cloudUser && (cloudUser.uid || cloudUser.id) || '';
    document.getElementById('cloud-profile-name').textContent = profile.nickname || '楚韵守护者';
    document.getElementById('cloud-profile-uid').textContent =
      `${isStableAccount(cloudUser) ? '正式账号' : '游客身份'} · UID ${uid}`;
    document.getElementById('cloud-profile-points').textContent = Number(profile.points || 0).toLocaleString();
    document.getElementById('cloud-stat-total').textContent = Number(stats.total || 0);
    document.getElementById('cloud-stat-pending').textContent = Number(stats.pending || 0);
    document.getElementById('cloud-stat-approved').textContent = Number(stats.approved || 0);
    document.getElementById('cloud-account-action').textContent = isStableAccount(cloudUser) ? '退出账号' : '账号登录';
    const legacyPoints = document.getElementById('user-points');
    if (legacyPoints) legacyPoints.textContent = Number(profile.points || 0).toLocaleString();
    try { userPoints = Number(profile.points || 0); } catch (_) {}

    const list = document.getElementById('cloud-my-submissions');
    const items = data.mySubmissions || [];
    list.innerHTML = items.length ? items.map((item) => `
      <article class="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate text-xs font-bold text-stone-800">${safeText(item.title || '未命名素材')}</p>
            <p class="mt-1 text-[9px] text-stone-400">${safeText(displayDate(item.createdAt))} · ${safeText(item.assetType)}</p>
          </div>
          <span class="shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusClass(item.status)}">${safeText(statusLabel(item.status))}</span>
        </div>
        ${item.reviewNote ? `<p class="mt-2 rounded-lg bg-stone-50 p-2 text-[10px] text-stone-600">审核意见：${safeText(item.reviewNote)}</p>` : ''}
        ${item.status === 'approved' ? `<p class="mt-2 text-[10px] font-bold text-emerald-600">已发放 +${Number(item.rewardPoints || 100)} 流光积分</p>` : ''}
      </article>
    `).join('') : '<div class="rounded-xl border border-stone-200 bg-white p-3 text-xs text-stone-500">还没有云端上传记录。</div>';
  }

  async function refreshCloudProfile() {
    injectAccountUi();
    bootstrapPromise = callCore({ action: 'bootstrap' });
    try {
      renderCloudProfile(await bootstrapPromise);
    } catch (error) {
      const list = document.getElementById('cloud-my-submissions');
      if (list) list.innerHTML = `<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">${safeText(error.message)}</div>`;
    }
  }

  async function mapPublicItems(items) {
    return (items || []).map((item) => {
      const fileID = item.fileID || item.imageFileID || '';
      const fileUrl = item.fileUrl || '';
      return {
        ...item,
        id: `approved-${item.id}`,
        feedId: `approved-${item.id}`,
        fileUrl,
        thumbnailUrl: item.assetType === 'image' ? fileUrl : '',
        regionName: item.regionName || '湖北',
        contributorName: item.contributorName || '楚韵守护者',
        qualityScore: null,
        comments: 0,
        likes: 0,
        board: 'share',
        completeness: 100
      };
    });
  }

  async function loadCloudPublicFeed() {
    try {
      if (typeof loadDiscoverLikes === 'function') loadDiscoverLikes();
      if (typeof startDiscoverLiveTicker === 'function') startDiscoverLiveTicker();
      const result = await callCore({ action: 'getPublic', limit: 50 });
      approvedSubmissionItems = await mapPublicItems(result.items || []);
      if (typeof renderDiscoverFeed === 'function') renderDiscoverFeed();
    } catch (error) {
      console.warn('[CloudBase public feed]', error);
      if (typeof renderDiscoverFeed === 'function') renderDiscoverFeed();
    }
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
    submitButton.textContent = '正在上传 CloudBase...';
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

      if (typeof showToast === 'function') {
        showToast(`投稿成功，审核编号 ${result.submission.id || ''}`, 'check-circle');
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
    const toggle = document.getElementById('api-toggle-btn');
    const localPanel = toggle && toggle.closest('.bg-amber-50');
    if (localPanel) localPanel.classList.add('hidden');
    const collectForm = document.getElementById('collect-form');
    const submitButton = collectForm && collectForm.querySelector('button[type="submit"] span');
    if (submitButton) submitButton.textContent = '上传云端并进入人工审核';
  }

  loadApprovedSubmissionFeed = loadCloudPublicFeed;
  handleUploadSubmit = submitToCloud;
  window.openCloudLogin = openCloudLogin;
  window.refreshCloudProfile = refreshCloudProfile;

  document.addEventListener('DOMContentLoaded', async () => {
    prepareFormalCloudUi();
    await refreshCloudProfile();
    await loadCloudPublicFeed();
  });
})();
