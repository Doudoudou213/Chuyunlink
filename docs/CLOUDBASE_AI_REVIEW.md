# CloudBase AI 审核接入约定

## 当前状态

正式页面不再请求 `localhost` 或本地 Express API。投稿始终先写入 CloudBase：

1. 浏览器上传原始素材到云存储。
2. `appCore.createSubmission` 创建 `pending` 投稿。
3. 人工管理员通过 `adminSubmissions` 完成最终审核。
4. 只有人工审核通过后才发放积分。

AI 审核目前默认关闭，因此不会影响已上线的人工审核链路。

## 启用方式

未来部署名为 `aiReview` 的 CloudBase 云函数后，在加载
`static/cloudbase-app.js` 之前设置：

```html
<script>
  window.CHULINK_AI_REVIEW_ENABLED = true;
</script>
```

启用后，投稿创建成功会调用：

```json
{
  "action": "enqueue",
  "submissionId": "投稿 ID"
}
```

AI 函数应从数据库读取投稿和云存储 `fileID`，不要相信客户端传入的评分、
风险标签或审核结论。

## aiReview 云函数建议动作

### `enqueue`

- 验证当前用户是投稿所有者。
- 验证投稿仍为 `pending`。
- 创建幂等任务，避免同一投稿重复扣费调用模型。
- 返回 `queued`，耗时分析在云端继续执行。

### `precheck`

- 用于将来需要同步展示的轻量文本或元数据检查。
- 不应承担大文件、多模型或长耗时任务。

### `verifyLocation`

- 在服务端验证经纬度格式、时间戳和允许区域。
- 后续可以连接云数据库中的湖北边界数据。
- 不再连接用户电脑上的 PostGIS。

## 投稿中的 AI 字段

`appCore` 已为每条新投稿预留：

```json
{
  "reviewPipelineVersion": 1,
  "aiReviewStatus": "not_requested",
  "aiReviewDecision": "",
  "aiReviewProvider": "",
  "aiReviewSummary": "",
  "aiReviewUpdatedAt": null
}
```

推荐状态：

- `not_requested`
- `queued`
- `processing`
- `completed`
- `failed`
- `deferred`

AI 只提供初筛和建议。`status`、`reviewerId`、积分和最终公开状态仍只能由
`adminSubmissions` 修改。

## 可扩展的 AI 能力

- 图片真实性、清晰度和敏感内容检测
- 口述音频转写与内容摘要
- 视频关键帧抽取与风险检测
- 文物、景点、技艺标签分类
- 相似资源检测与去重
- 文化背景摘要和管理员审核建议
- 评论内容审核
- 语义搜索与推荐

模型 API Key、CloudBase 自定义登录私钥和第三方服务密钥必须只保存在云函数
环境变量或密钥管理中，不能写入网页、小程序或 Git 仓库。
