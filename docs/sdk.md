# SDK：`sdk/wire`（给请求方的免凭据线上格式包）

`@nelsonlongxiang/dsh-open-a2a-net/sdk/wire` 是给 A2A 请求方用的纯格式库——工作台市场第一个用户（docs/design/superagent-root-team.md §R9）。它把请求方要发和要读的线上格式做成一个入口，请求方不再手写这些格式。

```js
import { formatDispatch, parseDispatch, parseReceipt, taskKind } from '@nelsonlongxiang/dsh-open-a2a-net/sdk/wire'
```

## 它是什么、不是什么

- **是**：派工行、回执、名册这些**线上格式**的同一份实现——宿主自己用的就是这些函数（src/dispatch.ts、src/receipt.ts），不是平行副本。
- **不是**：网络客户端。不做请求、不落盘、不带任何节点凭据；`node:fs`/`node:crypto` 都不 import。挂在宿主进程里的部分（凭据、户口、路由）不属于这个包。
- **不会有的**：属主侧的 `sdk/owner` 是另一件事（以后做），永远不会给市场。

## 派工行（指名席位 / 打回重做）

请求正文第一行是派工行，宿主只在**签名来信、画布上钉住公钥、名片声明对应能力**时才信它（`directedSeats` / `reworkReturns`）：

```js
// 指名一个席位
const request = formatDispatch({ for: 'seat-11112222' }, '把上一季的对账表做出来')
// => '[A2A dispatch] {"for":"seat-11112222"}\n把上一季的对账表做出来'

// 打回一次交付（of 是那次交付的任务号）
const rework = formatDispatch({ rework: { of: 'wbe-1.d26.q7.a1' } }, '第三列算错了')
```

- `formatDispatch` 拒绝空行（for、rework 都没有）、超过 128 字的 `for` 或 `rework.of`——返回 `undefined`，此时就发普通文本。
- `parseDispatch` 读回同样的行；宿主存储的请求带着网络自己的投递头（`[A2A direct] … sent:` 加空行），它会先剥掉这一个头。

## 回执

`parseReceipt` / `formatReceipt` 与信封类型（`by`（含 `seatId`）、`artifacts`、`question`、progress、tickets）——同 src/receipt.ts。请求方按任务号分类收到的回执：

```js
taskKind('ack-direct-000000000001')   // { kind: 'ack', task: 'direct-000000000001' } —— 已收（任务号里的 '-' 不碍事：按前缀和最后一段读）
taskKind('progress-direct-000000000001-3') // { kind: 'progress', task: 'direct-000000000001', n: 3 }
taskKind('attention-direct-000000000001-q1a2b3') // { kind: 'attention', task: 'direct-000000000001', questionId: 'q1a2b3' }
taskKind('receipt-wbe-304f27617fe74277.d26.a1') // { kind: 'receipt', task: 'wbe-304f27617fe74277.d26.a1' }
taskKind('roster-ab12cd34-1770000000000') // { kind: 'roster', host: 'ab12cd34' } —— 名册，不是回执
```

- `taskHoldsRow(id)`：这个任务号上的回执**持行不结清**吗（ack / attention / progress 持行；`receipt-<task>` 结清；名册不算）。手里已有信封时用回执模块自己的 `holdsRow(envelope)`（同一问题、按信封判）。
- `receiptTaskId(task, disposition, …)`：回执模块自己的构造器——`'result'` 得 `receipt-<task>`、`'acknowledged'` 得 `ack-<task>`、progress/attention 带各自末段。

## 名册

`parseRoster(text)` 读 `[A2A roster] <fp8> <时刻>` 加一行 JSON：`{ host, at, seats }`，席位带 `seatId`。头与体的 host 不一致（体的 host 不以头的 fp8 开头）返回 `undefined`——这行不被信任。

## 能力

`CAPABILITIES` 列出四个已定义能力（`progressReceipts`、`teamRoster`、`directedSeats`、`reworkReturns`）；`declares(card, name)` 只在名片 `capabilities[name]` **恰为 true** 时为真（字符串 `"true"` 不算）。