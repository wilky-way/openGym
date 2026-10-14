import type { AdoptionPrompt } from '../store/sync-engine'
/** The shell binds shared dialog/menu services and file export at boot. */
export interface AuthUiServices {
  askAddDeviceData: AdoptionPrompt
  menuSheet(options: { title: string; items: { icon: string; label: string; onClick(): void | Promise<void> }[] }): unknown
  download(json: string, filename: string): void | Promise<void>
}
let services: AuthUiServices = {
  askAddDeviceData: () => { throw new Error('The device-data question is unavailable. Your data is kept here.') },
  menuSheet: () => { throw new Error('Account menus are unavailable.') },
  download: () => { throw new Error('Backup export is unavailable.') },
}
export function configureAuthUiServices(next: AuthUiServices): void { services = next }
export const authUiServices = () => services
export const askAddDeviceData: AdoptionPrompt = extras => services.askAddDeviceData(extras)
export const menuSheet: AuthUiServices['menuSheet'] = options => services.menuSheet(options)
