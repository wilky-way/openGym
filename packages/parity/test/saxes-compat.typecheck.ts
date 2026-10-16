import { SaxesParser, type OpenTagStartHandler, type AttributeHandler, type OpenTagHandler, type CloseTagHandler, type EventNameToHandler } from 'saxes'

// Compile-only invented fixtures. An unused expect-error is a failing type check.
// @ts-expect-error options must satisfy SaxesOptions
 type InvalidStart = OpenTagStartHandler<{xmlns: 'invalid'}>
// @ts-expect-error options must satisfy SaxesOptions
 type InvalidAttribute = AttributeHandler<{xmlns: 'invalid'}>
// @ts-expect-error options must satisfy SaxesOptions
 type InvalidOpen = OpenTagHandler<{xmlns: 'invalid'}>
// @ts-expect-error options must satisfy SaxesOptions
 type InvalidClose = CloseTagHandler<{xmlns: 'invalid'}>
// @ts-expect-error options must satisfy SaxesOptions
 type InvalidEvent = EventNameToHandler<{xmlns: 'invalid'}, 'text'>

function inventedTypeControls() {
  const plain = new SaxesParser({xmlns: false})
  const namespaced = new SaxesParser({xmlns: true, defaultXMLVersion: '1.1'})
  const defaultParser = new SaxesParser()
  defaultParser.write('<invented/>').close()
  plain.on('opentag', tag => {
    const name: string = tag.name
    const attr: string | undefined = tag.attributes['invented']
    // @ts-expect-error plain tags have no namespace URI
    const uri: string = tag.uri
    return [name, attr, uri]
  })
  namespaced.on('opentag', tag => {
    const uri: string = tag.uri
    const attr: string | undefined = tag.attributes['invented']?.uri
    // @ts-expect-error namespace tags retain object-valued attributes
    const wrong: string | undefined = tag.attributes['invented']
    return [uri, attr, wrong]
  })
  // @ts-expect-error option values are checked
  new SaxesParser({xmlns: 'invalid'})
  // @ts-expect-error XML version literals are checked
  new SaxesParser({defaultXMLVersion: '2.0'})
  // @ts-expect-error event names are checked
  plain.on('invented-event', () => {})
  // @ts-expect-error event payload is a tag, not a number
  plain.on('opentag', (tag: number) => {})
}
void inventedTypeControls
