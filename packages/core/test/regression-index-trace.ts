// Test-only call observations: invoke the real helper, with its real arguments.
// Needed for redundant forwards (policyFor already has mode; usesBar has an object)
// and short-circuit predicates whose missing index can be masked by the next clause.
export const indexTrace = {
  enabled: false,
  calls: [] as { site: string; args: unknown[] }[],
}
export function traceIndexCall<T>(site: string, fn: (...args: never[]) => T, ...args: unknown[]): T {
  if (indexTrace.enabled) indexTrace.calls.push({ site, args })
  return fn(...args as never[])
}
