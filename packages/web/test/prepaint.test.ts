// @vitest-environment happy-dom
import {beforeEach,expect,it,vi} from 'vitest'
import {prepaintTheme} from '../src/platform/prepaint'
import {browserKeyValueStore} from '../src/platform/storage'
beforeEach(()=>{localStorage.clear();document.documentElement.removeAttribute('data-theme');document.head.innerHTML='<meta name="theme-color" content="#1A1415">'})
for(const [saved,system,expected] of [['light',true,'light'],['dark',false,'dark'],['system',false,'light'],['system',true,'dark'],[undefined,false,'light']] as const)it(`before React: saved ${saved} with OS dark ${system} paints ${expected}`,()=>{
 const original=window.matchMedia
 try {
  window.matchMedia=vi.fn(()=>({matches:system})) as any
  localStorage.setItem('gym_state_v1',JSON.stringify({theme:saved,opaque:{keep:true}}));const bytes=localStorage.getItem('gym_state_v1')
  prepaintTheme(window,browserKeyValueStore(window))
  expect(document.documentElement.dataset.theme).toBe(expected);expect(document.querySelector<HTMLMetaElement>('meta')!.content).toBe(expected==='light'?'#F2EBE8':'#1A1415');expect(localStorage.getItem('gym_state_v1')).toBe(bytes)
 } finally {window.matchMedia=original}
})
it('blocked storage leaves the default without throwing or writing',()=>{
 expect(()=>prepaintTheme(window,{get(){throw new Error('blocked')}})).not.toThrow();expect(document.querySelector<HTMLMetaElement>('meta')!.content).toBe('#1A1415');expect(document.documentElement.dataset.theme).toBeUndefined()
})
