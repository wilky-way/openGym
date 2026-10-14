import { ux } from './ux'
/** Browser camera is a shell capability; native shells inject their own implementation. */
export interface CameraPlatform {
  supported(): boolean
  open(): Promise<MediaStream>
}
const browserCamera: CameraPlatform = {
  supported: () => !!ux().window?.navigator.mediaDevices?.getUserMedia,
  open: () => {
    const devices = ux().window?.navigator.mediaDevices
    if (!devices?.getUserMedia) return Promise.reject(new Error('Camera unavailable'))
    return devices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
  },
}
let current = browserCamera
export function configureCamera(adapter: CameraPlatform): void { current = adapter }
export function camera(): CameraPlatform { return current }
