// Legacy fixture mocks retain their broad API shape; unmocked transcripts use W01's real client.
import { api as clientApi } from '../../src/lib/api'
export const api: any = clientApi
export { setRemoteAuth } from '../../src/lib/api'
