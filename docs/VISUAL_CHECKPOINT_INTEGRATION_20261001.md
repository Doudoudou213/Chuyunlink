# 视觉端本地 checkpoint 与整合交接

本记录供独立整合工作树使用：保存当前已完成的纸本插画视觉成果，不再新增功能。这里只操作 `ChuLink-Legacy-ui` 的 `ui/visual-redesign`，未修改后端工作树或 `shan`，不 push、merge、deploy。完成本地 checkpoint 后暂停修改，等待双方确认整合基线。

## 基线与本轮收尾

- 核对起点：`db42aa70870ef68cb305cd3e2f85652d32acd9fb`。起始工作树确为 5 个已修改文件、34 个新增文件，暂存区为空。
- 原有页面、样式、脚本、图片、字体与设计记录全部保留。旧具象小楚凤和第一版活动封面有明确历史用途，没有为清理工作树而删除。
- 本轮补齐 `tools/validate-cloudbase-build.js` 对 `static/assets/loading-gold-weave.webp` 的必需文件检查。
- `tools/test-ai-foundation.js` 初跑因 Windows CRLF 换行导致旧提取正则返回空值。只在测试读取时归一化换行，并为提取结果增加明确断言；复测通过，未修改云函数或减弱安全断言。
- 更新加载进度文档的当前完成条件；旧日期设计记录保留为历史。新 commit 的完整 ID 由交付回复提供，也可在本文件所在的 checkpoint 提交中查看，避免自引用哈希。
- 暂存检查发现字体许可证原文带一个行尾空格，已仅移除该空格，许可证文字与条款不变。

## 必须保留的视觉文件

1. `index.html` 的视觉结构、加载层、资源引用顺序和原有业务挂载点。
2. `static/discover-paper.css`、`static/discover-paper.js`：首页纸本封面、原创字标、共享原控件搬移协调。
3. `static/profile-paper.css`、`static/profile-paper.js`：个人资料区、精致徽章预览、图鉴入口和设置收纳。
4. `static/community-paper.css`：手绘活动封面、背景凤纹、路线与内容层级。
5. `static/field-paper.css`、`static/field-paper.js`：采集与地图页轻量页头、菜单、原卷轴与地图自适应。
6. `static/map-paper-edge.css`、`static/map-paper-edge.js`：地图底图补边与纸本边缘渐隐。
7. `static/paper-editorial.css`、`static/paper-editorial.js`：字标尺度、短标题笔意、默认关闭的活动签笺原型。
8. `static/assets/` 中现有被引用素材及本轮新增素材，不应仅拷贝新图而遗漏原采集、地图、路线与个人空态图片。
9. `tools/deploy-cloudbase.ps1` 的静态文件清单增量、`tools/validate-cloudbase-build.js` 的资源及语法校验增量。
10. 本轮 `docs/*PAPER*.md`、`docs/LOADING_SCREEN_PROGRESS.md`、本交接文档及 `design-qa.md`，用于保留素材来源、设计约束与测试限制。

本轮新增素材共 12 个，其中 10 张 WebP、1 个字体文件、1 个字体许可证：

- `static/assets/chulink-ink-wordmark-v1.webp`
- `static/assets/discover-botanical-paper-v1.webp`
- `static/assets/community-river-collage-v3.webp`
- `static/assets/community-phoenix-watermark-v2.webp`
- `static/assets/community-fieldnotes-cover-v1.webp`（历史方案）
- `static/assets/loading-gold-weave.webp`
- `static/assets/loading-chu-phoenix.webp`（历史方案，当前使用内联抽象凤鸟）
- `static/assets/profile-badge-architecture-v1.webp`
- `static/assets/profile-badge-bronze-v1.webp`
- `static/assets/profile-badge-fieldnotes-v1.webp`
- `static/assets/longcang-editorial-v1.woff2`
- `static/assets/longcang-OFL.txt`（必须随字体保留）

## 四类冲突文件的处理要求

### 首页 index.html

不能用视觉分支整份旧文件覆盖新后端首页。保留整合侧更新的授权、署名、贡献、向导、真实数据与提交逻辑，再移植视觉片段。

- 保留 `#chu-startup`、`#chu-startup-avatar`、浅金纸纹、抽象古铜凤鸟及减少动效规则。正式退出等待 `window.load` 和 `chu:initial-content-ready`，之后双帧淡出；6 秒提供手动入口，12 秒兜底。
- CSS 顺序：discover → profile → community → field → map-paper-edge → paper-editorial；增强 JS 在业务脚本后按 discover → profile → field → map-paper-edge → paper-editorial 加载。
- 保留 `paper-home-*`、`paper-profile-*`、`field-*` 结构与原业务 DOM id；保留 `renderCommunityRoute()` 中 `.community-paper-ribbon` 与对应数字节点布局。
- 保留活动封面 `.community-cover-figure`、彩绘山水、凤纹水印与旁注。徽章是图样预览，不能改成已获得的成就或编造数量。
- `discover-paper.js` 搬移的是原账号、帮助、消息与导航节点，不得克隆按钮或用 `innerHTML` 重建，以免丢失状态或重复绑定事件。
- `#paper-activity-note` 默认隐藏，只在本地服务注入 `html[data-activity-preview="true"]` 时显示示例。生产不得自动开启示例活动。

### 管理员页 admin.html

本轮相对 HEAD 无改动，后台视觉主要已保存在父基线 `db42aa7`。只 cherry-pick 新 checkpoint 不能保证取得这些祖先改动；整合必须检查视觉分支历史。

- 保留 `.admin-topbar`、帮助与账号收纳、原 `#logout` 节点、`#admin-navigation` 分组及手机展开。
- 保留 `setActiveView()` 对 `#admin-panel[data-view]`、`aria-current` 的设置。
- 保留故事编辑区的 `data-story-state`、中文状态、版本号及历史完整章节和结语，素材区图文对照与原文只读区。
- 保留末尾 `enhance`、`filterTriage`、`enhanceTriage`、`enhanceEditorial`、`disclose`、`foldFilters`、`simplifyWorkspace` 等渐进增强，以及必填验证自动展开、卡内反馈、原图放大。
- 祖先提交还包含 `rejectAiCandidate()` 至少 4 字拒绝原因校验，不是纯 CSS。以新后端的权限、API 和审核守卫为准移植显示增强，不能回退业务保护。

### static/cloudbase-app.js

以下既有未提交改动纳入 checkpoint，整合时与新后端等价实现去重，不整份覆盖：

- `[data-withdraw-ai-consent]` 的事件委托、确认、按钮禁用和错误恢复、`withdrawAiAnalysisConsent` 调用及个人页刷新。
- `aiAnalysisConsent === true` 时的撤回入口，以及 `aiAnalysisStatus === 'consent_revoked'` 的说明；与 `index.html` 内 `.profile-consent-stop`、`.profile-consent-revoked` 样式配套。
- 初始资料、资源与公开动态加载链在 `finally` 中派发 `chu:initial-content-ready`。应接在新后端等价初始化边界，不能误删，也不要重复派发或重复绑定点击。

**待整合依赖：视觉工作树的 appCore 没有 `withdrawAiAnalysisConsent` 实现。** 此处保留原有前端成果，没有在旧后端补接口。真实撤回、状态回写与权限必须在整合侧接通并验证；本 checkpoint 不宣称它是已完成的端到端功能。

### 部署与构建脚本

`tools/deploy-cloudbase.ps1` 的本轮增量仅为上述 11 个静态 CSS/JS 清单项；`static/assets/` 原有递归复制必须保留。以整合侧新版部署脚本为基础合并清单，保留新版后端部署保护、函数配置与其他资源，不能使用旧 UI 脚本整份替换。

`tools/validate-cloudbase-build.js` 应保留两侧检查的并集，包括新视觉资源、增强脚本语法、生产文本禁项与固定关闭按钮检查。此次检查通过不等于执行了打包上传；本轮没有运行部署脚本。

## 地图边缘与运行范围

`map-paper-edge.js` 只放开严格匹配的 HTTPS 高德在线 TileLayer 的 `bounds` 裁切，让大视口不出现空白底图边界。Map 的 `maxBounds`、坐标、路线、缩放规则和离线底图规则仍保留。渐隐仅位于底图 tile pane，不遮挡标记、路线、控制按钮或来源署名。整合时避免放宽任意图层或离线资源的请求范围。

## 本地检查与未验证事项

本轮检查证据放在工作树外的 `output/visual-checkpoint-20261001/`，截图、测试夹具、浏览器状态及临时服务不进入 Git。完整验收记录见 `design-qa.md` 的 checkpoint 章节。

- 构建校验通过：56 个必需文件、25 个 JS、5 个内联脚本、8 个固定弹窗关闭头部。
- 地图规则 11 项、福利安全 21 项、评论安全、素材流水线 mock、AI 基础 mock 测试通过；部署 PowerShell 仅解析语法通过。
- 五页在 320、390、768、1440 宽度下复测，主套件 322 项与活动签笺补充 44 项通过；独立 Edge 不携带登录状态，非只读请求全部阻断。
- 管理员未登录外观与菜单 12 项、独立加载预览外观及手动退出 10 项通过；浏览器合计 388 项，最终报告无运行错误，拦截 348 次非只读请求。管理员登录后的工作区没有实测。
- 五页均观察到加载层自动移除，测试没有主动删除它；由于云请求被拦截，未区分成功就绪与 12 秒兜底，不据此宣称真实数据加载成功。解析器阻塞的极端 CDN 故障实验因截图等待超时未得结论，保留失败记录，不计入通过项。
- 手机 390 与电脑 1440 共 10 组前后截图已并排人工检查：布局、字形、配色、插画与文案无新增视觉回退。个人页细微差异为渲染/动效，活动桌面的速学内容轮换不作为排版不一致。
- 新增 10 张 WebP 均可完整解码；本地引用及部署清单未发现缺项，常见密钥模式与临时文件检查未发现可疑新增内容。模式扫描不等于完整秘密审计。
- 未运行真实用户登录、投稿、报名、评论、兑换、撤回授权、定位、麦克风或管理员登录后写入；不能据本地 UI 检查推定这些已与新后端兼容。
- 未做真机 Safari、完整屏幕阅读器审计或外部 CDN 可用性保障。浏览器复测复用实际成功下载的公共依赖字节以减少网络波动，不替换应用业务逻辑。

## 整合后再发布

视觉工作树含较旧的业务基线，不应从此目录直接上传覆盖新版生产。请在独立整合工作树合并双方成果，先解业务冲突和授权接口依赖，再复测移动端、桌面端、加载退出及管理员真实流程。此记录不授权发布；checkpoint 后视觉端保持冻结，等待整合基线确认。
