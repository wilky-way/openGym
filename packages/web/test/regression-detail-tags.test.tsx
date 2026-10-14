import { prepareExerciseSheets } from './regression-test-support'
import { useStore } from '../src/store/useStore'
import { beforeEach } from 'vitest'
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { detailTags } from '../src/sheets'
import { exOr } from '@opengym/core/exercises'

// QA 10-06: the bench press showed "Chest" twice on its detail page, once as the body part and
// once as the main muscle.
describe('the exercise detail tags', () : any => {
  const labels: any = (id: any) : any => detailTags(exOr(id)).map((x: any) : any => x.label.toLowerCase())

  it('say Chest once on a bench press, with the body part first', () : any => {
    const l: any = labels('0025')
    expect(l.filter((x: any) : any => x === 'chest')).toHaveLength(1)
    expect(detailTags(exOr('0025'))[0]).toMatchObject({ acc: true })
    expect(new Set(l).size).toBe(l.length)
  })

  it('never repeat a word across the whole catalogue, and keep at most three helpers', () : any => {
    for (const id of ['0025', '0030', '1254', '0001', '0043', '0032']) {
      const tags: any = detailTags(exOr(id))
      const l: any = tags.map((x: any) : any => x.label.toLowerCase())
      expect(new Set(l).size, id).toBe(l.length)
      expect(tags.filter((x: any) : any => !x.icon && !x.acc).length, id).toBeLessThanOrEqual(3)
    }
  })
})

beforeEach(() : any => prepareExerciseSheets())
