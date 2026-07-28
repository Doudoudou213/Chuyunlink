# CloudBase 第一阶段：最小上传试验

本阶段只验证：

1. Web 测试用户完成匿名登录。
2. 图片写入 CloudBase 云存储并取得 `fileID`。
3. `submissions` 集合新增一条 `status: pending` 的记录。
4. 位置信息以 `GeoPoint` 写入 `location` 字段。

暂时不做 AI、自动发帖、管理员审核和评论。

当前测试环境：

```text
环境 ID：chulink-legacy-d8god1687a5d60743
地域：上海（ap-shanghai）
```

## 控制台只需完成 4 项准备

### 1. 创建 CloudBase 环境

进入 CloudBase 控制台，创建一个测试环境。记录：

- 完整环境 ID，例如 `cloud1-xxxx`
- 环境地域，例如上海 `ap-shanghai`

不要把 `SecretId` 或 `SecretKey` 填进网页。

### 2. 创建文档型数据库集合

在“文档型数据库”中创建集合：

```text
submissions
```

本试验使用 `db.collection()`，因此不要误建成 MySQL 表。

初次试验可将集合权限设为“仅创建者可读写”。试验成功后再按正式方案收紧规则。

### 3. 启用匿名登录

进入：

```text
身份认证 → 登录方式 → 匿名登录
```

启用匿名登录。匿名登录仅用于这一阶段的 Web 测试，正式微信小程序会换成微信可信身份。

### 4. 添加 Web 安全来源

进入：

```text
环境配置 → 安全配置 → 安全来源
```

加入本地测试来源：

```text
http://localhost:3000
```

如控制台只要求主机名，则按界面提示填写 `localhost`。配置通常需要数分钟生效。

## 启动与验证

在项目根目录运行：

```powershell
node .\tools\server.js
```

浏览器打开：

```text
http://localhost:3000/cloudbase-demo
```

填写环境 ID，选择图片，点击“上传并创建待审记录”。

成功后，在控制台核对：

1. 云存储中出现 `submissions/{uid}/...` 图片。
2. `submissions` 集合出现一条记录。
3. 记录包含 `imageFileID`、`location`、`status: pending`。

## 最小人工审核闭环

上传成功后，先用控制台模拟管理员：

1. 打开文档型数据库的 `submissions` 集合。
2. 找到刚创建的文档。
3. 把 `status` 从 `pending` 修改为 `approved`。
4. 回到测试页，点击“查询审核通过记录”。

测试页只会查询 `status: approved` 的记录。这个步骤跑通后，再开发管理员身份和审核云函数。

## 常见错误

- `CORS` / 非法来源：检查安全来源，等待配置生效。
- 匿名登录失败：检查“匿名登录”是否启用。
- `PERMISSION_DENIED`：检查数据库和云存储权限。
- 集合不存在：确认名称严格为小写 `submissions`。
- 上传成功但数据库失败：测试页会尝试删除刚上传的孤立文件。
