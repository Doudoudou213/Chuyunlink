const { ensurePublicSession } = require('./services/auth');

App({
  globalData: {
    sessionMode: 'unknown'
  },

  async onLaunch() {
    try {
      const state = await ensurePublicSession();
      this.globalData.sessionMode = state && state.isAnonymousAuth ? 'preview' : 'wechat';
    } catch (error) {
      this.globalData.sessionMode = 'offline';
      console.warn('[miniprogram] CloudBase session unavailable:', error && error.code || 'UNKNOWN');
    }
  }
});
