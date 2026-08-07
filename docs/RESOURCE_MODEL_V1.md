# 统一资源模型 v1

## 本阶段边界

本阶段只新增 `resources` 模型、管理员种子预览/导入动作和 `appCore` 只读接口。

- 不修改 `index.html`、`admin.html` 或现有前端数据源。
- 不删除、不迁移、不覆盖 `submissions` 中的用户投稿。
- 不改变评论、点赞、路线、积分、审核和兑换接口。
- 不自动部署，也不自动执行云端导入。

## 资源与投稿的区别

`submissions` 是用户提交的原始材料和审核记录；`resources` 是平台最终公开展示的文化对象。审核通过的投稿以后可以创建资源，也可以补充已有资源，但原投稿应继续保留以便追溯。

## 核心字段

| 字段 | 含义 |
| --- | --- |
| `id` | 稳定资源 ID，同时作为数据库文档 ID |
| `modelVersion` | 资源模型版本，当前为 1 |
| `seedVersion` | 固定资源种子版本 |
| `type` | `landmark`、`hotspot`、`activity`、`article`、`experience` 或 `route` |
| `status` | v1 种子只导入 `published` |
| `region` | 省、市、区县结构化地区信息 |
| `location` | GCJ-02 经纬度；没有真实点位时必须为 `null` |
| `categoryIds` / `tags` | 分类和检索标签 |
| `legacyAliases` | 旧页面的“类型 + ID”映射 |
| `relatedResourceIds` | 文章、地标、路线等资源之间的关系 |
| `capabilities` | 是否可评论、上图、进入路线和接受采集 |

## 历史 ID 冲突

旧页面将 `shennongjia-muyu` 同时用作地标 ID 和活动 ID。v1 保留：

- 地标资源：`shennongjia-muyu`
- 路线资源：`route-shennongjia-muyu`
- 通过 `legacyAliases.type` 区分旧的 `landmark` 和 `activity` 引用

迁移旧互动数据时必须同时使用旧类型和旧 ID，不能只按 ID 合并。

## 安全导入约定

管理员云函数提供两个动作：

- `previewResourceSeed`：只读取并报告缺失、已存在和内容差异。
- `applyResourceSeed`：需要确认口令 `IMPORT_RESOURCES_V1`，且只创建不存在的文档。

`applyResourceSeed` 遇到同名文档会跳过，不更新、不覆盖、不删除，并写入 `moderation_logs`。需要修改已有资源时，未来应建立显式版本迁移，而不是重新运行种子覆盖。

## 只读接口

`appCore` 新增：

```json
{ "action": "getResources", "type": "landmark", "limit": 50 }
```

```json
{ "action": "getResourceDetail", "resourceId": "yellow-crane-tower" }
```

当前页面尚未调用这两个接口，因此部署代码本身也不会改变现有页面行为。

