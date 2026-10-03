# AI 接口与真实投稿候选链路

## 现在已经实现什么

基础设施与第二阶段“真实投稿影子模式”已经接通：

- 独立云函数 `storyWorker`，与 `appCore`、`adminSubmissions` 隔离。
- TokenHub 的 OpenAI 兼容接口适配器，密钥只从云函数环境变量读取。
- JSON Schema 结构化输出和服务端二次校验，模型不能引用候选列表外的资源。
- `ai_jobs` 幂等任务、运行锁、最大重试次数。
- `ai_usage_daily` 每日调用次数和 Token 预算。
- TokenHub 遇到 429、502、503、504 或网络超时时，会在云函数时限内自动退避重试一次；每次真实请求都会计入预算。
- Hy3 测试请求显式关闭深度思考，减少不必要的延迟与输出消耗。
- 关系类型同时受 JSON Schema 枚举和服务端白名单约束；模型若仍返回非法类型，会自动重新生成一次，绝不直接写入链迹。
- `ai_analyses` 保存虚构测试和真实投稿分析结果；真实结果标记为 `synthetic: false`。
- 管理员后台“AI 接口”页面：只读状态不会调用模型，人工按钮才会运行一次虚构测试。
- 新投稿可由用户主动勾选 AI 分析授权，默认不勾选；旧投稿缺少字段时按未授权处理。
- 真实任务必须同时满足 `status=approved` 和 `aiAnalysisConsent=true`，并在保存模型结果前再次校验。
- 发送给模型的投稿数据只包含标题、公开描述、素材类型和地区；不包含 UID、邮箱、文件、云存储地址或精确坐标。
- 模型结果写入 `ai_link_candidates`，状态固定为 `pending_admin`，不能由 `storyWorker` 直接写入正式链迹。
- 管理员可以确认或驳回候选；确认时与正式 `story_evidence_links`、审核日志在同一数据库事务中写入。

仓库配置文件不含任何 API Key。云端是否启用由 `storyWorker` 环境变量 `AI_ENABLED` 决定；现有投稿、审核、评论、兑换和链迹功能不受影响。

## 首次初始化

将代码合并到 `shan` 后，普通的 `Deploy CloudBase` 会继续部署现有云函数和静态网站，不会尝试更新尚不存在的 `storyWorker`。

一旦初始化成功，后续普通部署会自动用“只更新代码”的方式同步 `storyWorker`，不会覆盖它的 API Key 和其他云端环境变量。

首次把该工作流加入 `shan` 时，会自动运行一次 `Initialize AI Foundation`。也可以在工作流已进入仓库默认分支后手动运行：

1. 脚本会先检查云端是否已有 `storyWorker`。
2. 如果已经存在，它会主动停止，避免覆盖云端密钥。
3. 首次创建的函数保持 `AI_ENABLED=false`，且不含 TokenHub API Key。
4. 以后只有修改这份初始化工作流本身时才会再次触发；已有函数仍受步骤 2 保护。

## CloudBase 控制台配置

在 `storyWorker` 的环境变量中保存：

```text
ADMIN_UIDS=管理员 UID 列表
AI_ENABLED=false
AI_PROVIDER=tokenhub
AI_BASE_URL=https://tokenhub.tencentmaas.com/v1
AI_TEXT_MODEL=hy3
AI_DAILY_CALL_LIMIT=20
AI_DAILY_TOKEN_LIMIT=200000
TOKENHUB_API_KEY=在 TokenHub 单独创建的 API Key
```

先保存 Key，最后才把 `AI_ENABLED` 改成 `true`。不要把 Key 粘贴到网页、GitHub、文档或聊天中。

云函数调用权限可允许已登录的非匿名用户调用，但函数内部还会再次用 `ADMIN_UIDS` 校验管理员。以下四个 AI 集合的客户端数据库权限都应设为禁止读写；读写只能经由云函数完成：

- `ai_jobs`
- `ai_analyses`
- `ai_usage_daily`
- `ai_link_candidates`
- `story_chains`
- `story_chain_logs`

## 验收方法

1. 管理员登录 `/admin.html`。
2. 打开“AI 接口”，确认环境、模型、当日预算状态。
3. 点击一次“运行一次虚构数据测试”。
4. 页面应显示结构化摘要、候选关系和 Token 用量。
5. 再次点击应读取相同任务缓存，不重复调用模型。

虚构测试输入写死在云函数中。真实投稿分析必须由管理员对一条已审核、已授权投稿单独点击“生成候选链迹”才会开始。

## 快速止损与下一阶段

出现费用、输出质量或接口异常时，只需在云函数环境变量中把 `AI_ENABLED=false`，状态读取仍可使用，模型调用会立即被拒绝。

真实投稿候选和“带来源故事草稿”阶段已经完成。故事草稿只读取管理员已经确认的 `story_evidence_links`，每章都绑定来源，仍需管理员编辑发布。
