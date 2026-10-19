import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('C:/Users/Administrator/.ygl-trees/ygl-trees.db', { readOnly: true });
const tid = db.prepare("SELECT id FROM trees WHERE name='v2-roadmap'").get().id;
const nodes = db.prepare("SELECT id,key,name,kind,tier FROM nodes WHERE tree_id=?").all(tid);
const byId = Object.fromEntries(nodes.map(n => [n.id, n.key]));
console.log('== nodes ==');
for (const n of nodes) console.log(`${n.id} ${n.key} (${n.name}, ${n.kind}, t${n.tier})`);
console.log('== conditions ==');
for (const c of db.prepare("SELECT * FROM node_conditions").all()) {
  if (byId[c.node_id]) console.log(`${byId[c.node_id]}: ${JSON.stringify(c).slice(0, 400)}`);
}
console.log('== state ==');
for (const s of db.prepare("SELECT * FROM node_state").all()) {
  if (byId[s.node_id]) console.log(`${byId[s.node_id]}: ${JSON.stringify(s)}`);
}
console.log('== events last 10 ==');
for (const e of db.prepare("SELECT ts,actor,kind,entity,entity_id,substr(payload,1,80) p FROM events ORDER BY id DESC LIMIT 10").all()) console.log(JSON.stringify(e));
