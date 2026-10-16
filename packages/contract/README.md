# openGym contracts

Shared strict TypeScript types, request validation, synchronization rules, storage schema and generated programme/core declarations. The runtime route policy and validators are the authority for supported requests; historical compatibility comments do not expand it.

- `domain/state-doc.ts`: state shape, unknown-field preservation and native row identities.
- `domain/programme-model.schema.json`: generated current model, including progression rules, max basis and native per-set prescriptions.
- `domain/progression.ts`: deterministic progression rules and Why explanations.
- `http/api.ts` and `src/validators.ts`: routes, gates and request shapes.
- `sync/` and `storage/`: synchronization ordering, write ownership and persistence.
- `platform/adapters.ts`: browser I/O boundary.
- `mcp/MCP-CONTRACT.md`: agent tool behavior; the current generated tool inventory is authoritative.

`scripts/contract-manifest.json` freezes this public-derived contract. Its hashes describe the public source after reviewed URL and prose changes, rather than the historical private release freeze. `bun run gen:model --check` verifies the current schema and generated types; `bun run gen:core-api --check` uses the separately frozen bounded public oracle for the inherited export surface. Additive native exports have explicit core declarations. Differential tests preserve the inherited schema while asserting new fields separately.

Preserve unknown extensions, ordering and strict validation. Contract corrections require concrete behavior evidence and the corresponding tests; do not widen types or remove assertions to bypass a mismatch.
