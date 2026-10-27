/**
 * The board legend (review 2026-10-27, real-host check): a fixed panel at
 * the bottom-left sat over the lowest frames of a real 66-card board. It is
 * now a native <details> fold — closed by default, a small 图例 chip that
 * covers nothing; open, it shows the edge key. The open state is a
 * per-viewer convenience in browser storage (absent or throwing → closed).
 * @module nexus-stage/planning-legend
 */
const KEY = 'dsh-a2a.board.legend'

/** Build the legend fold. */
export function createLegend(): HTMLDetailsElement {
  const legend = document.createElement('details')
  legend.className = 'p-legend'
  const summary = document.createElement('summary')
  summary.textContent = '图例'
  summary.title = '边的含义（点击展开 / 收起）'
  const rows = document.createElement('div')
  rows.className = 'p-legend-rows'
  const row = (dashed: boolean, text: string, color?: string): void => {
    const line = document.createElement('span')
    const bar = document.createElement('i')
    if (dashed) bar.className = 'dashed'
    if (color !== undefined) bar.style.borderTopColor = color
    line.append(bar, document.createTextNode(text))
    rows.appendChild(line)
  }
  row(false, '成员边（星形，框→成员）')
  row(true, '跨队多属（虚线）')
  row(false, '活动边（inFlight 路由，瞬时）', 'var(--accent)')
  row(true, '联邦线（→peer）', 'var(--federal)')
  legend.append(summary, rows)
  try { legend.open = window.localStorage.getItem(KEY) === 'open' } catch { /* closed */ }
  legend.addEventListener('toggle', () => {
    try { window.localStorage.setItem(KEY, legend.open ? 'open' : 'closed') } catch { /* convenience only */ }
  })
  return legend
}
