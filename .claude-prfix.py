import io

def patch(path, pairs):
    s = io.open(path, encoding='utf-8').read()
    for old, new in pairs:
        assert old in s, (path, old[:70])
        s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print('patched', path)

# ── planning-view.ts ──
p = 'nexus-stage/src/planning-view.ts'
s = io.open(p, encoding='utf-8').read()

# P2-4: the join sentinel was a literal NUL byte — rg/Gitee read the file as binary
nul = "join('\x00') !== current.join('\x00')"
assert nul in s
s = s.replace(nul, "join('\\u0000') !== current.join('\\u0000')", 1)

# P1-1: compute `created` at the emit site (the flag was threaded but never set)
old = """    const name = input.value.trim()
      close()
      emitAction({ type: 'create-team', name, ids })"""
alt = """      const name = input.value.trim()
      close()
      emitAction({ type: 'create-team', name, ids })"""
# the actual formatting from the file:
old_actual = """      const name = input.value.trim()
      close()
      emitAction({ type: 'create-team', name, ids })"""
new_actual = """      const name = input.value.trim()
      close()
      const created = model.getFrame(name) === undefined
      emitAction({ type: 'create-team', name, ids, created })"""
assert old_actual in s, 'created emit'
s = s.replace(old_actual, new_actual, 1)

# P2-1: Esc works from any focus in the dialog (wrap-level, alongside the Tab trap)
old = """    wrap.addEventListener('keydown', (ev) => {
      const e = ev as KeyboardEvent
      if (e.key !== 'Tab') return
      e.preventDefault()"""
new = """    wrap.addEventListener('keydown', (ev) => {
      const e = ev as KeyboardEvent
      if (e.key === 'Escape') { e.preventDefault(); close(); return }
      if (e.key !== 'Tab') return
      e.preventDefault()"""
assert old in s, 'wrap esc'
s = s.replace(old, new, 1)

# P2-2: frame head role=button promised Enter-menu — deliver it
old = """    if (ev.key === ' ' && (ev.target as Element | null)?.classList?.contains('p-node')) {"""
new = """    const headTarget = (ev.target as Element | null)?.closest?.('.p-frame-head') ?? null
    if ((ev.key === 'Enter' || ev.key === ' ') && headTarget !== null) {
      ev.preventDefault()
      const r = headTarget.getBoundingClientRect()
      contextMenuAt(r.left + r.width / 2, r.top + r.height / 2, headTarget)
      return
    }
    if (ev.key === ' ' && (ev.target as Element | null)?.classList?.contains('p-node')) {"""
assert old in s, 'head enter'
s = s.replace(old, new, 1)

# P2-3: anchor re-seed via the element maps (no raw attribute selectors)
old = """    if (menuAnchor === null) {
      menuAnchor = target.kind === 'node'
        ? nodeLayer.querySelector<HTMLElement>(`.p-node[data-id='${target.id}']`) ?? null
        : frameLayer.querySelector<HTMLElement>(`.p-frame-head[data-frame='${target.name}']`) ?? null
    }"""
new = """    if (menuAnchor === null) {
      menuAnchor = target.kind === 'node'
        ? nodeEls.get(target.id) ?? null
        : frameEls.get(target.name) ?? null
    }"""
assert old in s, 'anchor map'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('planning-view: ok')

# ── planning-teams-dom.spec: pin the created flag ──
p = 'nexus-stage/tests/planning-teams-dom.spec.ts'
s = io.open(p, encoding='utf-8').read()
old = "    expect(actions[0]).toEqual({ type: 'create-team', name: '先锋', ids: ['a', 'b'] })"
new = "    expect(actions[0]).toEqual({ type: 'create-team', name: '先锋', ids: ['a', 'b'], created: true })"
assert old in s
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('teams spec: ok')

# ── canvas-wire.spec: the ghost-team compensation, finally covered ──
p = '../nexus-stage/tests/canvas-wire.spec.ts'
s = io.open(p, encoding='utf-8').read()
old = """  it('hasPending tracks in-flight work', async () => {"""
new = """  it('create-team compensates a ghost empty team when the first add fails on a created team', async () => {
    const { f, wire } = fixture()
    const done = wire.createTeam('新队', ['a', 'b'], true)
    await f.respond(ok) // create ok
    await f.respond({ status: 200, body: { ok: false, error: 'name and a joined session id are required' } }) // first add fails
    expect(await done).toBe(false)
    expect(f.bodies).toHaveLength(3) // create, add, compensating remove
    expect(f.bodies[2]).toEqual({ action: 'remove', name: '新队' })
    expect(f.notices).toHaveLength(1) // the original error, verbatim
  })

  it('a pre-existing team is NOT removed on first-add failure (created=false)', async () => {
    const { f, wire } = fixture()
    const done = wire.createTeam('旧队', ['a', 'b'], false)
    await f.respond(ok)
    await f.respond({ status: 200, body: { ok: false, error: 'name and a joined session id are required' } })
    expect(await done).toBe(false)
    expect(f.bodies).toHaveLength(2) // no compensating remove over user data
  })

  it('a mid-sequence failure keeps genuinely joined members (no ghost remove)', async () => {
    const { f, wire } = fixture()
    const done = wire.createTeam('新队', ['a', 'b'], true)
    await f.respond(ok) // create
    await f.respond(ok) // first add succeeded — the team is no longer empty
    await f.respond({ status: 200, body: { ok: false, error: 'x' } }) // second add fails
    expect(await done).toBe(false)
    expect(f.bodies).toHaveLength(3)
    expect(f.bodies[2]).toEqual({ action: 'add-member', name: '新队', id: 'b' }) // no remove emitted
  })

  it('hasPending tracks in-flight work', async () => {"""
assert old in s
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('wire spec: ok')
