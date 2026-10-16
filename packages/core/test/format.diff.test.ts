import { afterEach, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import * as port from '../src/format.js'
import * as i18n from '../src/i18n-core.js'
// Locale is the one intentional formatting change: feed the legacy algorithm en-US too.
vi.mock('../../../packages/parity/fixtures/oracle/frontend/src/lib/i18n-core.js', async importOriginal => ({
  ...await importOriginal<typeof i18n>(), dateLocale: () => 'en-US'
}))
// @ts-expect-error -- Frozen JavaScript oracle has no declarations at its snapshot path.
import * as oracle from '../../../packages/parity/fixtures/oracle/frontend/src/lib/format.js'
const runs = Number(process.env.PARITY_RUNS || 1000)
const iso = fc.integer({min:Date.UTC(2024,0,1),max:Date.UTC(2027,11,31)}).map(t=>new Date(t).toISOString().slice(0,10))
function equal(actual: unknown, expected: unknown) {
  expect(actual).toStrictEqual(expected)
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
}
afterEach(()=>{port.setWeightDecimals(1);oracle.setWeightDecimals(1);vi.useRealTimers()})
it('format matches the legacy algorithms with the approved en-US locale', () => {
  fc.assert(fc.property(iso,iso,fc.integer({min:0,max:1e9}),fc.integer({min:-1e6,max:1e6}),fc.boolean(), (a,b,ms,n,long)=>{
    equal(port.fmtDate(a,long,true),oracle.fmtDate(a,long,true))
    equal(port.fmtDateRange(a,b,long,new Date('2026-06-01T12:00:00')),oracle.fmtDateRange(a,b,long,new Date('2026-06-01T12:00:00')))
    equal(port.fmtDur(ms),oracle.fmtDur(ms));equal(port.durPart(ms),oracle.durPart(ms))
    for(const decimals of [1,2]) {
      port.setWeightDecimals(decimals);oracle.setWeightDecimals(decimals)
      equal(port.fmtNum(n/100),oracle.fmtNum(n/100));equal(port.fmtPlate(n/100),oracle.fmtPlate(n/100))
      equal(port.fmtVol(n/100,'lb'),oracle.fmtVol(n/100,'lb'))
    }
    equal(port.fmtAgo(ms,1e9),oracle.fmtAgo(ms,1e9));equal(port.fmtDaysAgo(a,b),oracle.fmtDaysAgo(a,b))
    equal(port.exCount(n),oracle.exCount(n));equal(port.routineCount(n),oracle.routineCount(n))
    equal(port.changeCount(n),oracle.changeCount(n));equal(port.setsWorkCount(n,1),oracle.setsWorkCount(n,1))
    for(const ws of [0,1,6]) {
      equal(port.weekOrder(ws),oracle.weekOrder(ws));equal(port.weekDayOffset(n%7,ws),oracle.weekDayOffset(n%7,ws))
      equal(port.startOfWeek(a,ws),oracle.startOfWeek(a,ws));equal(port.weekKey(a,ws),oracle.weekKey(a,ws))
    }
  }),{seed:20261013,numRuns:runs})
}, 60000)
it('text casing and accent helpers keep their output and exported constants', () => {
  fc.assert(fc.property(fc.string(),s=>{
    equal(port.capWords(s),oracle.capWords(s));equal(port.exerciseNameText({n:s}),oracle.exerciseNameText({n:s}))
    equal(port.argb(s),oracle.argb(s))
  }),{seed:20261014,numRuns:runs})
  equal(port.ACCENTS,oracle.ACCENTS);equal(port.ACCENT_NAMES,oracle.ACCENT_NAMES);equal(port.ACCENT_INK,oracle.ACCENT_INK)
  equal(port.DAYN,oracle.DAYN);equal(port.DAYS,oracle.DAYS);equal(port.MONTHS,oracle.MONTHS);equal(port.MONTHS_LONG,oracle.MONTHS_LONG)
}, 60000)
it('local dates, generated ids and fallback formatters use controlled clocks', () => {
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-03-08T12:00:00'))
  equal(port.todayISO(),oracle.todayISO());equal(port.isoOf(new Date()),oracle.isoOf(new Date()))
  vi.spyOn(Math,'random').mockReturnValue(.12345)
  equal(port.uid(),oracle.uid());equal(port.localTZ(),oracle.localTZ())
  for(const S of [undefined,{}, {weekStart:0},{weekStart:1},{weekStart:null}]) equal(port.weekStartOf(S),oracle.weekStartOf(S))
  vi.spyOn(Intl,'RelativeTimeFormat').mockImplementation(()=>{throw new Error('synthetic ICU failure')})
  equal(port.fmtAgo(100,200),oracle.fmtAgo(100,200))
  equal(port.fmtDaysAgo('2026-01-01','2026-01-04'),oracle.fmtDaysAgo('2026-01-01','2026-01-04'))
  vi.restoreAllMocks()
}, 60000)
it('pins the deliberate English US date presentation', () => {
  expect(port.fmtDate('2026-10-12')).toBe(new Date('2026-10-12T12:00:00').toLocaleDateString('en-US',{day:'numeric',month:'short'}))
  expect(i18n.dateLocale()).toBe('en-US')
}, 60000)
