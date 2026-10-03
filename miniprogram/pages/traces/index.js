const { callCore } = require('../../services/core');
const { resourceCard } = require('../../utils/view-model');

Page({
  data: { loading: true, error: '', items: [] },
  onLoad() { this.loadTraces(); },
  async loadTraces() {
    try {
      const result = await callCore({ action: 'getResources', limit: 20 });
      this.setData({ items: (result.items || []).map(resourceCard), error: '' });
    } catch (error) {
      this.setData({ error: error.message || '链迹暂时无法读取' });
    } finally {
      this.setData({ loading: false });
    }
  },
  openResource(event) {
    wx.navigateTo({ url: `/pages/resource-detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  }
});
