# M01 porting changes

- HTTP-only state replaces legacy file discovery, fs.watch and mtime polling. The state test names remain, with transport failures (`API_REFUSED`/`API_UNAVAILABLE`) instead of EIO, and explicit OPENGYM_UID instead of automatic directory/roster discovery. Server filesystem paths and account rosters never enter a tool result. No assertion-count reduction.
- Legacy tool/label/programme test names and assertions remain. The test-only PROFILE_TOOLS projection permits the original synchronous fixture assertions; public TOOLS always run authenticated HTTP reads.
- The private-library guard twin remains owned by F0 and runs in the mandatory foundation gate; M01 inventories all four other legacy MCP test files.
- Custom exercises use an explicit immutable index instead of temporary global registerCustom mutation (R2). Legacy golden fixtures remain identical. Custom assistance/timed-equipment classification now matches the profile's own index, as mandated by the cross-unit ruling.

## M02 — new authoring surface

New MCP authoring tools and local SQLite draft store have no legacy twin; M01 retains the legacy tools.
M02 changes the M01 startup test to permit token-free local authoring and expands the registered tool count to 26; legacy HTTP tools continue authenticating per call.
All synthetic authoring acceptance cases live in `test/authoring.test.ts` (no paid programme names or content).

## M03 — new library surface

New library list, keyed programme diff and explicit draft publication have no legacy test twin; M01 retains the legacy tools.
Publication targets the library rather than the PROGRAM-API state upsert, as mandated by MCP-CONTRACT.
The explicit safety policy adds dry_run:true by default and requires confirm:true with dry_run:false.

## P6 — new progression surface

New MCP progression tools and declarative draft rule operations have no legacy twins; M01 retains the complete legacy MCP inventory.
Apply adds the same explicit confirmation and both environment write gates as publish.
The native Bun acceptance suite runs the real S04/P5 app in process in both timezones;
the ordinary MCP suites retain all legacy assertion inventories.

## M04 — new workout logging surface

New agent workout log/undo tools; shared historical session construction and filing retain W14/K14 behavior, whose legacy inventories remain unchanged.
The new tests cover dry-run and write gates, byte equality with the UI core helper,
exercise resolution and custom bodyweight fallback, conditional rebase and undo tombstones.
The existing M01/K14/W14 twins and assertion counts are retained without waivers.
