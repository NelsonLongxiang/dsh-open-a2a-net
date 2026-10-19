import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('C:/Users/Administrator/.ygl-trees/ygl-trees.db', { readOnly: true });

// discover schema of events table
const cols = db.prepare("PRAGMA table_info(events)").all().map(c => c.name);
console.log('events cols:', cols.join(','));

// any later events touching these entities (rm/delete/resolve)?
for (const id of ['47d0d78b18', 'f0ad79350f', '40b87333c9']) {
  const rows = db.prepare('SELECT ts,kind,entity,payload FROM events WHERE entity_id = ? ORDER BY ts').all(id);
  console.log('== full lifecycle of', id, JSON.stringify(rows));
}
// all write-vs-row kinds doctor likely checks, count adds without matching rows
const kinds = db.prepare("SELECT DISTINCT kind FROM events WHERE kind LIKE '%.add' OR kind LIKE '%.rm' OR kind LIKE '%.delete'").all();
console.log('write kinds seen:', kinds.map(k => k.kind).join(','));
// rows actually present
for (const [tbl, col] of [['kb_notes', 'id'], ['sources', 'id']]) {
  try {
    const n = db.prepare(`SELECT COUNT(*) n FROM ${tbl}`).get();
    console.log(tbl, 'rows:', n.n);
  } catch (e) { console.log(tbl, 'ERR', e.message); }
}
