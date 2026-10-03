const config = require('../config/index');
const { auth } = require('../libs/cloudbase');

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({ success: resolve, fail: reject });
  });
}

function requestTicket(code) {
  return new Promise((resolve, reject) => {
    if (!config.loginTicketUrl) {
      const error = new Error('微信登录服务尚未配置');
      error.code = 'WX_LOGIN_NOT_CONFIGURED';
      reject(error);
      return;
    }
    wx.request({
      url: config.loginTicketUrl,
      method: 'POST',
      timeout: 12000,
      header: { 'content-type': 'application/json' },
      data: { code },
      success(response) {
        const body = response.data && response.data.result || response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300 && body.ok && body.ticket) {
          resolve(body.ticket);
          return;
        }
        const error = new Error(body.message || '微信登录服务暂时不可用');
        error.code = body.code || 'WX_LOGIN_REQUEST_FAILED';
        reject(error);
      },
      fail: reject
    });
  });
}

async function ensurePublicSession() {
  let state = await auth.getLoginState();
  if (!state) {
    await auth.anonymousAuthProvider().signIn();
    state = await auth.getLoginState();
  }
  return state;
}

async function signInWithWechat() {
  const loginResult = await wxLogin();
  if (!loginResult.code) {
    const error = new Error('微信没有返回有效登录凭证');
    error.code = 'WX_CODE_MISSING';
    throw error;
  }
  const ticket = await requestTicket(loginResult.code);
  const current = await auth.getLoginState();
  if (current) await auth.signOut();
  await auth.customAuthProvider().signIn(ticket);
  const state = await auth.getLoginState();
  if (!state || state.isAnonymousAuth) {
    const error = new Error('微信登录状态未建立');
    error.code = 'WX_LOGIN_STATE_MISSING';
    throw error;
  }
  return state;
}

async function getSessionSummary() {
  const state = await ensurePublicSession();
  const user = state && state.user || {};
  return {
    isStable: Boolean(state && !state.isAnonymousAuth),
    loginType: state && state.loginType || 'ANONYMOUS',
    uid: user.uid || user.id || ''
  };
}

module.exports = { ensurePublicSession, getSessionSummary, signInWithWechat };
