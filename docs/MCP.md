# MCP and local agents

The MCP process uses **stdio** to talk to a local agent. Its workout and programme operations talk to the openGym server over **authenticated HTTP**; there is no server-side `/mcp` endpoint and no direct access to the server database. Pure draft operations work locally without API credentials. Draft authoring is supported on **macOS and Linux only**; Windows authoring is deliberately refused.

Install dependencies from the repository and sign in to the intended profile. In Settings → Account → Pair another device, create a one-time pairing code. The code lasts five minutes and works once; it is not the API token. Redeem it with `POST /api/pair/redeem` and JSON `{ "code": "YOUR_ONE_TIME_CODE" }`. The response contains `token` and `user`; use `token` as `OPENGYM_TOKEN` and `user.id` as `OPENGYM_UID`. This creates a dedicated paired device credential for the local agent. Keep the response private, configure the bridge locally, and revoke that device from Settings when no longer needed.

For example, in a private directory outside the repository, save the one-time code as `pair-code.json`, then run `curl --fail --header 'Content-Type: application/json' --data @pair-code.json --output pairing.json http://localhost:8080/api/pair/redeem`. Use your HTTPS server URL for a remote instance. Transfer the token into your client's local secret configuration and remove both temporary files; never commit them or paste their contents into chat. The bridge requires `OPENGYM_URL`, `OPENGYM_UID`, and `OPENGYM_TOKEN` for remote tools. HTTP is accepted only for loopback addresses; other hosts require HTTPS. Redirects are refused and credential diagnostics are redacted.

## Local Claude setup

Add a local stdio MCP server using `bun` as the command and the absolute path to `packages/mcp/src/index.ts` as its argument. A configuration shape for a client that supports `mcpServers` is:

```json
{
  "mcpServers": {
    "opengym": {
      "command": "bun",
      "args": ["/path/to/openGym/packages/mcp/src/index.ts"],
      "env": {
        "OPENGYM_URL": "http://localhost:8080",
        "OPENGYM_UID": "your-profile-id",
        "OPENGYM_TOKEN": "<insert-agent-token-locally>"
      }
    }
  }
}
```

Use the same command, arguments, and environment for a Codex MCP server. Keep the configuration local; do not commit credentials. Install the [agent skills](AGENT_SKILLS.md) separately from credentials. The example token is a placeholder and cannot authenticate.

| Variable | Purpose |
| --- | --- |
| `OPENGYM_URL` | HTTP API base URL, including any deployment prefix |
| `OPENGYM_UID` | Intended authenticated profile ID; mismatch is refused |
| `OPENGYM_TOKEN` | Agent/profile Bearer credential |
| `OPENGYM_AUTHORING_DIR` | Optional local draft store outside repositories and sync roots |
| `OPENGYM_ENABLE_PROGRAMME_AUTHORING` | `1` permits draft changes; otherwise authoring writes are refused |
| `OPENGYM_ENABLE_PROGRAMME_WRITES` | `1` permits remote programme actions and workout history writes; otherwise writes are refused |

Default authoring directories: macOS `~/Library/Application Support/opengym-authoring`; Linux `${XDG_DATA_HOME:-~/.local/share}/opengym-authoring`. Local edits and remote writes are separate permissions. Remote publish/apply require both gates and explicit per-call confirmation. Publishing a draft adds it to your **private server library**, never to a public repository.

## Tool reference

[MCP-TOOLS.md](MCP-TOOLS.md) and [mcp-tools.json](mcp-tools.json) are generated from the shipped tool registry and contain every tool description and input schema. Read the schema before calling a tool: extra keys are refused. The main groups are workout/routine/history reads, conditional programme lifecycle actions, local draft authoring, library inspection/publish, and progression validate/preview/apply.

Regenerate both references with `bun packages/mcp/scripts/generate-docs.ts`.

## Log a past workout

`log_workout` defaults to `dry_run:true`: it authenticates and returns the exact proposed record, resolved exercise IDs, and any created exercise without saving. Use catalogue IDs or unambiguous names; ambiguous matches return choices. Dates are local `YYYY-MM-DD`, must be today or earlier, and the default 18:00 start plus duration must already have elapsed. Rep sets and timed sets are supported; supplied units are converted to the profile unit. Notes and an optional `routine_id` are supported. Freestyle logs have no programme effect; routine-linked logs use the same filing and programme advancement as the app.

For example, preview this entirely invented session (choose a past date):

```json
{
  "date": "2026-01-12",
  "name": "Synthetic strength session",
  "duration_min": 45,
  "notes": "Invented example only",
  "exercises": [
    { "exercise": "0025", "sets": [
      { "reps": 8, "weight": 40, "unit": "kg" },
      { "reps": 8, "weight": 40, "unit": "kg" }
    ] }
  ],
  "dry_run": true
}
```

Review the returned record before explicitly sending `dry_run:false`. Saving requires `OPENGYM_ENABLE_PROGRAMME_WRITES=1`, the intended authenticated profile, and a profile previously synced through the app with a write ID. The local authoring gate is not required for history tools. The bridge uses conditional revision/write-ID updates and rereads after conflicts; it refuses a server-visible active workout. It cannot detect an unsynced phone-local session.

`delete_workout` is a narrow undo: `{ "workout_id": "<id returned by log_workout>", "confirm": true }`. It requires the same write gate and no server-visible active workout, and only accepts an unchanged, agent-created record sealed by `log_workout`. Editing the record invalidates MCP undo; use the app to delete it instead. It has no dry-run mode. Never claim a workout was saved after a preview, and inspect history before retrying an uncertain write acknowledgement.

## Author a programme and its progression

1. Read `get_programme`, `programme_position`, `list_routines`, and `list_programmes` to identify the profile and current revision. `preview_session` shows the prescription the athlete will actually open, including routine progression.
2. Create a private draft with `create_program_draft`. Use stable week/day/session/slot identities and current draft revision with `patch_program_draft`, `set_slot`, `set_slot_targets`, `set_progression`, or `set_progression_rule`. Never import proprietary programme text into a shared export.
3. Inspect `get_program_draft` and fix conformance issues. `validate_progression` accepts exactly one of a JSON definition, a draft ID, or a programme ID. Validation is pure and does not apply a rule.
4. Call `preview_progression` for explicit weeks. It returns prescribed sets/loads with a `Why`; `full:true` includes inputs and the training-max timeline. Hypothetical logs are optional preview inputs, not recorded workouts.
5. Compare with `diff_programs`. Run `publish_program_draft` with its default dry run, expected draft revision, and expected library parent version. Only a `Ready` draft can be published. Existing IDs require `replace:true`; active/paused definitions must be cloned. Obtain explicit authorization before `dry_run:false, confirm:true`.
6. `apply_progression` defaults to a dry run. A real apply requires `dry_run:false`, `confirm:true`, current `expected_rev` and `expected_wid`, both write gates, and explicit `confirmNoActiveSession:true`. An inventory adjustment requires its own `confirmInventoryAdjustment:true`; never automatically supply that confirmation. Refusals for changed revisions, past weeks, training in progress, or invalid rules require a fresh read and review.

Supported rule kinds: percentage, RPE load, double progression, linear increments, AMRAP training-max changes, stall responses, scheduled deload, and volume ramp. Rules are versioned JSON interpreted deterministically. A slot without attached rules retains its manually authored target. The logged value wins over a prediction.

`generate_deload` previews by default. Supply all factors and effort targets explicitly; it has no implicit intensity or volume defaults. Apply to the draft only with `confirm:true` and the expected revision, then validate and preview again. The agent should explain the proposed change and its affected weeks before a remote write.
