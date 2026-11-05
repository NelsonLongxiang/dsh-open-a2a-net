// @vitest-environment jsdom
import { describe,it,expect,vi } from 'vitest'
import { createMemberProvenancePicker } from '../src/member-provenance-picker'
describe('#334 explicit source confirmation',()=>{
 it('requires explicit source choice and submits exact selected peer without clearing suspension',async()=>{
  const confirm=vi.fn(async()=>({ok:true})),choice={replacement:'dsh/aaaaaaaa',label:'foreign same-id8 — host B',peer:'http://host-b'}
  const root=createMemberProvenancePicker([{replacement:'session-aaaaaaaa',label:'local'},choice],confirm);document.body.append(root)
  root.dispatchEvent(new Event('submit',{cancelable:true}));expect(confirm).not.toHaveBeenCalled()
  const select=root.querySelector('select')!;select.value='1';root.dispatchEvent(new Event('submit',{cancelable:true}));await Promise.resolve();await Promise.resolve()
  expect(confirm).toHaveBeenCalledTimes(1);expect(confirm).toHaveBeenCalledWith(choice);expect(root.textContent).toContain('暂停状态不变');expect(root.querySelector('button')!.disabled).toBe(true);root.remove()
 })
 it('shows failed verification without optimistic source replacement and treats labels as text',async()=>{
  const root=createMemberProvenancePicker([{replacement:'dsh/aaaaaaaa',label:'<img src=x onerror=alert(1)>',peer:'http://host-b'}],async()=>({ok:false,error:'minimal card: source unavailable'}));document.body.append(root)
  expect(root.querySelector('img')).toBeNull();root.querySelector('select')!.value='0';root.dispatchEvent(new Event('submit',{cancelable:true}));await Promise.resolve();await Promise.resolve()
  expect(root.textContent).toContain('minimal card: source unavailable');expect(root.querySelector('button')!.disabled).toBe(false);root.remove()
 })
})
