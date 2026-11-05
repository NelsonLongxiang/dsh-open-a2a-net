# 浏览器 bundle 路径可复现性（dispatch-144-buildpath）

低档，基线 master 8d6f0f8。仅构建配置与回归测试；未改发布版本、未部署生产。

## #144 实际结果

同基线、.156 Windows/Node24.12.0，临时去掉两处精确skip后，真实CLI重试用例仍同时得到3221226505（0xC0000409），不是预期exit1。已原样恢复skip且两文件diff为空，证据tmp/gh144-recheck-8d6f0f8.json与issue144 comment6653020944。不得拿弱最小探针的绿当作原路径自愈；不提交unskip PR。

## 路径来源及修复

- CSS虚拟ID原为NUL+dsh-css+绝对源文件路径，进入JS模块debug region注释，改变sourcemap列映射。虚拟ID现在使用仓库相对路径并统一正斜杠；load/watch再还原本机绝对路径，只用于I/O。
- lightningcss的filename也使用该相对身份，类名hash与源码路径和CSS内容保持同一稳定输入。
- dependency sourcemap源路径去掉本机store/链接根，仅保留node_modules中最后一层包相对身份；保留原sourcesContent与mappings，不删除sourcemap。
- Rolldown默认debug region注释还会记录依赖realpath相对checkout的深度。仅虚拟ID修复不够：两处真实同盘不同深度导出第一次全包对比仍1/208不同，差在clsx region中的../../../。改attachDebugInfo=none，保留规范化sourcemap供调试。不使用打包后字符串改写。

## 回归证据

新增client-build-reproducibility.spec.ts调用真实tsdown，在同盘不同深度、带空格目录分别构建；仅复制浏览器输入、共享只读工具链junction（无clone/worktree），逐字节比JS/map并查无机器根，finally先断开junction再删测试根。旧配置临时回退，新用例立即FAIL于client.js differs by build root；已恢复固定配置。没有新增skip或全局并发/timeout改动。

完整包对比使用git archive 8d6f0f8两次干净导出+相同修订config，各自tsc/tsdown/copy-skill/npm pack，比较包中每项size/SHA256：最终208/208相同。不是比较可能受元数据影响的tgz压缩字节。保留tmp/buildpath-comparison/windows-file-hashes.json及两侧包/清单。

Windows最终关键字节：
- lib/client.js 26283 bytes，SHA256 1c7521ef5db67eb2a2b9a1a4e572f5662d8187cc9d4572cc54202eae481d6c98
- lib/client.js.map 23852 bytes，SHA256 a8d6cf306b3b1ff239001ecad46cb1bd80774be4135074967dd22915e3273c4a

最终默认pnpm verify真实exit0：root1434passed/6原skip，layout4，nexus326，tracked dist零diff；typecheck/docs/build均在同链。工程自测不是正式RC spec-run结论。

跨Windows/macOS最终208/208仍须评审席对同一SHA复打；本机两个目录相同不等于跨系统已证。所给第二issue链接为空，暂按任务说明提PR，不猜issue编号。PR提供hash清单供独立对账。
