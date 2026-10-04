# 荆楚徽章图谱 · 视觉与接口预留

## 本轮边界

- 工作树：`ChuLink-Legacy-integration-20261001`，分支 `codex/integrate-ui-backend-20261001`；起点 `436fa7443eb3f809f5ae6929f99c395cd395b736`，起点工作树干净。
- 用户认可十二枚图样，要求分别抠出并做好展示，获取条件判定先预留接口，真实获取闭环留待下一阶段。
- 只新增个人页徽章展示、文案、素材、只读接口占位与本地测试。没有修改 `static/cloudbase-app.js`、管理员或任何云函数，没有提交、推送、合并或部署。
- 首页三枚精致预览保留；原按钮展开完整十二枚图谱；任一图样可打开获取条件。旧静态演示墙的 DOM hooks 保留且继续隐藏，不将旧积分或日期作为新徽章的状态。

## 文件与素材

- `static/badge-catalog.js`：稳定 ID、名称、图案描述、获取条件、去重键、规则版本，以及资格判定接口占位。
- `static/profile-badges.js`、`static/profile-badges.css`：个人页小排、完整图谱、可滚动的原生 dialog；关闭返回触发按钮，Escape 关闭；图片失败保留名称/说明。沿用原有展开/收起处理，不改账号或奖励逻辑。
- `static/assets/badges-v1/{id}.png`：十二枚透明 PNG 原始输出，1254×1254。
- `static/assets/badges-v1/{id}.webp`：同图机械缩放到 512×512，WebP quality 88/alphaQuality 100，约 68–100 KiB/枚。前端加载这一版，保持真实 alpha；没有以 CSS/SVG 重画图案。
- 旧三枚 `profile-badge-*-v1.webp` 未覆盖，仍保留给已有其他位置使用与回退。
- `index.html` 仅增加图谱容器、详情、三个运行时依赖与入口文字。`tools/deploy-cloudbase.ps1` 只补文件清单，没有执行。已有 assets 递归复制覆盖新增资源。
- `tools/test-badge-catalog.js` 验证十二枚资源、规则、未知状态、取消/无效 ID 和无网络/持久化；构建检查纳入运行时与十二张 WebP。

## 规则清单（全部尚未开放获取）

规则版本：`2026-10-04.v1`。所有复合条件采用 AND；审核/采纳由服务端权威记录决定。

| ID | 名称 | 条件 | 去重依据 |
| --- | --- | --- | --- |
| architecture | 古建寻迹 | 3 处不同古建筑有效采集通过审核 | resourceId |
| bronze | 编钟知音 | 2 件不同传统乐器或礼乐器物记录通过审核 | resourceId |
| fieldnotes | 楚地拾遗 | 第一份有效采集通过审核 | submissionId |
| pattern | 纹样拾花 | 3 个不同对象纹样，附特写、部位和说明，通过审核 | resourceId |
| inscription | 碑影留痕 | 2 处碑刻/题记，附影像与文字整理，通过审核 | resourceId |
| artisan | 匠心留声 | 1 份经讲述者授权的匠人/守护人口述与摘要，通过审核 | recordId |
| journey | 江汉行记 | 3 处不同地点的实地采集通过审核，同城即可 | placeId |
| artifact | 楚器观微 | 3 件不同器物，整体/细节影像及工艺或纹样观察，通过审核 | resourceId |
| proofreader | 文脉校书 | 3 条不同、带出处的纠错被采纳 | correctionId（同一问题不能拆分累计） |
| collaborator | 同卷共书 | 为其他贡献者的 3 份不同记录补充资料且被采纳 | targetRecordId |
| lamplight | 灯下问楚 | 完成 5 个不同学习主题，且答对 5 道不同题目 | topicId / questionId |
| heritage | 薪火相传 | 10 项有效贡献，覆盖至少 3 类内容，其中至少 2 项协作补充被采纳 | contributionId / categoryId / supplementId |

尊重访问/拍摄限制，不触碰文物、不擅自拓印；辨识不清的文字标注疑问；口述先授权。无付费、连续签到、持续定位要求。插画是艺术图样，不是器物形制或历史事实的证据。

## 判定接口：已预留，未接线

```js
const result = await window.ChuBadgeCatalog.checkEligibility('architecture', { signal });
// 当前唯一有效结果：
// { schemaVersion: 1, badgeId: 'architecture', ruleVersion: '2026-10-04.v1',
//   status: 'not_connected', eligible: null, earned: null,
//   progress: null, checkedAt: null }
```

- 不接收用户 UID 或客户端计数，不读 localStorage，不调用不存在的云接口，无发章/领奖方法。
- `null` 是“尚不知道”，不是 0、不达标或未获得。界面因此只显示“图样预览 · 获取功能尚未开放”。
- 无效 badgeId 抛 RangeError；已经取消的 signal 抛 AbortError；返回对象与规则只读冻结。
- UI 即使读到其他 status，也不会擅自显示“已获得”。下一阶段必须同时实现真实读取、授权与发章记录，再显式开放这些状态。

### 下一阶段对接要求（尚未实现）

1. 将 `checkEligibility` 内部换为现有认证通道的只读调用；服务端从登录身份解析用户，不能信任浏览器传入的 UID、计数、规则或时间。
2. 明确审核通过/撤回/归档的证据边界，统一对象 ID、地点 ID、问题去重及内容类别枚举。现在的 metric/distinctBy 是契约名称，不声称数据库已具备对应字段。
3. 查询资格与读取发章记录分开：eligible 不等于 earned。服务端应回传每项可靠进度、版本与核验时间；匿名/未连接/错误均保留未知，绝不填零。
4. 发章走服务端幂等流程（用户＋badgeId＋规则版本），处理重复请求、审核撤回、规则升级、重算与审计，再增加已获得/进度展示。不要通过修改此目录的 JSON 或前端变量授予真实权益。
5. 先验证历史证据映射、学习记录真实性和去重，再决定是否回溯授予；旧演示记录不能迁入正式徽章账本。

## 美术来源与处理

批准图谱：`C:/Users/lenovo/.codex/generated_images/01a00ab7-53c2-7fa2-90fc-8ce8f20bf7a8/exec-1008a8f4-3a58-40e9-baab-39612f06aa56.png`。

使用内置 ImageGen，每枚独立 background-extraction 编辑，`transparent_background: true`。共同提示：指定图谱行列及主体；仅保留该枚花窗双线外框、原有器物/枝叶/凤鸟与淡橄榄金配色；去除纸底、外部标题、标签和邻图；方形居中并留边，不新增文字、阴影、3D或装饰。

这是生成式透明分离，并非像素无损剪裁：少量线条/小细节和淡金填色比总图更浓。主体、十二枚对应关系与系列形制保留。最终实际输出均1254平方（工具没有按提示输出1024）；保留原始 alpha。仅用 Sharp 机械缩放/转 WebP，不用算法重新绘制/抠图。原图留白不一致通过前端 `artScale` 统一光学尺寸，原文件未重绘。

生成结果映射（目录 `C:/Users/lenovo/.codex/generated_images/`）：

| ID | 生成子目录 / 文件 |
| --- | --- |
| architecture | 01a104a8-98dd-74c1-b850-027330374a46/exec-36b45ac0-6561-4d28-b190-76d8654a8d9c.png |
| pattern | 01a104a8-98dd-74c1-b850-027330374a46/exec-a3ddc546-cb87-4fc5-ac77-bf836e261cf6.png |
| journey | 01a104a8-98dd-74c1-b850-027330374a46/exec-60a8c4bc-ef9f-47fd-ab93-7490e0ad08f9.png |
| proofreader | 01a104a8-98dd-74c1-b850-027330374a46/exec-2bf63a5a-2ae8-4c70-9ecd-5a22274b4adf.png |
| heritage | 01a104a8-98dd-74c1-b850-027330374a46/exec-0b375a1d-defe-49f6-b6c0-16669b31686b.png |
| bronze | 01a104a8-f2c4-7f60-ab74-c204c59c911d/exec-45c042d8-5f47-45ce-846f-a685a3080798.png |
| inscription | 01a104a8-f2c4-7f60-ab74-c204c59c911d/exec-91066e57-936f-4447-96d1-0aaf98f3f33c.png |
| artifact | 01a104a8-f2c4-7f60-ab74-c204c59c911d/exec-0771dca2-b24c-4b3d-b81b-622789d53de0.png |
| collaborator | 01a104a8-f2c4-7f60-ab74-c204c59c911d/exec-a5cee83b-4d01-4d1e-931f-6d6660674cef.png |
| fieldnotes | 01a104a9-5331-7941-99df-15f65164cd68/exec-74cbba17-b0a0-44f7-8762-a4fe9b7a1c54.png |
| artisan | 01a104a9-5331-7941-99df-15f65164cd68/exec-9c0b1ba6-a0ac-4a72-9846-66e35bc01a03.png |
| lamplight | 01a104a9-5331-7941-99df-15f65164cd68/exec-87ad4416-8533-4869-8a2a-748c8e119d28.png |

## 验收与续接

- `node tools/test-badge-catalog.js`：33项通过。
- 构建检查：158文件、103JS、5个inline script、8个sticky modal header通过。
- 原导航转场18项、页面转场18项、奖励安全21项通过，`git diff --check`通过。
- 浏览器记录：`D:/OneDrive/文档/ChatGPT/楚韵链迹/output/badge-collection-20261004/`。十二枚详情逐一核对；320/390/769/1440 CSS宽度无横向溢出，全部图样成功加载；窄屏详情可滚动；关闭/Escape返回触发按钮；五页导航仍只有一组。
- 首次测试在原启动层未消失时点击没有展开；不算成功。等待其退出后再验收，没有为了测试删除启动层或改加载流程。
- 没有测试真实登录、审核、发章、后台写入、真实设备Safari、系统级字体放大或完整屏幕阅读器。浏览器沿用应用已有匿名连接，不产生测试投稿或发章操作；不声称所有后台请求已被拦截。
- 默认本地预览：`http://127.0.0.1:4193/?view=profile&preview=badge-collection-v1`，使用现有 `output/integration-20261001/preview.cjs`（根目录指向本整合工作树）。
- 当前仍是本地未提交增量。后续接线先读本文件，不要把“已设计条件”误认成“已上线发章”。
