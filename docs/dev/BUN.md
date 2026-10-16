# Bun runtime

Bun 1.4.1 runs the server, MCP, build tools and tests. The root `.tool-versions` pins the supported runtime. Install frozen workspace dependencies with `bun install --frozen-lockfile` for development.

The strict TypeScript packages are contract, core, web, server, MCP and parity. Core is pure domain code; web uses React/Vite, the server uses Bun/SQLite, and MCP uses stdio plus authenticated HTTP. Package `typecheck` scripts run the matching strict TypeScript project.

Use the root `test:contract`, `test:core`, `test:web`, `test:server`, `test:mcp`, `test:parity` and `test:foundation` scripts. Vitest suites run through Bun; server tests run in fresh isolated Bun children per file. A full public gate uses sequential suites, one worker and both America/Chicago and UTC. Test children need normal umask022 because mode-safety fixtures check ordinary untouched files. Keep private logs separately protected.

The bounded independent oracle uses Node22.23.3 as its recorded compatibility baseline. Its exact path/hash/mode manifest is separate from the current runtime; no private historical checkout is required. See the parity README for scope and dependencies.

`bun run build` builds web assets and the compiled Bun server. Build output is ignored. Builds do not update any running service; deployment is a separate action.
