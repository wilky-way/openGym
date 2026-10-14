import { dlopen, FFIType, ptr } from 'bun:ffi'
import { error } from './http-client'

// Node's fs.openSync has no directory-relative open. Pin entry opens to the
// checked directory descriptor so an ancestor replacement cannot redirect them.
const libc = () => dlopen(process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6', {
  openat: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
  mkdirat: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
})
let native: ReturnType<typeof libc> | undefined
export function openAt(directoryFd: number, name: string, flags: number, mode = 0): number {
  if (!['darwin', 'linux'].includes(process.platform)) throw error('CONFIG_REQUIRED', 'Private authoring storage requires a macOS or Linux host.')
  if (name.includes('/') || name.includes('\0')) throw error('EINVAL', 'Use a single draft database entry name.')
  native ??= libc()
  const filename = Buffer.from(name + '\0')
  const fd = native.symbols.openat(directoryFd, ptr(filename), flags, mode)
  if (fd < 0) throw error('PRIVATE_EXPORT', 'Draft database file changed or is unsafe to open.')
  return fd
}
export function mkdirAt(directoryFd: number, name: string): void {
  if (name.includes('/') || name.includes('\0')) throw error('EINVAL', 'Use a single authoring directory name.')
  native ??= libc()
  const filename = Buffer.from(name + '\0')
  if (native.symbols.mkdirat(directoryFd, ptr(filename), 0o700) < 0)
    throw error('PRIVATE_EXPORT', 'Authoring directory changed or is unsafe to create.')
}
