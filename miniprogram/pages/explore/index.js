const { callCore } = require('../../services/core');
const { resourceCard, submissionCard } = require('../../utils/view-model');

Page({
  data: { loading: true, error: '', resources: [], submissions: [] },

  onLoad() { this.loadPage(); },
  onPullDownRefresh() { this.loadPage().finally(() => wx.stopPullDownRefresh()); },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const [resourceResult, publicResult] = await Promise.all([
        callCore({ action: 'getResources', limit: 8 }),
        callCore({ action: 'getPublic', limit: 6 })
      ]);
      this.setData({
        resources: (resourceResult.items || []).map(resourceCard),
        submissions: (publicResult.items || []).map(submissionCard)
      });
    } catch (error) {
      this.setData({ error: error.message || '暂时无法连接云端内容' });
    } finally {
      this.setData({ loading: false });
    }
  },

  openResource(event) {
    const resourceId = event.currentTarget.dataset.id;
    if (resourceId) wx.navigateTo({ url: `/pages/resource-detail/index?id=${encodeURIComponent(resourceId)}` });
  }
});
