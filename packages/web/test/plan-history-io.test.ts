// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureUx, createBrowserUx } from '../src/platform/ux'
import { readPlanFile, saveBlob, shareBlob, imageURL, revokeImageURL, createBrowserPrintHTML, configurePlanHistoryPrint, printHTML } from '../src/platform/plan-history'
beforeEach(() => configureUx(createBrowserUx()))
afterEach(() => vi.restoreAllMocks())
describe('plan/history shell I/O', () => {
 it('reads selected text and reports a reader error or abort', async () => {
  let reader: any
  class Reader {
   result: string | null = null;error: Error | null = null
   onload: (() => void) | null = null;onerror: (() => void) | null = null;onabort: (() => void) | null = null
   constructor(){reader=this}
   readAsText = vi.fn()
  }
  vi.spyOn(window,'FileReader','get').mockReturnValue(Reader as any)
  const first=readPlanFile(new Blob(['plan']));reader.result='plan';reader.onload()
  await expect(first).resolves.toBe('plan')
  const second=readPlanFile(new Blob(['bad']));reader.error=new Error('synthetic read error');reader.onerror()
  await expect(second).rejects.toThrow('synthetic read error')
  const third=readPlanFile(new Blob(['abort']));reader.onabort()
  await expect(third).rejects.toThrow('aborted')
 })
 it('downloads with a filename and revokes the URL even if clicking fails', () => {
  const create=vi.spyOn(window.URL,'createObjectURL').mockReturnValue('blob:plan')
  const revoke=vi.spyOn(window.URL,'revokeObjectURL').mockImplementation(()=>{})
  const names:string[]=[]
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this: HTMLAnchorElement){names.push(this.download);throw new Error('synthetic click failure')})
  const blob=new Blob(['plan'])
  expect(()=>saveBlob(blob,'plan.json')).toThrow('synthetic click failure')
  expect(create).toHaveBeenCalledWith(blob);expect(names).toEqual(['plan.json']);expect(revoke).toHaveBeenCalledWith('blob:plan')
 })
 it('uses file sharing and treats cancellation as handled', async () => {
  const share=vi.fn().mockRejectedValue(new Error('dismissed'))
  Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true})
  Object.defineProperty(navigator,'share',{configurable:true,value:share})
  await expect(shareBlob(new Blob(['png']),'image.png','Workout')).resolves.toBe(true)
  expect(share.mock.calls[0]![0].title).toBe('Workout')
  expect(share.mock.calls[0]![0].files[0].name).toBe('image.png')
 })
 it('signals the download fallback when sharing files is unavailable', async () => {
  Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false})
  await expect(shareBlob(new Blob(['png']),'image.png','Workout')).resolves.toBe(false)
 })
 it('fails shell operations explicitly without browser capabilities', async () => {
  const ux=createBrowserUx();configureUx({...ux,document:null,window:null})
  await expect(readPlanFile(new Blob(['plan']))).rejects.toThrow('unavailable')
  expect(()=>saveBlob(new Blob(['plan']),'plan.json')).toThrow('unavailable')
  expect(()=>imageURL(new Blob(['png']))).toThrow('unavailable')
  expect(()=>revokeImageURL('blob:old')).not.toThrow()
  await expect(shareBlob(new Blob(['png']),'image.png','Workout')).resolves.toBe(false)
 })
})

describe('script-disabled shell print', () => {
 it('binds a native-shell print capability without touching browser frames', () => {
  const shell=vi.fn();configurePlanHistoryPrint(shell)
  printHTML('<h1>Plan</h1>');expect(shell).toHaveBeenCalledWith('<h1>Plan</h1>')
  configurePlanHistoryPrint(createBrowserPrintHTML())
 })
 it('sandboxes before insertion, loads srcdoc, waits for layout and cleans up', () => {
  vi.useFakeTimers()
  const create=document.createElement.bind(document)
  const frames: HTMLIFrameElement[]=[]
  const child={focus:vi.fn(),print:vi.fn(),onafterprint:null as null | (()=>void)}
  vi.spyOn(document,'createElement').mockImplementation(((tag:string)=>{
   const el=create(tag==='iframe'?'div':tag)
   if(tag==='iframe') { frames.push(el as HTMLIFrameElement);Object.defineProperty(el,'contentWindow',{value:child}) }
   return el
  }) as typeof document.createElement)
  const print=createBrowserPrintHTML()
  print('<h1>Plan</h1>')
  const frame=frames[0]!
  expect(frame.getAttribute('sandbox')).toBe('allow-same-origin allow-modals')
  expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts')
  expect(frame.srcdoc).toContain('<h1>Plan</h1>')
  expect(frame.srcdoc).toMatch(/^<meta http-equiv="Content-Security-Policy"/)
  expect(frame.srcdoc).toContain("default-src 'none'")
  expect(frame.srcdoc).toContain("script-src 'none'")
  expect(frame.srcdoc).toContain("base-uri 'none'")
  expect(frame.isConnected).toBe(true)
  frame.onload!(new Event('load'));vi.advanceTimersByTime(119)
  expect(child.print).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1);expect(child.focus).toHaveBeenCalledOnce();expect(child.print).toHaveBeenCalledOnce()
  child.onafterprint!();expect(frame.isConnected).toBe(false)
  print('<h1>Timeout</h1>');vi.advanceTimersByTime(60_000)
  expect(frames[1]!.isConnected).toBe(false)
  vi.useRealTimers()
 })
 it('cleans up when the shell print API fails', () => {
  vi.useFakeTimers()
  const print=createBrowserPrintHTML();print('<h1>Fail</h1>')
  const frame=document.querySelector('iframe')!
  Object.defineProperty(frame,'contentWindow',{value:{focus(){},print(){throw new Error('denied')}}})
  frame.onload!(new Event('load'));vi.advanceTimersByTime(120)
  expect(frame.isConnected).toBe(false);vi.useRealTimers()
 })
})
