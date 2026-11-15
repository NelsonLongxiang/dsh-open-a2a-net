# Team prompt supplements (owner 2026-11-10)

> 对照上游「沟通方式 / 工单范围 / 交付要求」三段可编辑提示词，本团队开放两段：communication（沟通方式）与 delivery（交付要求）。上游的工单范围一段不开放：范围在工单上，总工逐单定，不设团队默认。

## Context

三个预设的 persona 是团队的面貌，属主此前改不了其中任何一个字。上游让属主在 persona 之外加自己的说明；属主要同样的事，但两段就好，且**预设本身不可覆盖**——补充说明与预设冲突时以预设为准。

## Decisions

- **P1 What may change.** The settings take `prompts: { communication?, delivery? }`, each at most 4000 characters. Empty is the default (nothing added). The presets' own text is not editable anywhere; nothing here reaches the personas or the role tools.
- **P2 Where they show.** The host hands them to the role sessions as supplementary card lines: `communication` rides every candidate card (the router reads it) and the member's notes; `delivery` rides the assignment card's notes (what a member works to). Both are labeled: they are the owner's addition, and **on a clash the preset stands**.
- **P3 Who may write them.** A settings write touching `prompts` needs the owner's GUI login, exactly as a rule change does (router-owner-asks D10): the field rides `touchesRules`, so the control route's owner proof gates it. A team session's shell cannot edit them.
- **P4 History.** Reuses the settings-save history (PR#561): every change records who, when, and the old and new text (clipped for display), per team, with the team's state.

## Consequences

- The owner can tune how the team talks and what done looks like without forking a preset, and sees every change on the team page.
- The team page's 设置 shows both boxes next to the other execution settings, pre-filled from what is saved, empty for the default.
