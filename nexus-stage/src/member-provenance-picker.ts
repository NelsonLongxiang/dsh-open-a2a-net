/** Explicit slot provenance confirmation; never clears suspension or infers owner from a label. */
export interface ProvenanceChoice { replacement: string; label: string; peer?: string }
export function createMemberProvenancePicker(choices: readonly ProvenanceChoice[], confirm: (choice: ProvenanceChoice) => Promise<{ ok: boolean; error?: string }>): HTMLElement {
 const root=document.createElement('form');root.className='wb-member-provenance'
 const select=document.createElement('select');select.setAttribute('aria-label','确认成员来源')
 select.appendChild(new Option('明确选择来源…',''))
 choices.forEach((choice,index)=>select.appendChild(new Option(choice.label,String(index))))
 const submit=document.createElement('button');submit.type='submit';submit.textContent='确认来源'
 const hint=document.createElement('span');hint.textContent='确认不等于恢复；已暂停槽位仍保持暂停'
 root.append(select,submit,hint)
 root.addEventListener('submit',async event=>{event.preventDefault();if(select.value==='')return;const choice=choices[Number(select.value)];if(!choice)return;submit.disabled=true;const out=await confirm(choice);if(!out.ok){submit.disabled=false;hint.textContent=out.error??'来源无法验证，原槽位保留'}else hint.textContent='来源已确认；等待状态刷新（暂停状态不变）'})
 return root
}
