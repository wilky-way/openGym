// Only differential tests import frozen JavaScript fixtures.
declare module '*packages/parity/fixtures/oracle/frontend/src/lib/demoSeed.js' { export const buildDemoState: (...args: any[]) => any }
declare module '*packages/parity/fixtures/oracle/mcp/src/tools.js' { export const TOOLS: any[] }
declare module '*packages/parity/fixtures/oracle/mcp/src/state.js' { export const _seedStateForTests: (state: any) => void }
declare module '*packages/parity/fixtures/oracle/frontend/src/lib/programme-agent.js' { export const applyProgrammeAgentAction: (...args: any[]) => any }

declare module '*packages/parity/fixtures/oracle/mcp/src/programme-tools.js' { export const mutateProgramme: (...args: any[]) => Promise<any> }
