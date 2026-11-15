/**
 * docs/design/superagent-builder.md TB5: the built-in rule templates (规则模板) the team builder starts a draft from. Text
 * only — not job templates (岗位模板, #626 W4), which carry a preset, a model and a checkout.
 *
 * Distilled from teams that ran (owner 2026-11-13: not invented): the ops team on the test host (its router rule
 * `ops-doc-check`, and its members' repository split between dsh-open-a2a-net and agent-atelier), the market-trial team
 * (`market-dispatch`, `market-rework`), a root team's children (`root-dispatch`), and the member card's own line on work
 * that does not fit. The members' own intake texts of that run were not kept, so the member templates come from the
 * repository split and the card line. Lessons kept: a rule never asks a session to parse a request's header or dispatch
 * line (#627/#629: the host reads `[A2A dispatch]` and rework returns itself), and a rule says what to take, not how the
 * host routes.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/rule-templates
 */

export interface RuleTemplate {
  readonly id: string
  /** Which rule set it fills: the router's intake rules, the dispatch text, or a member's intake rules. */
  readonly scope: 'team' | 'dispatch' | 'member'
  readonly title: string
  /** Where it comes from, so the owner can see it was used before. */
  readonly source: string
  /** For `team` and `member`: rules; for `dispatch`: one text. `<…>` marks what the builder fills in with the owner. */
  readonly rules?: ReadonlyArray<{ readonly name: string; readonly text: string }>
  readonly text?: string
}

export const RULE_TEMPLATES: readonly RuleTemplate[] = [
  {
    id: 'team-repo-work', scope: 'team', title: '代码仓库团队：接这些仓库的开发与核对',
    source: 'ops 团队 ops-doc-check（测试宿主），按仓库填 repo 的写法',
    rules: [{ name: 'repo-work', text: '要求在 <仓库列表> 里改代码、修问题或核对文档与代码是否一致的请求。接单时按请求涉及的仓库填 repo：请求点名了仓库就用点名的；没点名时按所涉文件所在的仓库判断（可只读查找文件位置），确实判断不了才不填。' }],
  },
  {
    id: 'team-doc-audit', scope: 'team', title: '文档核对团队：核对对外声明',
    source: 'ops 团队 ops-doc-check（测试宿主）',
    rules: [{ name: 'doc-check', text: '以 <前缀，如 [ops]> 开头、要求核对某个仓库的一份文档（或其中一节）对外声明的请求：核实声明与代码是否一致、功能是否真的完成、文档是否需要治理。接单时按文档所在的仓库填 repo。' }],
  },
  {
    id: 'team-market', scope: 'team', title: '接工作台市场派工的团队',
    source: 'market-trial 团队 market-dispatch / market-rework（测试宿主）',
    rules: [
      { name: 'market-dispatch', text: '工作台市场派来的工作：按派工里写的要求去做；产出经市场的工具落到市场；需要人决定的先提问。' },
      { name: 'market-rework', text: '市场打回的事项：接成新工单重做，范围以打回理由为准；不要挂回已结束的原工单。（对方声明了 reworkReturns 时宿主会自动开新单，这条只给没声明的调用方用。）' },
    ],
  },
  {
    id: 'team-root-child', scope: 'team', title: '作为根团队的子团队',
    source: '子团队 root-dispatch（测试宿主，宿主为根团队自动加上）',
    rules: [{ name: 'root-dispatch', text: '根团队派来的工作：照派工里写的要求做；需要人决定的先提问；做不了就如实回报。' }],
  },
  {
    id: 'dispatch-by-repo', scope: 'dispatch', title: '按仓库派单',
    source: 'ops 团队的成员仓库分工（dsh-open-a2a-net / agent-atelier）',
    text: '工单填了 repo 时，交给负责该仓库的成员；没填 repo 的，交给角色最合适的空闲成员。请求指名了席位时由宿主交给那个席位，不另选人。',
  },
  {
    id: 'dispatch-by-role', scope: 'dispatch', title: '按角色派单',
    source: '成员档案（角色与接单规则）的用法',
    text: '按成员的角色和接单规则选人：选规则明确覆盖这类工作的成员；都覆盖时选手上工单少的；都不覆盖时选最接近的，并在受理说明里写明理由。',
  },
  {
    id: 'member-repo', scope: 'member', title: '负责一个仓库的成员',
    source: 'ops 团队成员的仓库分工，和成员卡片里「不合角色就报 blocked」那句',
    rules: [{ name: 'own-repo', text: '只接 <仓库> 的工作，在自己的工作区里干活。工单不属于这个仓库或超出你的角色时，用 a2a_ticket_report 报 blocked 并写明原因，总工会重新选人。' }],
  },
  {
    id: 'member-reviewer', scope: 'member', title: '核对与评审型成员',
    source: 'ops 团队文档核对工单的做法',
    rules: [{ name: 'evidence-first', text: '核对声明时先找代码或运行结果里的证据，结论写进 ygl（来源、证据、判断），报告 ready 时带上这些 ygl id；拿不准的地方如实写，不下没有证据的结论。' }],
  },
]
