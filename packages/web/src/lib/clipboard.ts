import { clientCapabilities } from './client-io'
export const copyText = (text: string): Promise<boolean> => clientCapabilities().copyText(text)
