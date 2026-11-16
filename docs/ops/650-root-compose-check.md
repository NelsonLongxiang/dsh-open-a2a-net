# #650 多选创建 root 后续实施：前置框选择切片（未完成创建流程）

## 原义务和本片范围

原[650 S3](https://github.com/NelsonLongxiang/dsh-open-a2a-net/issues/650)要求多选至少两团队框，经建队/G创建root、选择本机总工、将所选团队逐一加入子团队。原660@cf0/d01的核心实现已合；[独立运维核对](https://github.com/NelsonLongxiang/dsh-open-a2a-net/issues/650#issuecomment-6917307801)只接受核心交付，多选root与截图仍NEEDS_MATERIAL，不得用原开发“需要时另开项”自行豁免。此分支fix/650-root-board-compose准确起点为next/0.8@f859168f473783931275884681df258d8d412341，不stack未审的708测试夹具链。

本片**仅完成呈现层团队框多选前置**：[独立选择模块](<D:/workspace/review-ws/nexus-stage/src/planning-frame-selection.ts>)维护按团队名的临时选择集合；[画布窄接点](<D:/workspace/review-ws/nexus-stage/src/planning-view.ts>)支持Shift-click加选/切换、普通点击替换、Shift+Space键盘切换及Escape清除。选择回读names为detached数组；轮询后选择重绘，框删除后清理，不将选择继承给同名后来新队；会话鼠标/键盘选择清掉框选择，toolbar点击不清。复用原selected样式并加aria-pressed；不改CSS、会员、布局文档、撤销历史或向网络发送动作。拖框仍只移动那个框、不带成员，也不承诺一次拖动移动所有选中框。

## 已运行的工程证据（不是正式CLI spec-run/OPS）

- [新增DOM回归](<D:/workspace/review-ws/nexus-stage/tests/planning-frame-selection.spec.ts>)用生产view实际DOM pointer/key事件。旧源码四新用例0pass/4fail；首次接线后4/0。补键盘卡片切换/删除同名边界，接线前1pass/1fail/4未选，准确命中混合选择未清；修后完整6/0/0。提交前补鼠标/键盘由已选会话转选框的呈现反例，实际0pass/2fail/6未选（模型已清、卡片仍高亮）；清卡选择时沿原renderNodes同步绘制，之后最终8例均随完整套件通过。原assert不改，未通过加timeout或skip修绿。
- 初次八文件相关回归98/0/0；六例时完整现有Nexus套件420/0/0的原件保留；最终含8新例的完整Nexus套件422/0/0（46文件），outerremaining=[]/status0。现有拖框不动成员、session selection、rollback、undo、rootchips、slots、菜单和M1上限原测试均保留，新增8项构成最终新增分母。未据一轮通过宣长期/所有浏览器/生产交互通过。
- 最终前端TypeScript --noEmit与Vite生产构建exit0；随后一次同source重建，三个产物size/SHA/bytes逐项相同，非取某次通过拼凑。生成物只在现有[构建目录](<D:/workspace/review-ws/assets/nexusDist/index.html>)更新。构建输出目录先核真实路径且非link，未启动第二服务器、未刷新或修改生产GUI。
- 复用此前已核32b隔离runner的原实现，仅因任务目录位置改repo相对锚；[任务入口](<D:/workspace/review-ws/tmp/issue650-compose/verify-temp-clean.frozen.mjs>)不进入产品。隔离TMP/TEMP/DSH_HOME/yglhome，前端测试使用已安装Vitest2.1.9/Vite5.4.21，不运行npmci/pnpmbootstrap。脚本/日志/原JSON均在同任务tmp，不写系统temp为正式证据。

## 尚未实现、不可提前关闭的面

1. 将框多选接到G/建队的“组成root团队”对话框，目前仍是旧会话建队入口，不能选择框就当完成root创建。
2. 总工picker必须限于可用本机session并沿现有受控teams接口注册；remote child ref须保留owner指纹。
3. root创建→set-root→router注册→逐一add-team的严格确认、部分成功可见和恢复；不得用乐观createdhint授权自动删同名服务端队，不把unknown或失败说成完整创建。
4. root两个children的真实构建页面截图、明暗/键盘及原Nexus/verifycore/准确非作者评审；没有截图或.157/生产激活证明。

因此**650仍OPEN，整体多选创建功能NOT_IMPLEMENTED，截图NOT_CAPTURED，当前切片未独立复审/未推送/未合并**。原verify:nexus第一步会npmci，完整verifycore也包含它；没有安装授权，不执行/不以现有工具的test+build替称全链通过。此片不是新的产品协议或冻结验证器判据。

## 与708及运行权限隔离

原fix/receipt-delivery-integration-f859仍钉32b04898163255e3f5df4512d5d8e2a3f850c16f；其完整默认2638pass/7fail/8skip和所有旧FAIL/独立复审队列状态保留，不用本前端422PASS替换。原admission三超时本轮只做有界原源码trace观察（轻载3pass/5未选，不是根因证明），诊断loader首轮parsefailure原件保留；未对该源码改动/重跑全量。

不写deepseek-harness检出或安装产物，不操作真实ledger/身份/ACL/队伍成员/跨机presence或生产；不装依赖、不换评审席绕队列、不代属主合并/发布/部署。
