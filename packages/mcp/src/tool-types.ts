import type { ZodRawShape } from 'zod'
/** Legacy tools accept open sync shapes and produce JSON projections. */
export interface Tool { name: string; description: string; schema: ZodRawShape; handler: (params: Record<string, any>) => any; withRedaction?: <T>(run: () => T) => T }
