# CloudBase 正式云端闭环

## 今日上线范围

- CloudBase 用户身份与 `user_profiles` 个人资料。
- 云端积分、上传次数、审核通过次数。
- 正式投稿直接上传云存储并写入 `submissions`。
- 用户个人中心读取自己的全部投稿状态。
- 发现页读取其他用户已审核通过的投稿。
- 稳定账号登录管理员页面。
- 管理员审核通过后自动发放积分并写入 `moderation_logs`。

AI 质检、评论和同类资源归类保留为后续阶段，不在本次上线中伪造结果。

## 新增数据库集合

```text
user_profiles
```

已有：

```text
submissions
moderation_logs
```

三个集合均建议切换为自定义安全规则，禁止客户端直接写入：

```json
{
  "read": false,
  "write": false
}
```

所有合法读写均通过 `appCore` 或 `adminSubmissions` 云函数完成。

## 云函数权限控制

在环境级云函数权限中合并：

```json
{
  "*": {
    "invoke": "auth != null && auth.loginType != 'ANONYMOUS'"
  },
  "appCore": {
    "invoke": "auth != null"
  },
  "adminSubmissions": {
    "invoke": "auth != null"
  }
}
```

`appCore` 允许游客身份调用，以支持普通用户无需注册即可体验。管理员权限仍由
`adminSubmissions` 内部的 `ADMIN_UIDS` 白名单控制。

## 云存储规则

投稿通过客户端直接上传，因此允许已登录用户写入自己创建的文件；文件读取由云函数
生成临时链接：

```json
{
  "read": false,
  "write": "auth != null && resource.openid == auth.uid"
}
```

如果当前 CloudBase 规则中的 Web 上传者字段表现为 `resource.openid`，上述规则可直接使用。
部署后只需要在最终统一验收中验证一次上传。

## 稳定管理员账号

1. 在“身份认证 → 登录方式”开启邮箱密码或用户名密码登录。
2. 在 CloudBase 用户管理中创建一个正式管理员账号。
3. 打开云端 `admin.html`，用正式账号登录。
4. 页面会显示该账号稳定 UID。
5. 将稳定 UID 写入 `adminSubmissions` 的 `ADMIN_UIDS`，多个 UID 用英文逗号分隔。
6. 验证成功后，从 `ADMIN_UIDS` 删除旧的匿名 UID。

## 前端托管

静态网站部署包只包含：

```text
index.html
admin.html
hubei_boundary.geojson
static/
```

可以在“静态网站托管 → 新建部署”中上传 `deploy/chulink-hosting.zip`。

访问路径：

```text
/index.html
/admin.html
```

CloudBase 自动提供 HTTPS，浏览器定位功能可在 HTTPS 下正常请求授权。
