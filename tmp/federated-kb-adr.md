# federated-kb v1 架构决策（ADR）

## 上下文
ygl-trees 每工作区一棵 SQLite（独立 YGL_HOME、单写者锁），实体表（skills/projects/queries/sources/evidence/claims/kb_notes）均 UUID TEXT 主键，kb_notes 等已带 updated + content_hash(sha1 幂等) 列；全 schema 无 workspace_id 列。现有互通仅单向导出（db export / sync pg）与 db workspace list 枚举。v2-roadmap 要求联邦知识库（跨工作区引用与共享）。

## 决策
1. **联邦第一步 = 跨工作区只读引用**（分片A 结论 + 编排者仓库核验）：复合 ID `workspace-id:uuid` 复用现有 TEXT 主键/边列，零 schema 迁移；拒绝双向同步（违背 SQLite 唯一事实源；CRDT 过度工程）。
2. **摘要卡片缓存**：对端实体在本库只缓存只读摘要卡片（title/abstract/hash/updated），带 stale 标注；不建跨库外键，悬空边合法（解析不到时显示占位）。
3. **冲突语义预留**：同笔记双改（未来若引入写同步）用 LWW-by-updated；id/content_hash/updated 三列已是同步所需全部原料，events.level 遥测级可作同步游标。
4. **信任边界**：联邦检索结果必须携带来源工作区标注（origin workspace-id）；第三方引用默认不可信、不进入本库 claim 图（只进缓存层）。
5. **快照冻结护栏**（分片B 先行实践印证）：跨信任域 link rot 是联邦最大风险（被引方删除/改写后本方 claims 失锚）；对外引用必须引用时快照冻结——evidence quote 语义已天然具备，联邦化时升格为对外引用强制行为。
6. **验收闸**（已登记 node cond federation_proof）：两个独立工作区完成跨库只读引用演示（复合 ID 解析+来源标注）且联邦检索演示对等广播查询成功。

## 后果
- 正：零迁移起步；只读无冲突面；缓存层可日后叠加联邦检索与写同步。
- 负：复合 ID 解析层 + 摘要缓存表是新触点（需走九触点流程）；悬空边要求 UI 有 stale 占位叙事。
- 先行实践对照（分片B，2026-10-17 已回收）：Obsidian/Logseq 无原生联邦（最痛）；Zotero 群组库=中心同步+稳定 URI（小团队最省心）；MediaWiki interwiki 前缀命名空间=零中心外部引用正解；共同点=稳定 ID+显式命名空间而非文件路径。分片B 的 top-3（引用不复制/中心镜像联邦/分片所有权）与本 ADR 决策 1 独立收敛。
