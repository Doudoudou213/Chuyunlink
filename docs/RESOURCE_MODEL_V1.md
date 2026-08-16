# 统一资源模型 v1

## 阶段边界

第一阶段建立 `resources` 模型、管理员种子预览/导入动作和 `appCore` 只读接口；第二阶段让用户端以兼容方式读取统一资源。

- 不删除、不迁移、不覆盖 `submissions` 中的用户投稿。
- 不改变评论、点赞、路线、积分、审核和兑换接口。
- 现有图片、长文、路线步骤和交互继续保留，云端资源只接管标题、摘要、地区、坐标、标签、能力和关联 ID 等公共元数据。
- 云端读取失败时继续使用页面内的兼容数据，不让发现页、地图和路线变成空白。

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

```json
{ "action": "searchResources", "resourceId": "article-yellow-crane-tower", "limit": 4 }
```

`searchResources` 也支持 `query`、`type`、`city` 和 `tags`。排序只使用已确认的 `relatedResourceIds`、类型、地区、分类、标签和关键词，不调用模型。返回的 `relationReasons` 用于向用户解释推荐来源，`deterministic: true` 表明同一批数据和条件会得到稳定结果。

用户端启动时会调用 `getResources`，通过 `legacyAliases` 将资源合并到现有地标、发现内容和路线对象。完整资源列表同时保存在 `window.chulinkResources`，同步状态保存在 `window.chulinkResourceSync`，供后续分类检索和故障排查使用。

当前仍是“兼容接管”而不是一次性删除旧数据：只有云端存在且能匹配旧别名的字段会被更新，成熟的科普正文、图片、路线步骤和服务入口不会被覆盖。

发现详情中的“顺着线索看”直接使用这一检索结果，最多显示 4 条；点击后沿旧别名进入现有内容详情、地图点位或路线，不增加新的顶层入口。云端检索失败或没有可靠结果时，该区域自动隐藏。

## 投稿与资源绑定

审核通过的投稿可以保存 `resourceId`，但系统只生成候选，不会自动写入绑定：

- 候选依据投稿文字、地区和投稿坐标到资源坐标的距离进行排序；
- 管理员在审核通过时明确选择，或在“投稿关联”工作台为历史投稿补选；
- 服务端再次验证目标资源存在且为 `published`，然后才在审核事务中保存；
- 每次绑定、改绑或取消绑定都会写入 `moderation_logs`；
- 公开投稿只暴露资源 ID 和绑定状态，不暴露审核人等后台信息。

绑定完成后，公开投稿复用原有“顺着线索看”，不增加用户端操作步骤。

