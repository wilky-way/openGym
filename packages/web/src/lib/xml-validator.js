import { SaxesParser } from 'saxes'
// Saxes 6's declarations have four unconstrained generics rejected by TS 7 strict.
// Isolate that dependency behind this typed facade; never relax app typechecking.
export function createXMLValidator() {
  const parser = new SaxesParser()
  parser.on('error', error => { throw error })
  return {
    write: text => parser.write(text),
    close: () => parser.close(),
    // Saxes accumulates text/CDATA/DOCTYPE in this buffer between events.
    bufferLength: () => parser.text.length,
  }
}
