import type { SettingsTarget } from './settings-target'
export interface SettingsAServices {
  confirmSheet(options: { title: string; message: string; confirmText: string; danger?: boolean; onConfirm(): unknown }): unknown
  menuSheet(options: { title: string; subtitle?: string; items: { icon: string; label: string; danger?: boolean; onClick(): unknown }[] }): unknown
  download(text: string, filename: string): void | Promise<void>
  /** The shell binds imports; captured targets travel through async and confirmation callbacks. */
  importFromApp(file: File, target: SettingsTarget): unknown
  importFromHevy(target: SettingsTarget): unknown
}
const missing = () => { throw new Error('Settings services are not initialized. Your data is kept.') }
let services: SettingsAServices = { confirmSheet: missing, menuSheet: missing, download: missing, importFromApp: missing, importFromHevy: missing }
export function configureSettingsA(next: SettingsAServices): void { services = next }
export const settingsAServices = () => services
