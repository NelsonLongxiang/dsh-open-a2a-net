import assert from 'node:assert/strict'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'screenshots.json'), 'utf8'))
const png = Buffer.from([137,80,78,71,13,10,26,10])
function imagePaths(value) {
  assert.ok(Array.isArray(value) && value.length >= 1 && value.length <= 8)
  assert.equal(new Set(value).size, value.length)
  for (const path of value) {
    assert.equal(typeof path, 'string')
    assert.ok(path.startsWith('images/market/') && path.endsWith('.png'))
    assert.ok(!path.includes('\\') && !path.split('/').includes('..'))
    const rel = relative(realpathSync(root), realpathSync(resolve(root,path)))
    assert.ok(!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
  }
  return value
}
test('curated artwork manifest uses unique package-local PNG paths', () => {
  assert.equal(imagePaths(manifest).length, 3)
  for (const path of manifest) {
    const bytes = readFileSync(resolve(root,path))
    assert.deepEqual(bytes.subarray(0,8), png)
    assert.equal(bytes.readUInt32BE(16), 1600)
    assert.equal(bytes.readUInt32BE(20), 1000)
  }
})
test('original editable sources disclose fictional examples rather than product screenshots', () => {
  for (const path of manifest) {
    const svg = readFileSync(resolve(root,path.replace(/\.png$/,'.svg')), 'utf8')
    assert.ok(svg.includes('原创手绘功能示意'))
    assert.ok(svg.includes('非实际产品界面'))
    assert.ok(svg.includes('Not a product UI capture'))
    assert.ok(svg.includes('OPT-IN 0.8 PREVIEW'))
    assert.ok(!svg.includes('<image') && !svg.includes('<script'))
    assert.ok(!/https?:\/\//.test(svg.replace('http://www.w3.org/2000/svg','')))
  }
})
test('both locale readmes use only the curated original artwork and qualify Superagent preview', () => {
  for (const [file,note] of [['README.md','not a product UI'],['README_zh.md','非实际界面']]) {
    const text = readFileSync(resolve(root,file),'utf8')
    const refs = [...text.matchAll(/!\[([^\]]*)\]\((images\/market\/[^)]+)\)/g)]
    assert.deepEqual(refs.map(m=>m[2]),manifest)
    for (const m of refs) assert.ok(m[1].toLowerCase().includes(note.toLowerCase()))
    const intro = text.split('\n').slice(0,12).join('\n')
    assert.ok(intro.includes('Superagent') && intro.includes('0.8') && intro.includes('0.7.0'))
    assert.ok(text.includes('@nelsonlongxiang/dsh-open-a2a-net@preview'))
    assert.ok(!text.includes('workbench-demo.png') && !text.includes('ledger-demo.png'))
  }
})
test('package payload includes metadata without changing its manifest or dependency contract', () => {
  const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'))
  assert.ok(pkg.files.includes('images') && pkg.files.includes('screenshots.json'))
  assert.ok(pkg.dsh.bundle.patch)
  assert.ok(pkg.scripts['verify:storefront'].includes('tests/market-metadata.test.mjs'))
})
test('PNG icon is square and backed by an original vector source', () => {
  const bytes = readFileSync(resolve(root,'images/market/icon.png'))
  assert.deepEqual(bytes.subarray(0,8),png)
  assert.equal(bytes.readUInt32BE(16),512)
  assert.equal(bytes.readUInt32BE(20),512)
  assert.ok(readFileSync(resolve(root,'images/market/icon.svg'),'utf8').includes('<svg'))
})
test('duplicate, oversized and traversal manifests are rejected', () => {
  assert.throws(()=>imagePaths([manifest[0],manifest[0]]))
  assert.throws(()=>imagePaths(Array.from({length:9},(_,i)=>'images/market/x'+i+'.png')))
  assert.throws(()=>imagePaths(['images/market/../01-superagent-flow.png']))
})
test('ready and observer mode are not promoted into independent acceptance or automatic intake', () => {
  const en=readFileSync(resolve(root,'README.md'),'utf8')
  const zh=readFileSync(resolve(root,'README_zh.md'),'utf8')
  assert.ok(en.includes('Ready is not independently accepted'))
  assert.ok(zh.includes('待审不是验收通过'))
  assert.ok(en.includes('Observe does not mean auto-accept'))
  assert.ok(zh.includes('默认观察'))
})
