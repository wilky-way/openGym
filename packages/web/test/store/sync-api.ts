// Legacy fixture mocks keep their broad API shape; unmocked transcripts use the real browser client.
import { api as clientApi } from '../../src/lib/api'
export const api: any = clientApi
export { setRemoteAuth } from '../../src/lib/api'
