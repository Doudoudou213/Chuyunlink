# 个人仓库迁移：2026-10-04

## 新开发入口

- 仓库：https://github.com/Doudoudou213/Chuyunlink
- 完整项目分支：`doudoudou`；新仓库原有的 `main` 初始化提交保留，不强推或覆盖。
- 本地个人仓库：`D:/OneDrive/文档/ChatGPT/楚韵链迹/work/Chuyunlink`。
- 远程名称：`personal`。禁止向原共享仓库 `cgygygg/ChuLink-Legacy` 推送。
- 本次迁移不包含腾讯云部署，不修改密钥、生产数据或付费开关。

## 历史处理

首次推送被 GitHub 的令牌保护拦截：旧版本 `tools/server.js` 含有符合
Hugging Face 令牌格式的内容。未解除或绕过保护，也未尝试验证令牌是否有效。

使用 git-filter-repo 2.47.0 在独立副本清理该历史字符串，保留 161 条开发提交的
作者和演进关系；旧工作树及其原始历史保持不变。清理会改变部分提交编号，
旧文档中编号对应的新编号见 `HISTORY_MIGRATION_COMMIT_MAP_20261004.txt`。

清理后扫描 HEAD 可达的 2,229 个 Git 对象，未再发现该格式的令牌。
这只证明本次已识别的令牌已移除，不代表对所有可能的秘密做了全面认证。
当前文件树清理前后均为 `22aafca4aa3ffc734150ac8ff8f4f102ca9d7c07`，
即当前版本源文件未因历史清理而改变。其后仅追加迁移说明。

## 未提交地图工作

迁移时旧统一工作树仍有进行中的地图修改：`index.html`、部署/构建清单、
`static/map-exploration-points.js`、`static/map-route-ink.css/js`、
`tools/test-map-route-ink.js` 及相应文档。这些修改原样留在旧目录，
不混入此前已经测试的版本。完成后应审查差异、以补丁迁入这里并重新测试；
不要直接合并旧仓库历史，否则可能重新引入已清理的令牌。

## 验证方法

业务修复 checkpoint 原编号 `5e9f1a9`，迁移说明原编号 `6202df7`。
本次先确认当前源文件树不变，再验证构建与远程分支提交。
远程是否上传完成应以 `personal/doudoudou` 的实际引用与本地 HEAD 一致为准。
后续开发从本目录继续；真实云端功能仍以最近一次部署记录为准。
