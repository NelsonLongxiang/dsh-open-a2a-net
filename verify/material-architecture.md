# 架构图结构与锚点核验 v1

适用对象：SOURCE 5736a4a 的两页 A2A 架构图及其 anchors manifest。只验证结构与精确源码锚点，不裁决架构方向、不证明运行宿主已部署。

A1 全图全部数字源码锚点必须被清单覆盖且精确命中，anchors 必须等于 50。
A2 所有被引用源码文件摘要必须匹配，sources 必须等于 16。
A3 XML、边端点、页面边界、纯黑文字、短锚漏扫、精确源码串与源码摘要核验的 errors 必须等于 0。

采集源：node scripts/verify-architecture.mjs --snapshot <sqlite>。architecture_facts(name,value,detail) 保存机械结果。
负例：删清单锚、:NN 短锚、目标行偏移、范围终点越界、源码摘要漂移、预期串错误、XML损坏、非黑文字、边端点缺失、页面越界及旧基线必须拒绝。
语义边界由源码/文档审阅：不得将 WIP/未交付/无部署证据画成现网能力。该边界不冒充机器已独立评审。
