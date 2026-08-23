# 楚韵链迹微信小程序上线手册

更新日期：2026-08-17

## 当前状态

第一阶段工程骨架已经建立，微信登录云函数代码已经部署，但尚未配置密钥、开启 HTTPS 访问或提交微信审核。

- 小程序 AppID：已写入 `project.config.json`；
- CloudBase 环境：继续使用现有 `chulink-legacy-d8god1687a5d60743`；
- 用户端：已建立“探楚、链迹、投稿、我的”四个入口和资源详情；
- 云端：复用 `appCore`，`miniProgramAuth` 已单独部署，等待环境变量与 HTTPS 访问配置；
- 安全：AppSecret 与自定义登录私钥均未写入仓库；
- 生产数据：没有迁移、覆盖或删除；
- 网页与管理员后台：保持原样。

未配置正式微信登录前，小程序只使用匿名 CloudBase 会话预览公开资源。投稿、积分、兑换码和个人记录要求正式微信身份，不会写入匿名账号。

## 本地打开

1. 安装微信开发者工具；
2. 导入仓库根目录，工具会读取 `project.config.json`；
3. 在 `miniprogram` 目录安装依赖：`npm install`；
4. 在微信开发者工具选择“工具 → 构建 npm”；
5. 编译并检查四个主入口。

## 正式微信登录尚需完成

在 CloudBase 控制台开启“自定义登录”，下载私钥。密钥不能提交到 GitHub。

为 `miniProgramAuth` 云函数配置以下环境变量：

- `WX_APPID`：小程序 AppID；
- `WX_SECRET`：小程序 AppSecret；
- `TCB_ENV`：CloudBase 环境 ID；
- `TCB_CUSTOM_PRIVATE_KEY_ID`：自定义登录私钥标识；
- `TCB_CUSTOM_PRIVATE_KEY`：自定义登录 RSA 私钥。

随后部署 `miniProgramAuth`，开启 HTTPS 访问，并将公开的 HTTPS 地址写入 `miniprogram/config/index.js` 的 `loginTicketUrl`。还需在微信公众平台配置对应的 request 合法域名。

每次重新生成 CloudBase 自定义登录私钥，旧私钥会失效，因此应只在必要时轮换并重新配置云函数。

## 下一阶段

1. 部署并真机验证微信登录；
2. 设计老邮箱账号与微信身份绑定，保证旧积分、投稿和兑换记录不丢失；
3. 完善投稿定位、上传进度、失败重试和审核消息；
4. 迁移评论、举报、地图路线和兑换凭证；
5. 完成隐私指引、内容安全和上线审核清单。

管理员后台继续使用网页，不迁移到小程序。
