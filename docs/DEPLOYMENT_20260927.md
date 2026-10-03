# 2026年9月27日部署记录

## 已完成

用户在本轮明确要求部署并推送。本次实际部署代码基线：9f827dd0edcb4e430c1d59a76379e53684a78d58。
环境：chulink-legacy-d8god1687a5d60743。

- 使用官方 CloudBase CLI 3.6.4 的代码更新模式部署 appCore、adminSubmissions、storyWorker、storyAgentWorker、materialWorker；五个函数均返回成功且状态 Active。未更新 miniProgramAuth。
- 静态托管38个文件上传成功，包含首页、后台、专题、向导、新讲解审核与评测、内容效果入口及现有视觉素材。
- 最新独立UI工作树仍为db42aa7及原有未提交加载封面等修改；相关加载style/script与本次发布一致，使用中的背景哈希一致，署名与撤回控制保留。UI工作树未修改。未引用的旧凤鸟位图未额外添加。
- 五个函数的环境变量、运行时、超时、内存、入口与触发器全部与部署前指纹匹配。首次比较受PowerShell无序字段序列化影响；以全部720种顶层字段排列匹配部署前指纹后，五个函数均确认配置值不变。没有记录或输出密钥。

## 开关与真实能力边界

新 GUIDE_GENERATION_MODE 未配置，按代码默认 off；appCore/adminSubmissions 的 CONTENT_EFFECTS_ENABLED 未配置，默认关闭。界面与代码已上线不等于真实讲解生成或统计采集已经开启。
旧 storyWorker AI_ENABLED=true、materialWorker MATERIAL_MODE=real_ocr / MATERIAL_REAL_OCR_ENABLED=true 均原样保留；storyAgentWorker AGENT_ENABLED=false、AGENT_SHADOW_MODE=true 原样保留。本次没有调用任何模型、OCR、转写或语音服务，不声称旧付费开关已关闭。

## 实际检查

- 部署前：效果5项脚本、向导25项脚本通过；多模态相关30项回归及构建通过；效果3组、向导6组本地浏览器检查通过。测试数据为本地替身或固定响应。
- 部署后：28个公开页面、脚本、样式和代表性图片均HTTP200，SHA256与本地文件一致。
- 未登录调用appCore读取不存在的私人行程，返回UNAUTHENTICATED；未登录读取adminSubmissions内容效果报表，同样返回UNAUTHENTICATED。无私人数据返回，没有生产业务记录写入。
- 未测：登录后真实行程保存恢复、管理员报表实际查询、采用通知、云端集合权限/索引/清理、真实模型质量、地图道路与语音。此次只做最小部署冒烟，不是完整业务验收。

## Git状态

本次没有merge、rebase或改写历史。尝试推送同名开发分支refactor/resource-model-v1到既有origin时，自动审批要求用户明确确认外部仓库地址，操作已被拦截，尚未推送成功。已经向用户询问是否允许发送到 https://github.com/cgygygg/ChuLink-Legacy 的 refactor/resource-model-v1 分支；收到确认前不重试。

本次部署成功与GitHub推送受阻是两个独立结果。文档记录提交不影响已部署代码基线。