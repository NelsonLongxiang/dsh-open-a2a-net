# superagent team (design v4)

With `superagent: true` in the plugin config, this host runs superagent's own domain engine. The engine is upstream `src/core`, vendored unchanged under `src/superagent/upstream/dsh-superagent`.

The flow follows upstream's model:

1. **Source → Trigger.** Today the Source is the workbench. Later the A2A Source also feeds Triggers.
2. **Gate.** The gate decides who may originate work (upstream docs/002):
   - **explicit**: an allowed person who addresses the team, or an allowed person's follow-up on a thread with tickets. The owner is that person, through the workbench or `a2a-net superagent request` with the owner credential.
   - **inferred**: a message from an agent on the A2A Source's bot list that addresses the team, or an unlisted person's follow-up. A2A and CLI callers are always agents: a CLI identity proves a key, not a person.
   - The accept mode (`off`, `observe`, `auto`; default `observe`) decides what inferred work can do. Under `observe`, the router judges each inferred candidate against the enabled rules, and a match is recorded as "would accept", with nothing accepted. Under `auto`, a match on enabled rules is accepted.
   - An agent can never make a stop.
3. **Eval by the router.** The router is one fixed session the owner names.
4. **Decision → Ticket with Mandate.** An accepted request becomes a ticket.
5. **Assignment → executor.** The A2A executor arrives in a later PR; until then accepted tickets wait as `working / queued`.

## For the router

- Candidates arrive in your own session as `[superagent candidate] …` cards. Decide each by its `trigger_id` with `superagent_route`:
  - `accept`: one ticket for the request, with a title, a scope, a reason and an acknowledgement in the request's language. Do not add an implementation plan.
  - `attach`: to a listed ticket that the message points at explicitly.
  - `stop`: a person asked to stop that ticket.
  - `ignore`: with a reason.
  - For an **inferred** candidate, pass `rules` with the enabled rules it matches. `accept` needs at least one. Under `observe` it is recorded as would-accept. `rules: []` records an assessed ignore.
- Read with `superagent_read`, reply with `superagent_reply` (`answer`, `result` or `attention`), and ask an idle ticket's worker for a status report with `superagent_status`.
- You neither send nor receive A2A work. `a2a_route` from you, or to you by any address (handle, session id, or a canvas you sit in), is refused with `[superagent-router-outbound]` or `[superagent-router-inbound]`.
- No other session can use these tools; they answer `not-router`.

## For the owner

The owner control route is `/__dsh_a2a/superagent`.

- `GET` returns the state: threads with their triggers, decisions and replies, and tickets with their stage.
- `POST { action }` takes one of:
  - `settings`: the router (a joined local session), the allowed persons per Source, the A2A bot list, the accept mode, the proactive rules (`{name, text, enabled}`), the Source switches, the Eval timeout, and pause;
  - `request`: the workbench Source, with `text`, and `thread` to follow up;
  - `stop` / `retry`: act on a ticket by `ticket_id`.
- A follow-up on a ticket's thread goes to that ticket (Subscription fan-out). It does not start a new Eval.
- State lives under `<a2a home>/superagent/`.
