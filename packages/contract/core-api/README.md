# Frozen legacy module declarations

TS 7 `--declaration --allowJs --emitDeclarationOnly --noCheck` emits every non-test
`packages/parity/fixtures/oracle/frontend/src/lib/*.js` module (browser helpers included, so no export vanishes).
`bun run gen:core-api` applies the checked-in corrections; `--check` verifies all output.
Missing optional properties in destructured options are restored as `unknown`, and clear
numeric bar/backoff signatures are corrected. All declarations compile with skipLibCheck=false.

F1fix (contract 1.2.0) pins legacy call-site optionality, nullable plate/bar answers,
owned-weight arrays, the exercise index and dynamic bar keys. The temporary test-only
`loose.ts` shim has no allowlisted consumers; boundary lint rejects every import.
Affected units: K01–K18 and their downstream web/server/MCP consumers must rerun gates.

The unannotated JS still infers dynamic `any` on many passthrough inputs/outputs; this is
confined to the contract declarations, not an authorization to add any to core/server code.
Ports preserve the signatures and replace dynamic values with domain shapes as reviewed;
a disputed legacy shape follows the frozen contract's change protocol. No declaration
imports implementation from legacy or an inert root source tree. Vitest's whole-graph
fallback is the only runtime oracle alias; production sees these declarations only.
