# 首页纸本插画改版 · 续接记录

更新：2026-09-30。用户已认可首页和个人页并授权部署。发布状态与续接步骤统一见 PROFILE_PAPER_REDESIGN_PROGRESS.md 文末；未提交、推送或合并。

## 边界与最新决定

- 工作树：`C:/Users/lenovo/Documents/Codex/2026-08-16/guan/work/ChuLink-Legacy-ui`，分支 `ui/visual-redesign`。本轮起点 `db42aa7`。
- 用户最新指令允许改首页，覆盖旧“五页统一计划”里暂不动发现页的约束。**不是授权改其余四页，也不是授权部署。**
- 用户提供的茶颜悦色四张截图是美术参考；口头所说“茶姬”沿用这组参考，没有更换为另一个品牌。
- 最高优先：图一的一整张纸、边角插画、手写标题、低对比背景；页头布局取最后提供的荷花页头局部图。
- 删除首页独立暗红顶栏；前景放原创“楚韵链迹”字标，后景放原创莲花、桂花和淡墨江水，向中心和下方退淡。
- 前景文字稳定，后景轻浮动并有小幅滚动视差，减少动态效果时关闭。
- 账号/帮助收纳入“更多”；定位以轻文字保留，消息入口沿用原登录状态逻辑。桌面导航移至纸面，手机仍在底部。
- 不复制对方商标、商业插画、系统状态栏或微信胶囊。不是茶饮业务的逐像素复刻。

## 本轮文件

1. `index.html`：引入独立样式/脚本；仅替换发现页原深色 masthead 与旧凤纹背景为纸面双层构图。
2. `static/discover-paper.css`：仅首页激活时应用的颜色、布局、纸面背景、菜单、响应式与动效。
3. `static/discover-paper.js`：移动原控件节点保留绑定，离开首页还原；更多菜单键盘操作、弹层焦点交接、筛选状态同步、图像失败回退和视差。
4. `static/assets/discover-botanical-paper-v1.webp`：1536 × 1024，240680 bytes。
5. `static/assets/chulink-ink-wordmark-v1.webp`：1000 × 264，156504 bytes，透明 alpha。
6. `tools/deploy-cloudbase.ps1`：仅补两项新静态文件至打包列表，没有执行部署。
7. `tools/validate-cloudbase-build.js`：纳入新增 CSS、JS、两张资产的检查。
8. `docs/HOME_PAPER_ASSETS.md`：内置 ImageGen 的完整提示词和来源说明。
9. `design-qa.md`：保留原章节，追加本次验收。

## 原有修改必须保留

开始前已有加载动画相关 `index.html` 修改、加载页素材/进度文档，以及 `static/cloudbase-app.js` 的 AI 授权撤回和初始加载事件修改。不是本轮产物，不能一并撤回。

- `cloudbase-app.js` 本轮前后 SHA256 均为 `33DC525494BFAEB1138362766B1C716EBBD86885D834DB373E67461A957246F0`。
- 开始前 HTML 副本：`D:/OneDrive/文档/ChatGPT/楚韵链迹/output/paper-home/baseline/index.html`。
- 不可直接用旧副本覆盖未来有人编辑过的 index；撤回时仅逆向本轮 HTML diff，去掉两处资源引用与新 hero，并还原旧 masthead/水印。
- 后端工作树在另一个目录继续工作。本轮只读核对隔离，未修改后端、未合并到 `shan`。后续发布前应协调两工作树的新进展，不可从旧 UI 基线覆盖新后端成果。

## 本地预览

URL：`http://127.0.0.1:4180/?view=discover&preview=paper-home-final`

当前由 `D:/OneDrive/文档/ChatGPT/楚韵链迹/loading-preview.cjs` 服务 UI 工作树。重启方式（PowerShell，隐藏窗口）：

```powershell
$env:CHULINK_PREVIEW_PORT = '4180'
Start-Process -FilePath 'C:\Users\lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' -ArgumentList 'loading-preview.cjs' -WorkingDirectory 'D:\OneDrive\文档\ChatGPT\楚韵链迹' -WindowStyle Hidden
```

先检查 4180 是否已被本服务使用，不要启动重复实例，也不要停止不明进程。

## 验证结果与证据

- 用户明确允许使用本机 Edge 独立自动化窗口；无持久登录配置。
- Edge / Playwright 验证 55 项通过，0 个 JavaScript 未捕获异常。
- 320×844、390×844、768×844、1440×1000，deviceScaleFactor=1：没有横向溢出，字标/背景均加载。
- 更多开关、ArrowDown、Tab/Enter 帮助、Escape、帮助关闭焦点返回；搜索和两种筛选；四页导航来回/直接进入个人页；断点切换；原按钮对象与绑定保留；正常/减少动效；字标丢失文字回退均通过。
- “我的”页顶栏、导航、账号按钮和页面 computed styles/几何尺寸与改前基线一致。截图不是逐像素完全一致（异步渲染/纹理与字体光栅状态），未将其误报为像素相同。
- 安全检查中拦截了所有外部非 GET/HEAD/OPTIONS 请求；CloudBase 匿名登录 POST 被拦截，产生预期网络错误。**没有验证真实登录、通知数据、提交写入、云端业务成功。**
- `node tools/validate-cloudbase-build.js`：38 files / 21 JS / 5 inline scripts / 8 sticky modal headers，通过。
- `git diff --check` 通过；有正常的 Git LF/CRLF 提醒。
- 证据根目录：`D:/OneDrive/文档/ChatGPT/楚韵链迹/output/paper-home/`。
- 最新脚本 `verify-home.cjs`；详细结果 `verification-report.json`；截图 `final-home-{320,390,768,1440}.png`、`final-menu-*.png`、`final-profile-*.png`。
- 视觉比较 `comparison-paper-reference-final.png`、`comparison-header-reference-final.png`；首次检查脚本 `check-home.cjs`。

## 下一步

2026-09-30 用户已认可并授权部署；这取代先前“等待反馈、不要部署”的旧状态。发布使用线上底稿叠加批准视觉层的窄范围包，详见 PROFILE_PAPER_REDESIGN_PROGRESS.md。仍不改其他三页、不重画全站导航、不发布云函数或修改云端业务。后续每页可用不同的插画，不把目前共用图片固化为设计规范。
