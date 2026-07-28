# CloudBase 第二阶段：管理员审核闭环

本阶段实现：

1. 管理员从云函数读取 `pending` 投稿。
2. 管理员执行“通过 / 拒绝 / 要求修改”。
3. 云函数从调用上下文取得可信 UID，不接受前端传入管理员身份。
4. 云函数校验 `ADMIN_UIDS` 白名单后才修改投稿。
5. 每次审核同时写入 `moderation_logs`，保留审核轨迹。
6. 前台仍然只查询 `status: approved` 的投稿。

## 一、控制台准备

在文档型数据库中新建集合：

```text
moderation_logs
```

`submissions` 集合已经存在，不要重复创建。

## 二、部署普通云函数

创建普通事件云函数：

```text
adminSubmissions
```

建议运行环境：

```text
Nodejs 18.15
```

如果创建页面只显示模板，选择 `Node.js Hello World` 即可；创建后再上传本项目的
ZIP 包覆盖示例代码。

将 `cloudfunctions/adminSubmissions` 目录里的 `index.js` 和 `package.json`
放到函数代码根目录，然后点击“保存并安装依赖”。

也可以稍后安装 CloudBase CLI，项目根目录已经包含 `cloudbaserc.json`。

## 三、配置临时测试管理员

进入：

```text
云函数 → adminSubmissions → 函数配置 → 环境变量
```

新增：

```text
ADMIN_UIDS=-wua1TdYRifNP_fizXVClg
```

多个管理员 UID 用英文逗号分隔。这个 UID 来自当前匿名测试账号，只用于跑通试验。
清理浏览器数据会生成新 UID，到时应更新此变量。正式上线时改为邮箱或微信登录账号。

不需要配置 `SecretId` 或 `SecretKey`。

## 四、配置云函数调用权限

在“云函数 → 权限控制”中，确保 `adminSubmissions` 可由当前已登录的测试用户调用。
CloudBase 要求规则中必须包含顶层 `*`，可使用：

```json
{
  "*": {
    "invoke": "auth.loginType != 'ANONYMOUS' && auth != null"
  },
  "adminSubmissions": {
    "invoke": "auth != null"
  }
}
```

`*` 让其他未单独配置的云函数默认排除匿名用户；`adminSubmissions` 为本轮试验
允许已登录的匿名用户调用。允许调用不等于允许审核：云函数内部还会将调用者
UID 与 `ADMIN_UIDS` 比较，非管理员只能得到 `FORBIDDEN`。

如果环境已经有权限 JSON，请保留原来的 `*` 和其他函数项，只合并
`adminSubmissions`，不要不加检查地覆盖整份配置。

## 五、验证

启动本地服务：

```powershell
node .\tools\server.js
```

打开：

```text
http://localhost:3000/cloudbase-admin-demo
```

依次执行：

1. 点击“连接并检查管理员身份”。
2. 确认页面显示“管理员：是”。
3. 在待审投稿上点击“通过”。
4. 打开上传试验页，点击“查询审核通过记录”。
5. 在数据库确认投稿为 `approved`。
6. 在 `moderation_logs` 确认产生一条 `pending → approved` 日志。

## 安全边界

- 前端没有数据库审核写权限。
- 管理员 UID 不写在网页代码中，只放在云函数环境变量。
- 审核云函数只允许 `pending` 状态被处理，重复点击会返回冲突。
- 拒绝或要求修改必须填写审核说明。
- 当前匿名身份仅供联调；正式发布前必须替换为稳定的可信登录方式。
