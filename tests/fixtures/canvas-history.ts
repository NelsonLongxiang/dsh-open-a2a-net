/** Explicit historical disk fixture, not a way to bypass the new-write API in a running node. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export function seedCanvasHistory(home: string, teams: Array<{name:string;members:string[]}>, joined: string[] = []): string {
 mkdirSync(join(home,'a2a'),{recursive:true})
 writeFileSync(join(home,'a2a/canvas.json'),JSON.stringify({teams}))
 if(joined.length)writeFileSync(join(home,'a2a/joined.json'),JSON.stringify({sessions:joined}))
 return home
}
