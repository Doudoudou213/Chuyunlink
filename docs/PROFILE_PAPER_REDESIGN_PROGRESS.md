# “我的”纸本插画改版 · 续接记录

2026-09-29 本地试作与验证完成。2026-09-30 用户认可并授权部署；发布状态见文末，未提交、推送或合并。

## 范围与用户决定

- 唯一工作树 `C:/Users/lenovo/Documents/Codex/2026-08-16/guan/work/ChuLink-Legacy-ui`，`ui/visual-redesign`。
- 用户认可首页纸本插画试作，要求参照茶颜悦色第二张“我的”截图继续个人页；已回答：资料区可以，小排徽章预览，小一点精致一点。
- 参考位于 `C:/Users/lenovo/.codex/state/plugins/product-design/assets/chulink-ref-02-teayan-profile.jpg`。借鉴花叶顶景、轻纸卡、分区秩序，不复制茶颜商标/插画/会员消费业务。
- 无新云端功能、奖励规则、真实徽章解锁或上传写入。现有徽章墙是静态演示，不显示虚构日期与进度。小排明确为设计图样预览。
- 本轮允许改“我的”，覆盖上一份 HOME 记录“其他四页不动”的旧范围限制，但不允许部署或合并后端。

## 实现

- `static/profile-paper.css`：共用首页纸色和字标；短花叶顶景、米白资料卡、3 枚小徽章（手机 56px / 桌面 66px）、缩小图鉴/反哺入口、作品区字号与状态层次。
- `static/profile-paper.js`：仅移动原节点和强化披露/键盘焦点，不替换 CloudBase 渲染器和事件。
- `static/discover-paper.js`：集中管理首页/个人页/其他页的原导航与帮助节点。桌面在纸面、手机原底部导航；其他页还原。
- `index.html`：静态 hero/预览区与资源引用。旧徽章演示 hooks 保留，纸本模式下隐藏旧演示内容；新详情明确注明“不代表已获得”。
- 三张独立原创透明 WebP：`profile-badge-{architecture,bronze,fieldnotes}-v1.webp`；256px，约 35–38KB/张。
- 仅更新部署脚本文件清单和构建检查，未执行部署。

## 保留与撤回边界

- `static/cloudbase-app.js` 未改，SHA256 `33DC525494BFAEB1138362766B1C716EBBD86885D834DB373E67461A957246F0`。
- 起点已有加载动画、AI 授权撤回与首页改版未提交修改，必须保留。
- 本轮起点副本：`D:/OneDrive/文档/ChatGPT/楚韵链迹/output/paper-profile/baseline/`，含 index.html 与 discover-paper.css/js。
- 不可用副本整文件覆盖后来的编辑；撤回时仅反向个人页增量及共享导航个人页分支。
- 不修改 `ChuLink-Legacy-resource-model`，不合并 `shan`。

## 预览与安全测试

- 本地 `http://127.0.0.1:4180/?view=profile&preview=paper-profile-final`；服务仍是工作区 `loading-preview.cjs`。重启说明见 HOME_PAPER_REDESIGN_PROGRESS.md，勿重复占用端口。
- 用户允许独立 Edge 自动化；不使用登录态，测试拦截所有非 GET/HEAD/OPTIONS 请求。
- 有内容/空状态用测试浏览器临时 route 插入的 `__profileQa` 调用原渲染器。它只存在外部 QA 脚本，不进产品代码；用户正式预览不会看到测试数字和测试投稿。
- 证据/脚本均在 `D:/OneDrive/文档/ChatGPT/楚韵链迹/output/paper-profile/`。
- `capture-profile.cjs` 为首轮截图；`verify-profile.cjs` 为完整交互测试；`compare-profile.cjs` 组合参考/旧版/新版。
- 第一次发现图鉴内层重复 padding 导致过高，已压缩。只读审查发现弹窗焦点未返回、异步消息弹窗漏聚焦，已改为观察实际打开/关闭。
- 第二轮发现设置浮层被资料卡遮挡，单独拆开背景与工具层：背景 z0，纸卡 z1，工具 z3，hero 不建立独立堆叠，避免背景盖住资料。已重拍并通过验证。
- 最终 `verify-profile.cjs`：99/99 检查通过，0 个未捕获 JS 异常，74 次写请求被测试拦截。包括 320/390/768/1440、弹层焦点、350ms 延迟消息打开、真实筛选渲染器、取消 AI 授权撤回确认、空态采集入口、五页导航、尺寸切换、长昵称、根字号 200%（底栏随标签增高，不裁字）、减少动效和图像失败回退。
- 原数据登录/写入没有测试，也没有改变。拦截匿名登录造成预期网络错误；丢图测试有预期 404。
- `node tools/validate-cloudbase-build.js`：43 files / 22 JS / 5 inline scripts / 8 sticky modal headers，通过。地图回归 11/11；`git diff --check` 通过。
- 视觉证据：`comparison-final.png`（左参考 / 中本轮前 / 右新版，390px 归一）、`comparison-badges-final.png`、`final-profile-{320,390,768,1440}.png`、设置/空态/徽章/长昵称等截图。资料卡与内容截图中测试记录仅用于排版，不是云端真实用户数据。
- 原创素材提示词及版权说明见 `PROFILE_PAPER_ASSETS.md`。

## 后续

用户已认可插画、资料卡和小排徽章的比例，2026-09-30 授权部署；发布进展见下。

## 2026-09-30 窄范围发布（已完成）

- 用户提醒：以后不必每页共用同一插画；当前版本认可，先部署，不继续重画。
- 后端分支已于 9/29 发布较新的业务页面，9/30 的向导第一层新代码仍未部署。不能执行本 UI 工作树的整包静态发布，否则会覆盖线上新的 admin.html、cloudbase-app.js、采集授权/署名/贡献/向导入口。
- 发布根目录：`D:/OneDrive/文档/ChatGPT/楚韵链迹/output/paper-release-20260930/`。`before/` 保存发布前线上入口和业务/管理员文件；`manifest.json` 保存发布精确文件及 SHA256。
- `prepare-release.cjs` 以下载的线上 index.html 为底，只替换 5 处已批准视觉片段；反向替换后必须字节级还原线上底稿。全部原 inline script 及外部业务脚本引用保持不变。没有采用后端分支尚未上线的 index.html。
- bundle 仅 10 文件：整合后的 index.html、4 个 paper CSS/JS、5 张新插画/字标/徽章。没有管理员、业务脚本、云函数、配置或数据。未合并任何分支。
- `deploy-reviewed.ps1` 必须按 assets → index → verify 分阶段执行，含固定 allowlist、暂存哈希、线上 index/admin/cloudbase-app 并发变动拦截。禁止改为旧 tools/deploy-cloudbase.ps1 -StaticOnly。
- 9 个新视觉依赖及入口 index.html 已由 CLI 上传成功。120/120 线上基线兼容检查通过，0 个未捕获 JS 异常；全部原有贡献区、署名和材料授权控件保留。48 个测试匿名登录 POST 被阻断；授权对话全部取消，未发业务写请求。
- 撤回方式：只有确认线上入口仍为本 manifest 的 index 哈希时，才可单独上传 before/index.html 恢复。不要覆盖后续别人的新页面，不必删除9个未引用视觉文件，不要回退云函数/后台。
- 这次发布产物不是旧 UI 工作树的完整镜像。后续发布必须继续保留线上新增业务，不可直接上传 UI index/cloudbase-app/admin；后端若要上传网页也必须先整合当前视觉层。
- 正式版本 `paper-20260930`，首页 `https://chulink-legacy-d8god1687a5d60743-1458884983.tcloudbaseapp.com/?view=discover&release=paper-20260930`，个人页把 view 改为 profile。HTTP 10/10 文件 SHA256 与 manifest 匹配，admin.html 和 cloudbase-app.js 与发布前相同。记录见 `production-hash-verification.json`。
- 真实线上独立 Edge 检查 22/22 通过（390、1440），无产品资源替换或测试数据注入。index 及9个视觉依赖均HTTP200；导航、菜单、帮助焦点、徽章、贡献区与原脚本正常。截图 `production-home/profile-390/1440.png`；报告 `live-smoke-report-after-notice.json`。初次被腾讯测试域名提醒挡住，正常点击“确定访问”后通过，首次提醒页失败报告保留作诊断，不算产品失败或通过。
- 正式浏览器测试仍阻断所有非 GET/HEAD/OPTIONS（24个匿名登录POST），因此默认“正在连接…”和零值不是登录后真实数据的验收；没有登录真实账号或进行写入。没有调用付费模型/OCR，没有改云函数、配置、管理员页面或数据库。
- 后端工作树仍为 `1fbfcaf`，干净、未受本轮修改；后端对话读取时 idle。它9/30新功能本轮未部署。未创建提交、push、merge或改写Git历史。
