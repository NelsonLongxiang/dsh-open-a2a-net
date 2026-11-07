# #343 登记可移植性独立修复

范围裁定direct-de3f250165a3、验收校准direct-c788e05d319a。基线一期20ddb80；独立修复分支，不能把登记hash修复等同项目meta PASS。

## 修复前与证据锚

106项工作树为陈旧CRLF、HEAD/index均LF，registered hash误锚工作树。逐项原始工作树hash、HEAD对象hash、CRLF→LF hash与普通git diff/ignore-cr diff均空，见343-portability-inventory.json，证据锚commit7e1603aaaa747b1feee91fc2b719e3e47b53b2c6。既有.gitattributes已全局text=auto eol=lf，106项全部被覆盖，不重复加属性，不造106个git文本变更。

冻结引用检查范围：本地正式validator工作区材料/spec/report等JSON/文本、27个历史archive各成员及tracked verify文本（排除正在改的meta）。未找到这106个CRLF hash的冻结引用，因此本批排除0项；不声称扫描了未知远端库。全部27个archive修复前SHA256记录在inventory，修复后原字节hash全部不变，旧材料/spec/run文件不改。

## 操作与审计

HEAD已LF；先窄git restore，再checkout-index --force均未使陈旧工作树转LF，失败步骤未登记。改为逐项git show HEAD:path读取对象并写精确字节，全部工作树hash等于记录HEAD；无内容差异，但git stat缓存仍曾报M，窄git add具体106路径刷新缓存后cached diff为空、status干净，未提交任何产品/测试文字改动。不是git add -A，不动他人stage。

随后逐项执行官方meta-tooling --reregister，各reason指向证据锚7e1603a、actor=dsh/f49961b0，保留原244项审计条目与链，新增106条，不auto-rehash，不放宽hash。修复提交6bf9492d440180284b13beb78c9214a3ee4f7222。

## 修复后工程核对

- Windows工作树与6bf9492精确git archive新导出：106/106 hash与registered hash相同，逐文件见343-portability-after.json；其status为空。该archive是登记工程核对，不是受限的PROBE-ONLY checker实验，不混probe run/report/archive。
- 普通产品文字diff=0；差异只有库存证据、meta登记及本说明。不改.gitattributes，因为规则已满足。
- meta-tooling check：243条、0 drift；audit：350条审计链、0断链/未来时间；历史27archive不变。
- 项目根直接本地pin0.120 CLI verify meta：**rc1/FAIL，仅R3=scripts/verify-recursive.mjs**。R1/R2/R5a/R6通过，真实输出见343-portability-project-meta.json。二期未批，不注册成tooling隐藏、不移走脚本，不--meta-repo/--no-meta求绿。

上述是登记字节/工程证据，不是v3业务spec的验证结论。未正式prepare/冻结v3，旧v2继续门。独立修复PR需原评审核定后再集成到一期分支，随后按direct-4f512c9287ae整体新导probe并标旧20ddb80/新来源SHA/原因；旧probe整树留tmp封存，任何checker probe产物不用于发布/PR验收或准入。
