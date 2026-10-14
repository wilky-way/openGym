/** Strict API for the Saxes runtime facade (TS 7 cannot check its upstream .d.ts). */
export function createXMLValidator(): { write(text: string): unknown; close(): unknown; bufferLength(): number }
