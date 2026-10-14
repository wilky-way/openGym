import { prepareExerciseSheets } from './regression-test-support'
// @vitest-environment happy-dom
// Favourites (issue #6): the detail sheet's star writes S.favEx, and the picker floats
// favourites to the top of its list without disturbing the order of everything else.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from '@opengym/core/exercises'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { exerciseDetailSheet, exercisePicker } from '../src/sheets'

const mounted: any = []
const S: any = () : any => useStore.getState().S

// Renders whatever sheet is on top and returns its host element.
function renderTop() : any {
  const sheet: any = useUI.getState().sheets.at(-1)
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  return host
}

const names: any = (host: any) : any => [...(host.querySelectorAll('.item .tt') as any)].map((el: any) : any => el.textContent)
const starOf: any = (host: any) : any => (host.querySelector('.fav-btn') as any)

beforeEach(() : any => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})

afterEach(() : any => {
  act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) })
})

describe('exercise detail star', () : any => {
  it('adds and removes the exercise from favourites with a toast', () : any => {
    const ex: any = EXDB[0]!
    exerciseDetailSheet(ex)
    const host: any = renderTop()
    expect(starOf(host).getAttribute('aria-label')).toBe('Add to favourites')
    act(() : any => starOf(host).click())
    expect(S().favEx).toEqual([ex.id])
    expect(useUI.getState().toastMsg).toBe('Added to favourites')
    expect(starOf(host).getAttribute('aria-label')).toBe('Remove from favourites')
    expect(starOf(host).getAttribute('aria-pressed')).toBe('true')
    act(() : any => starOf(host).click())
    expect(S().favEx).toEqual([])
    expect(useUI.getState().toastMsg).toBe('Removed from favourites')
  })

  it('tolerates a profile written before the field existed', () : any => {
    useStore.setState((s: any) : any => { const next: any = { ...s.S }; delete next.favEx; return { S: next } })
    exerciseDetailSheet(EXDB[0]!)
    const host: any = renderTop()
    act(() : any => starOf(host).click())
    expect(S().favEx).toEqual([EXDB[0]!.id])
  })
})

describe('exercise picker', () : any => {
  it('lists favourites first and marks them, keeping the rest in catalogue order', () : any => {
    const plain: any = names((exercisePicker(vi.fn()), renderTop())).slice(1)   // drop "Create your own"
    useUI.setState({ sheets: [] })
    const fav: any = [plain[7], plain[3]]
    const favIds: any = fav.map((n: any) : any => EXDB.find((e: any) : any => e.n === n)!.id)
    useStore.setState((s: any) : any => ({ S: { ...s.S, favEx: favIds } }))
    exercisePicker(vi.fn())
    const host: any = renderTop()
    const shown: any = names(host).slice(1)
    // Favourites keep the list's own order among themselves — not the order they were starred in.
    expect(shown.slice(0, 2)).toEqual(plain.filter((n: any) : any => fav.includes(n)))
    expect(shown.slice(2)).toEqual(plain.filter((n: any) : any => !fav.includes(n)))
    const rows: any = [...(host.querySelectorAll('.item') as any)].slice(1)
    expect(rows.slice(0, 2).every((r: any) : any => (r.querySelector('.tt .fav-star') as any))).toBe(true)
    expect((rows[2].querySelector('.tt .fav-star') as any)).toBeNull()
  })

  it('offers a Favourites chip only when there are favourites, and it filters to them', () : any => {
    exercisePicker(vi.fn())
    let host: any = renderTop()
    const chip: any = (h: any) : any => [...(h.querySelectorAll('.chips .chip') as any)].find((b: any) : any => b.textContent.startsWith('Favourites'))
    expect(chip(host)).toBeUndefined()
    useUI.setState({ sheets: [] })
    useStore.setState((s: any) : any => ({ S: { ...s.S, favEx: [EXDB[5]!.id, EXDB[9]!.id] } }))
    exercisePicker(vi.fn())
    host = renderTop()
    expect(chip(host).textContent).toBe('Favourites (2)')
    act(() : any => chip(host).click())
    expect(names(host)).toEqual([EXDB[5]!.n, EXDB[9]!.n])
  })
})

beforeEach(() : any => prepareExerciseSheets())
