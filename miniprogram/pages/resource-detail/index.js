const { callCore } = require('../../services/core');
const { resourceCard } = require('../../utils/view-model');

Page({
  data: { loading: true, error: '', item: null },
  onLoad(query) {
    this.resourceId = query.id || '';
    this.loadDetail();
  },
  async loadDetail() {
    if (!this.resourceId) { this.setData({ loading: false, error: '缺少资源编号' }); return; }
    try {
      const result = await callCore({ action: 'getResourceDetail', resourceId: this.resourceId });
      const item = resourceCard(result.item || {});
      this.setData({ item, error: '' });
      if (item.title) wx.setNavigationBarTitle({ title: item.title });
    } catch (error) {
      this.setData({ error: error.message || '资源详情暂时无法读取' });
    } finally { this.setData({ loading: false }); }
  }
});
