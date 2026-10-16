export function dockerArgs(args: readonly string[]) {
  const index = args.indexOf('--web-dist')
  const supplied = index >= 0 ? args[index + 1] : undefined
  if (index >= 0 && (!supplied || supplied.startsWith('--'))) throw new Error('--web-dist requires a directory')
  return { dist: supplied ?? 'packages/web/dist', contextOnly: args.includes('--check-context'), probe: args.includes('--probe'), lease: args.includes('--lease-granted') }
}
