import { ux } from './ux'
type BrowserWindow = Window & typeof globalThis
const win = () => ux().window as BrowserWindow | null
/** File and share capabilities are shell-owned; callers cap the size before this read. */
export function readPlanFile(blob: Blob): Promise<string> {
  const Reader = win()?.FileReader
  if (!Reader) return Promise.reject(new Error('File reader unavailable'))
  return new Promise((resolve, reject) => {
    const reader = new Reader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'))
    reader.onabort = () => reject(new Error('File read aborted'))
    reader.readAsText(blob)
  })
}
export function imageURL(blob: Blob): string {
  const api = win()?.URL
  if (!api) throw new Error('Image preview unavailable')
  return api.createObjectURL(blob)
}
export function revokeImageURL(url: string): void { win()?.URL.revokeObjectURL(url) }
export function saveBlob(blob: Blob, name: string): void {
  const doc = ux().document
  if (!doc) throw new Error('Download unavailable')
  const url = imageURL(blob)
  try { const a = doc.createElement('a'); a.href = url; a.download = name; a.click() }
  finally { revokeImageURL(url) }
}
/** true includes dismissal: a dismissed share must not trigger a download. */
export async function shareBlob(blob: Blob, name: string, title: string): Promise<boolean> {
  const w = win()
  const file = w?.File ? new w.File([blob], name, { type: 'image/png' }) : null
  if (!file || !w?.navigator.canShare?.({ files: [file] })) return false
  try { await w.navigator.share({ files: [file], title }) } catch { /* dismissed */ }
  return true
}

/** Application shell binds this capability at boot; a native shell can replace browser printing. */
export type PrintHTML = (html: string) => void
let printHTMLShell: PrintHTML = createBrowserPrintHTML()
export function configurePlanHistoryPrint(print: PrintHTML): void { printHTMLShell = print }
export function printHTML(html: string): void { printHTMLShell(html) }

/**
 * Print a script-disabled document, never the application page. allow-modals permits print;
 * allow-same-origin is strictly required to call the frame's native print() and attach
 * afterprint from the host. An opaque srcdoc origin denies both APIs. Keeping printing in
 * the child preserves the generated @page margins, pagination and break-inside rules.
 * No allow-scripts: even executable markup cannot run or read the host's storage.
 * srcdoc is set before insertion, so no document.write or unsandboxed load is needed.
 */
export function createBrowserPrintHTML(): PrintHTML {
  return html => {
    const doc = ux().document
    if (!doc) throw new Error('Printing unavailable')
    const frame = doc.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;'
    let layoutTimer: ReturnType<typeof setTimeout> | undefined
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      clearTimeout(layoutTimer); clearTimeout(cleanupTimer)
      frame.onload = null
      frame.remove()
    }
    frame.onload = () => {
      layoutTimer = setTimeout(() => {
        const child = frame.contentWindow
        if (!child) { cleanup(); return }
        child.onafterprint = cleanup
        try { child.focus(); child.print() } catch { cleanup() }
      }, 120)
    }
    cleanupTimer = setTimeout(cleanup, 60_000)
    // First bytes enforce a document-wide policy before any supplied markup can load.
    // Inline CSS is required by the generated print layout; no network or script is needed.
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">`
    frame.srcdoc = csp + html
    doc.body.appendChild(frame)
  }
}
