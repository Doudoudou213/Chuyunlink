# 采集 / 地图 · 纸本顶边轻修饰

更新：2026-09-30。分支 `ui/visual-redesign`，仅本地修改；未提交、推送、合并或部署。

## 最新要求与边界

- 去掉采集、地图剩余的旧深色标题框；沿用首页纸本字标，但两页原设计不错，不重做主体。
- 保留采集山水、动态卷轴、背景水印和全部表单；保留真实地图、点位弹窗、行程篮与路线规划。
- 只做小幅修饰；不改后端、云端数据、授权语义、业务事件或真实地图。
- 继续使用用户指定 UI 工作树：`C:/Users/lenovo/Documents/Codex/2026-08-16/guan/work/ChuLink-Legacy-ui`，不进入 `shan`，不覆盖后端工作树。

## 实现与设计选择

- 原 `#platform-header` DOM 保留，仅在这两页激活时隐藏。不能删除，因为 CloudBase 和其他页仍依赖原控件。
- 采集字标直接叠入原山水纸景，画面向文字、导航区渐淡；原卷轴和滚动视差保留。地图仅加 68px 手机 / 122px 桌面（含导航）的淡墨顶边，插画不覆盖地图瓦片。
- 共用现有原创 `chulink-ink-wordmark-v1.webp`；采集沿用 `collect-hero-shanshui-v1.webp`、`collect-scroll-watermark-v2.webp`；地图沿用原弹窗的 `map-landmark-east-lake-ink-v1.webp`。没有新增生图或修改素材像素，也没有把首页花卉套到这两页。
- 纸底 `#f8f4eb`、浅纸面 `#fffcf5`、墨色 `#30392e`、辅助 `#756e5e`、朱色 `#a7493d`、石绿 `#58725f`。保留原 Noto Serif SC 标题和正文字体，原表单与弹窗细节不重绘。
- 地图淡墨图只做 14 秒往返的极轻漂浮，尊重 reduced-motion，并在离屏 / 页面后台时暂停；采集不叠加另一组持续动画。
- 账号、帮助收进“更多”，消息沿用原状态显示；定位仍用采集表单/地图原按钮，不增加重复定位入口。桌面导航移到纸景中，手机保留底部。
- 所有原节点迁移只由 `static/discover-paper.js` 管理，新增 `static/field-paper.js` 不搬节点、不替换业务事件。
- 菜单支持 ArrowDown、Escape、外点与失焦收起；按实际弹层打开/关闭状态交接焦点，避免异步登录抢回用户已移走的焦点。字标失败时显示文字回退。
- 地图 view 加局部 `isolation`，避免400级内部层级盖住全局弹层。用实际底栏高度计算地图可视区；ResizeObserver 只通知原 Leaflet 实例更新尺寸，不重建地图、不改路线或缩放逻辑。

## 文件与回撤边界

1. `index.html`：两页装饰结构、静态 CSS/JS 引用、地图 stage 类；原 3 个非空内联脚本和 159 个事件属性完全一致。
2. `static/field-paper.css`：仅采集/地图新视觉与响应式。
3. `static/field-paper.js`：菜单/焦点、字标回退、动画暂停、布局尺寸同步。
4. `static/discover-paper.js`：扩展共享节点迁移的两页目标和 class 观察；首页/个人页原分支仍保留。
5. `tools/validate-cloudbase-build.js`、`tools/deploy-cloudbase.ps1`：只纳入新静态文件清单和语法验证。未执行部署脚本。

工作树原先还有加载页、首页、个人页、社区和 cloudbase-app.js 的未提交工作，全部保留。`static/cloudbase-app.js` 本轮不编辑，SHA256 仍为 `33DC525494BFAEB1138362766B1C716EBBD86885D834DB373E67461A957246F0`。

本轮起点副本：`D:/OneDrive/文档/ChatGPT/楚韵链迹/output/field-paper-20260930/before/`。只用于差异审阅及选择性回撤，不要将副本直接覆盖后续修改。

## 预览与验证记录

- 采集：`http://127.0.0.1:4180/?view=collect&preview=field-paper-v1`。
- 地图：`http://127.0.0.1:4180/?view=map&preview=field-paper-v1`。
- 服务脚本仍为 `D:/OneDrive/文档/ChatGPT/楚韵链迹/loading-preview.cjs`，服务根固定为 UI 工作树。本次 4180 重启 PID 50816；将来续接需重新查端口，不依赖旧 PID，不停止其他任务服务。
- 输出与测试脚本：`D:/OneDrive/文档/ChatGPT/楚韵链迹/output/field-paper-20260930/`。
- 独立 Edge，无真实登录态；阻断所有非 GET/HEAD/OPTIONS 请求，不提交投稿、授权、报名或奖励，不请求真实定位/麦克风。
- 前两轮测试分别在768px和1440px遇到外部 Tailwind / Lucide CDN失败，导致原有全局初始化失败；错误状态截图不能用作视觉验收。报告保留为 `qa-first-pass-cdn-failure.json`、`qa-second-pass-cdn-failure.json`。
- 最后一轮测试在 QA 脚本内复用成功取得的真实 CDN JS 字节，记录来源及 SHA256，不替换产品代码、不编造框架响应。此方法验证界面与交互，不代表 CDN 可用性已修复。
- 最终测试结果：182/182 项通过，0 个未捕获 JavaScript 错误；隔离测试拦截了 120 个非只读网络请求。覆盖 320/390/768/1440px、200% 根字号、减少动态效果、菜单焦点、原节点跨页保留、采集本地媒体预览及地图点位/行程篮。报告为输出目录 `qa-report.json`。
- 构建验证 48 文件 / 23 JavaScript / 5 内联脚本 / 8 弹层头部通过，地图规则 11/11 通过，差异空白检查通过。真实云端登录、定位、麦克风及投稿写入不在此次验证内。
- 已人工复核最终双页预览。桌面地图上方/左侧的灰色留边在改动前截图中也存在，与原 `static/map-config.js` 的地图瓦片范围限制一致，不是本次标题改造或加载残缺；本轮保持原地图范围与缩放规则。

## 后续上线注意

当前 UI 分支业务代码落后线上。即使用户随后授权，也不能从本目录直接整包覆盖 `index.html`、`cloudbase-app.js` 或 `admin.html`。沿用 `PROFILE_PAPER_REDESIGN_PROGRESS.md` 的“线上最新入口 + 批准视觉差异”发布流程，并包含社区页待发布改动；重新核对后端并发变化。当前没有上线授权。
