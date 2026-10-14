// Migration files are embedded at build time as text (PORTING-RULES R10): no runtime reads from the source tree.
declare module '*.sql' {
  const sql: string
  export default sql
}
