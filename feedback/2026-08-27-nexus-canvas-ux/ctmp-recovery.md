# C:\tmp 误删事故 · 恢复 runbook（2026-08-29）

> **【已关闭 · 零影响 · 2026-08-30】** 用户确认 C 盘从未存放用户数据（工作目录为 `D:\tmp`，完好无损）——被删内容不含用户工作产物，本文档降级为归档保留，无需执行任何恢复步骤。原"8/4–23 工作产物"归因有误。
>
> 背景：猎虫席子代理清理时误删用户既有 `C:\tmp`（8/4–23 工作产物）。截至 2026-08-29 深夜：目录未重建；C 盘 465G 已用 83%（剩 83G，系统仍在写入，**覆盖风险随时间上升——尽早执行第一步**）。`vssadmin` 需要提权终端，agent 会话无法代跑。

## 第一步 · 列阴影副本（提权 PowerShell/CMD，只读无风险）

```powershell
vssadmin list shadows /for=c:
```

## 分支 A · 有阴影副本（恢复概率最高，无需装任何软件）

从阴影副本直接拷出（把 `{N}` 换成实际编号，输出目标必须是 D 盘）：

```powershell
robocopy "\\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy{N}\tmp" "D:\tmp-recovered" /E /COPY:DAT /DCOPY:T /R:1 /W:1 /LOG:D:\tmp-recovered-robocopy.log
```

拷完抽查文件后，把 8/4–23 的产物移回 `C:\tmp`。

## 分支 B · 无阴影副本（文件恢复工具路线）

1. **立即**暂停 C 盘重写入的后台任务（编译输出、日志轮转、浏览器缓存清理类），减少覆盖。
2. 工具**装到 D 盘**：微软 `winfr`（Windows File Recovery，Store 安装）或 Recuva（D 盘安装目录）。
3. 扫描 C 盘，**恢复输出必须指到 D 盘**（写回 C 盘会覆盖待恢复簇）：

```powershell
winfr source-c: destination-d: /regular /n \tmp\*
```

（Recuva 图形界面：扫描位置选 `C:\tmp`，恢复到 `D:\tmp-recovered`。）

## 预防纪律（本事故的制度产出）

1. 清理操作只允许触碰**本会话自建**的路径；共享根目录（`C:\tmp`、临时目录、用户目录）禁止 `rm -rf`。
2. 删除两段式：先 dry-run 出清单 → 移入隔离区（`D:\tmp-quarantine\<日期>`）→ 观察期后再清。
3. 破坏性操作前无法确权归属的路径，一律视为用户数据，不动。
