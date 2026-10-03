const { callCore } = require('../../services/core');
const { getSessionSummary, signInWithWechat } = require('../../services/auth');

Page({
  data: { stable: false, loading: true, message: '', profile: {}, stats: {}, submissions: [], redemptions: [] },
  onShow() { this.loadProfile(); },
  async loadProfile() {
    this.setData({ loading: true, message: '' });
    try {
      const session = await getSessionSummary();
      if (!session.isStable) { this.setData({ stable: false }); return; }
      const result = await callCore({ action: 'bootstrap' });
      this.setData({ stable: true, profile: result.profile || {}, stats: result.stats || {}, submissions: result.mySubmissions || [], redemptions: result.myRedemptions || [] });
    } catch (error) {
      this.setData({ message: error.message || '个人资料暂时无法读取' });
    } finally { this.setData({ loading: false }); }
  },
  async login() {
    try {
      wx.showLoading({ title: '连接微信账号' });
      await signInWithWechat();
      await this.loadProfile();
    } catch (error) {
      this.setData({ message: error.message || '微信登录暂时不可用' });
    } finally { wx.hideLoading(); }
  }
});
