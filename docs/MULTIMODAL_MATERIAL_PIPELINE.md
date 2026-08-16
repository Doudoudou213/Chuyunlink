# 多模态材料处理开发说明

## 当前阶段

当前同时保留两条图片管线：

- `material-image-mock-v1`：完全虚构的安全流程测试。
- `material-image-tencent-ocr-v1`：腾讯云 `GeneralBasicOCR` 真实文字识别适配器。

- 当 `MATERIAL_MODE=mock_only` 或真实开关未开启时，不读取原始文件，也不会产生 OCR 费用。
- 模拟结果始终保存 `simulated: true` 与 `usableForStory: false`。
- 模拟结果即使被管理员确认，也不能进入正式链迹或故事生成。
- 真实结果先进行敏感字段脱敏，再交给管理员校对；只有人工确认后才保存 `usableForStory: true`。
- 旧的 AI 文字授权不等同于原始材料处理授权。

## 用户授权边界

投稿页保留原有“公开文字分析”授权，并新增独立的“原始材料识别”授权。新授权默认不勾选，后端保存：

- `materialAnalysisConsent: true`
- `materialConsentVersion: multimodal-material-consent-v1`
- `materialConsentScope: approved_original_file_extraction`

只有同时满足以下条件的图片投稿才会出现在材料识别队列：

1. 投稿已经由管理员审核通过；
2. 素材类型为图片；
3. 用户明确勾选原始材料识别授权；
4. 授权版本和范围与当前约定完全一致；
5. 文件仍然是有效的 CloudBase 私有云存储文件。

旧投稿不会被补写授权，也不会被自动识别。

## 云端模块

独立云函数 `materialWorker` 负责材料任务，不把长耗时处理继续加入 `appCore` 或 `storyWorker`。

数据集合：

- `material_analysis_jobs`：任务状态、输入指纹、处理版本和执行人。
- `material_analyses`：提取文字、质量信息、管理员校对结果。
- `material_analysis_logs`：创建与审核操作日志。
- `material_usage_daily`：按上海自然日记录真实 OCR 调用次数。

任务 ID 由文件标识、文件类型、大小和处理版本确定。相同输入重复点击会读取同一结果，不重复创建任务。

## 管理员工作台

管理员后台新增“材料识别”入口：

- 运行完全虚构的图片 OCR 流程测试；
- 查看取得新授权且已通过审核的图片；
- 在配置完成后，对单张已授权图片运行真实 OCR；
- 修改识别文字并确认，或退回结果；
- 清楚看到模拟结果不可用于故事的提示。

真实 OCR 默认限制：

- 图片原始文件不超过 5MB；
- 每日最多调用 20 次；
- 同一文件和处理版本复用同一任务，避免重复计费；
- 单次请求最长 15 秒，临时错误最多尝试 2 次；
- 图片只生成 10 分钟有效的短时 HTTPS 地址；
- 手机号、身份证号、邮箱、电话号码和长账号会在落库前脱敏；
- 数据库只保存原始 OCR 文本的 SHA-256 摘要，不保存未脱敏全文。

## 部署

`cloudbaserc.json` 已注册 `materialWorker`。部署脚本会在函数不存在时创建它，存在时只更新代码以保留云端配置。

首次部署后需要在 CloudBase 控制台确认：

1. `materialWorker` 的 `ADMIN_UIDS` 与其他管理员云函数一致；
2. 客户端调用权限只允许已登录的非匿名用户；
3. 云函数内部管理员白名单仍然是最终权限判断；
4. 尚未配置专用密钥时保持 `MATERIAL_MODE=mock_only` 与 `MATERIAL_REAL_OCR_ENABLED=false`。

## 开启真实 OCR

不要把 GitHub/CloudBase 部署使用的主密钥直接复用给 OCR。建议创建一个专用 CAM 子用户，仅授予通用文字识别接口权限。腾讯云 OCR 自定义策略的接口级资源必须填写 `*`，策略可以写成：

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "resource": ["*"],
      "action": ["ocr:GeneralBasicOCR"]
    }
  ]
}
```

然后在 CloudBase 控制台的 `materialWorker` 环境变量中新增或修改：

```text
MATERIAL_PROVIDER=tencent_ocr
MATERIAL_MODE=real_ocr
MATERIAL_REAL_OCR_ENABLED=true
TENCENT_OCR_SECRET_ID=<OCR 专用子用户 SecretId>
TENCENT_OCR_SECRET_KEY=<OCR 专用子用户 SecretKey>
TENCENT_OCR_REGION=ap-shanghai
TENCENT_OCR_LANGUAGE=zh
MATERIAL_DAILY_CALL_LIMIT=20
MATERIAL_MAX_IMAGE_BYTES=5242880
MATERIAL_OCR_TIMEOUT_SECONDS=15
MATERIAL_OCR_MAX_ATTEMPTS=2
```

两个密钥变量不能写入 `cloudbaserc.json`、GitHub 或前端。保存环境变量后，只需重新打开管理员后台“材料识别”页面；状态同时显示“开关已开”和“专用密钥已配置”时，真实按钮才会出现。

## 真实 OCR 与故事的边界

真实 OCR 仍然必须满足：

- 管理员确认后才将派生文字标记为可用于故事；
- 处理版本变化时生成新结果，不覆盖旧审核记录。

当前 `storyWorker` 还不会读取 `material_analyses`。这项整合属于后续阶段，避免真实 OCR 一上线就改变现有故事。
