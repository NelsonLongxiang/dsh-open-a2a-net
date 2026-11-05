// @vitest-environment jsdom
import { describe,it,expect,vi } from 'vitest'
import { joinedLocalIdsByHandle,mirrorMemberIds } from '../src/planning-member-handles'
import { createPlanningView, type PlanningInput } from '../src/planning-view'
describe('#334 owner-qualified board projection',()=>{
 it('an explicit local owner alias wins over foreign same-id8 publication, but duplicate local ids stay ambiguous',()=>{
  const s={id:'session-aaaaaaaa11112222',team:'dsh/aaaaaaaa',memberRef:'dsh/aaaaaaaa@11111111',joined:true}
  const map=joinedLocalIdsByHandle([s],new Set(['dsh/aaaaaaaa']))
  expect(map.get(s.team)).toBeUndefined();expect(map.get(s.memberRef)).toBe(s.id)
  expect(joinedLocalIdsByHandle([s,{...s,id:'session-aaaaaaaa99990000'}],new Set()).get(s.memberRef)).toBeUndefined()
  expect(mirrorMemberIds([{org:[{members:[s.memberRef]}]}],[s],[{team:s.team,memberRef:'dsh/aaaaaaaa@22222222',via:'http://peer'}])).toEqual(new Set([s.id]))
 })
 it('two remote hosts sharing a plain handle render as distinct qualified cards and attach only the selected owner',()=>{
  const selected='dsh/aaaaaaaa@22222222',other='dsh/aaaaaaaa@33333333'
  const input:PlanningInput={sessions:[],teams:[{name:'ops',members:[{id:selected}]}],peerCount:2,peers:[{url:'http://peer-b'},{url:'http://peer-c'}],remoteTeams:[{team:'dsh/aaaaaaaa',memberRef:selected,name:'B',via:'http://peer-b'},{team:'dsh/aaaaaaaa',memberRef:other,name:'C',via:'http://peer-c'}]}
  const view=createPlanningView({onDirty:vi.fn(),onLampClick:vi.fn(),onCanvasAction:vi.fn(async()=>true),now:()=>1000});document.body.append(view.root);view.reconcile(input)
  expect(view.root.querySelector('.p-node[data-id="member-dsh-aaaaaaaa-22222222"]')).not.toBeNull()
  expect(view.root.querySelector('.p-node[data-id="member-dsh-aaaaaaaa-33333333"]')).not.toBeNull()
  const frame=[...view.root.querySelectorAll('.p-frame')].find(f=>f.getAttribute('data-name')==='ops');expect(frame?.querySelector('.cnt')?.textContent).toContain('1 成员')
  view.reconcile(input);expect(view.root.querySelectorAll('.p-node[data-id^="member-dsh-aaaaaaaa-"]')).toHaveLength(2);view.destroy()
 })
})
