import { sha256Hex as coreSha256Hex } from '@opengym/core/sha256'
import { browserSha256Options } from '../platform/browser'
/** Browser digest injection; K01 owns the hash implementation. */
export const sha256Hex = (input: Parameters<typeof coreSha256Hex>[0]) => coreSha256Hex(input, browserSha256Options())
