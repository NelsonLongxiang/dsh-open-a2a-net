/**
 * The A2A workbench boot: fetches /__dsh_a2a/state on a poll, feeds the
 * workbench, and keeps the fault discipline (a fetch failure must never
 * masquerade as an empty fleet — the badge is the honesty surface).
 * @module nexus-stage/main
 */
import { createFaultReporter } from './fault'
import { createWorkbench, type StateBody } from './workbench'
import './workbench.css'

const app = document.getElementById('app')!

const faultBadge = document.createElement('div')
faultBadge.className = 'nexus-fault'
app.appendChild(faultBadge)
const { fault, clear: clearFault } = createFaultReporter(
  {
    show(message) {
      faultBadge.textContent = message
      faultBadge.style.display = 'block'
    },
    hide() {
      faultBadge.style.display = 'none'
    },
  },
  message => console.error(message),
)

const bench = createWorkbench({
  now: () => Date.now(),
  async abandon(taskId, reason) {
    try {
      const res = await fetch('/__dsh_a2a/tasks/abandon', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, reason }),
      })
      return res.ok
    } catch {
      return false
    }
  },
  copy(text) {
    void navigator.clipboard?.writeText(text).catch(() => {})
  },
})
app.appendChild(bench.root)

async function poll(): Promise<void> {
  try {
    const res = await fetch('/__dsh_a2a/state', { cache: 'no-store' })
    if (!res.ok) throw new Error(`/__dsh_a2a/state ${res.status}`)
    const body = (await res.json()) as StateBody
    clearFault()
    bench.update(body)
  } catch (err) {
    fault(`state 轮询失败：${String(err)}`)
  }
}

void poll()
window.setInterval(() => {
  if (!document.hidden) void poll()
}, 3000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void poll()
})
