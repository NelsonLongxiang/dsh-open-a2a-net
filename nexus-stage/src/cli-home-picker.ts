/** Explicit operator choice only; this form never auto-selects or relaxes home admission. */
export interface CliHomeOptions { ok: boolean; homes?: string[]; unreadable?: number; held?: boolean; error?: string }
export function createCliHomePicker(read: () => Promise<CliHomeOptions>, save: (home: string) => Promise<boolean>): HTMLFormElement {
  const form = document.createElement('form')
  form.className = 'wb-cli-home'
  const readButton = document.createElement('button')
  readButton.type = 'button'; readButton.textContent = '指定 home'; readButton.className = 'wb-member-submit'
  const select = document.createElement('select')
  select.className = 'wb-member-pick'; select.setAttribute('aria-label', '选择 CLI home 主机'); select.hidden = true
  const submit = document.createElement('button')
  submit.type = 'submit'; submit.textContent = '确认 home'; submit.className = 'wb-member-submit'; submit.hidden = true; submit.disabled = true
  const note = document.createElement('div')
  note.className = 'wb-hint'; note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite')
  note.textContent = 'home 未确定；点击指定 home 现读已链接主机名片。'
  let busy = false
  readButton.addEventListener('click', async () => {
    if (busy) return
    busy = true; readButton.disabled = true; submit.disabled = true; note.textContent = '正在现读主机名片…'
    try {
      const result = await read()
      if (!result.ok) throw Error(result.error ?? '候选读取失败')
      if (result.held) { readButton.hidden = true; select.hidden = true; submit.hidden = true; select.replaceChildren(); note.textContent = '本机持有，无需指定'; return }
      select.replaceChildren(new Option('请选择 home 主机…', '', true, true))
      for (const home of result.homes ?? []) select.appendChild(new Option(home, home))
      select.hidden = false; submit.hidden = false; readButton.textContent = '刷新候选'
      const count = result.homes?.length ?? 0
      note.textContent = (result.unreadable ? '有 ' + result.unreadable + ' 台对端名片读不到；' : '') + (count > 1 ? '多台已链接主机列出该句柄，请显式选择。' : count === 1 ? '找到 1 台已链接主机；仍需你显式确认。' : '当前没有已链接且列出该句柄的可选主机。')
    } catch (error) { note.textContent = '读取失败：' + String(error); select.hidden = true; submit.hidden = true }
    finally { busy = false; readButton.disabled = false }
  })
  select.addEventListener('change', () => { submit.disabled = busy || select.value === '' })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (busy || select.value === '') return
    busy = true; readButton.disabled = true; select.disabled = true; submit.disabled = true
    try { note.textContent = await save(select.value) ? 'home 已指定：' + select.value : '指定失败：主机可能已离线或不再列出该句柄，请刷新后重选。' }
    catch (error) { note.textContent = '指定失败：' + String(error) }
    finally { busy = false; readButton.disabled = false; select.disabled = false; submit.disabled = select.value === '' }
  })
  form.append(readButton, select, submit, note)
  return form
}
