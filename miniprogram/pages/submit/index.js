const { app } = require('../../libs/cloudbase');
const { callCore } = require('../../services/core');
const { getSessionSummary, signInWithWechat } = require('../../services/auth');

Page({
  data: {
    sessionReady: false,
    title: '',
    description: '',
    media: null,
    aiConsent: false,
    materialConsent: false,
    submitting: false,
    message: ''
  },

  onShow() { this.refreshSession(); },
  async refreshSession() {
    try {
      const session = await getSessionSummary();
      this.setData({ sessionReady: session.isStable });
    } catch (_) { this.setData({ sessionReady: false }); }
  },
  onTitle(event) { this.setData({ title: event.detail.value }); },
  onDescription(event) { this.setData({ description: event.detail.value }); },
  onAiConsent(event) { this.setData({ aiConsent: event.detail.value }); },
  onMaterialConsent(event) { this.setData({ materialConsent: event.detail.value }); },

  async login() {
    try {
      wx.showLoading({ title: '连接微信账号' });
      await signInWithWechat();
      this.setData({ sessionReady: true, message: '微信账号已连接，可以提交记录。' });
    } catch (error) {
      this.setData({ message: error.message || '微信登录暂时不可用' });
    } finally { wx.hideLoading(); }
  },

  chooseMedia() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file) return;
        if (Number(file.size) > 25 * 1024 * 1024) {
          wx.showToast({ title: '图片需小于 25MB', icon: 'none' });
          return;
        }
        this.setData({ media: file, message: '' });
      }
    });
  },

  getLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({ type: 'gcj02', isHighAccuracy: true, success: resolve, fail: reject });
    });
  },

  async submit() {
    if (!this.data.sessionReady) { await this.login(); return; }
    if (!this.data.media || !this.data.title.trim()) {
      this.setData({ message: '请先选择图片，并写下这份记录的名称。' });
      return;
    }
    this.setData({ submitting: true, message: '' });
    wx.showLoading({ title: '保存文化记录', mask: true });
    try {
      const session = await getSessionSummary();
      const location = await this.getLocation();
      const suffixMatch = String(this.data.media.tempFilePath).match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
      const suffix = suffixMatch ? suffixMatch[1].toLowerCase() : 'jpg';
      const cloudPath = `submissions/${session.uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${suffix}`;
      const uploaded = await app.uploadFile({ cloudPath, filePath: this.data.media.tempFilePath });
      await callCore({
        action: 'createSubmission',
        assetType: 'image',
        fileID: uploaded.fileID,
        cloudPath,
        mimeType: suffix === 'png' ? 'image/png' : 'image/jpeg',
        size: Number(this.data.media.size),
        title: this.data.title.trim(),
        description: this.data.description.trim(),
        longitude: Number(location.longitude),
        latitude: Number(location.latitude),
        locationAccuracy: Number(location.accuracy),
        aiAnalysisConsent: this.data.aiConsent,
        materialAnalysisConsent: this.data.materialConsent
      });
      this.setData({ title: '', description: '', media: null, aiConsent: false, materialConsent: false, message: '记录已保存，管理员审核后会通知你。' });
    } catch (error) {
      this.setData({ message: error.message || '保存失败，请检查网络后重试。' });
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  }
});
