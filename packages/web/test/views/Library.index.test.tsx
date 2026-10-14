// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import Library from '../../src/views/Library'
import { useStore, DEF } from '../../src/store/useStore'
import { configureUx, createBrowserUx } from '../../src/platform/ux'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
it('ranks custom assisted lifts by least help in the Library', () => {
  configureUx(createBrowserUx())
  useStore.setState({ S:{...structuredClone(DEF),customEx:[{id:'mine',n:'My assisted pull',bp:'back',eq:'assisted',assisted:true,custom:true}],workouts:[{entries:[{id:'mine',sets:[{done:true,w:70,r:6},{done:true,w:30,r:6}]}]}]} })
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
  try { act(()=>root.render(<Library/>));expect(host.querySelector('.item .tag')!.textContent).toBe('30') }
  finally {act(()=>root.unmount());host.remove()}
})
