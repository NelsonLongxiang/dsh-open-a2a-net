# superagent member platforms

A member platform is a way for something other than a DSH session on this host, or on a served member host, to be a
superagent team member. Each platform module keeps its own rules: how a member is admitted to the team canvas, how work
is delivered to it, what its card says, and how its reports are recognised. `host/index.ts` only routes to it.

- `pi.ts`: Pi seats (docs/design/superagent-pi-platform.md). A CLI identity that declares `capabilities.piSeat` on its
  signed card, deposited on the team host. Its key is pinned on its canvas row; work goes to its CLI mailbox; its reports
  are CLI-signed ops on `/a2a/superagent-team`.
