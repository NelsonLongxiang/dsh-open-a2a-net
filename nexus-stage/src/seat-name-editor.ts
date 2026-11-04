/** Human owner form only: labels never grant membership or become routing ids. */
export function createSeatNameEditor(sessions: readonly { id: string; name?: string; label?: string }[], names: Record<string, string>, save: (names: Record<string, string>) => Promise<{ ok: boolean; error?: string }>): HTMLElement {
  const box = document.createElement('section')
  const heading = document.createElement('h4'); heading.textContent = '会话席位名（仅人工设定）'; box.appendChild(heading)
  const note = document.createElement('p'); note.className = 'wb-hint'; note.textContent = '稳定展示名，不改变会话标题、路由句柄或准入。留空并保存可清除。'; box.appendChild(note)
  const select = document.createElement('select'); select.setAttribute('aria-label', '选择命名的本机会话')
  for (const id of new Set([...sessions.map(row => row.id), ...Object.keys(names)])) {
    const row = sessions.find(row => row.id === id), option = document.createElement('option')
    option.value = id; option.textContent = (names[id] ?? row?.name ?? row?.label ?? id) + ' · ' + id; select.appendChild(option)
  }
  const input = document.createElement('input'); input.type = 'text'; input.maxLength = 64; input.setAttribute('aria-label', '人工席位名'); input.placeholder = '例如：开发席'
  const button = document.createElement('button'); button.type = 'submit'; button.textContent = '保存席位名'; button.className = 'wb-member-submit'
  const form = document.createElement('form'); form.className = 'wb-member-add'; form.append(select, input, button)
  const status = document.createElement('p'); status.className = 'wb-hint'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
  let pending = false
  const load = () => { input.value = names[select.value] ?? ''; button.disabled = pending || select.value === '' }
  select.addEventListener('change', load); load()
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (pending || select.value === '') return
    const id = select.value, value = input.value.trim(), next = { ...names }
    if (value === '') delete next[id]; else next[id] = value
    pending = true; button.disabled = true; select.disabled = true; input.disabled = true
    try {
      const result = await save(next)
      if (result.ok) { delete names[id]; if (value !== '') names[id] = value; status.textContent = '席位名已保存；目录将随状态刷新。' }
      else status.textContent = result.error ?? '保存失败'
    } catch (error) { status.textContent = '保存失败：' + String(error) }
    finally { pending = false; select.disabled = false; input.disabled = false; load() }
  })
  box.append(form, status); return box
}
