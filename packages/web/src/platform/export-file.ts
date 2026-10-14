/** Injectable shell capability; the browser keeps legacy FileReader decoding/error semantics. */
export interface ExportFileReader {
  readText(file: Blob): Promise<string>
  readChunks?(file: Blob): AsyncIterable<Uint8Array>
}
const browserReader: ExportFileReader = {
  readText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(file)
    })
  },
}
let current = browserReader
export function configureExportFileReader(reader?: ExportFileReader): void { current = reader ?? browserReader }
export function readExportText(file: Blob): Promise<string> { return current.readText(file) }

/** Stream in the browser; bounded slices support shells without Blob.stream. */
export async function* readExportChunks(file: Blob): AsyncIterable<Uint8Array> {
  if (current.readChunks) { yield* current.readChunks(file); return }
  if (typeof file.stream === 'function') {
    const reader = file.stream().getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        yield value
      }
    } finally { await reader.cancel(); reader.releaseLock() }
  } else {
    for (let offset = 0; offset < file.size; offset += 64 * 1024) {
      yield new Uint8Array(await file.slice(offset, offset + 64 * 1024).arrayBuffer())
    }
  }
}
