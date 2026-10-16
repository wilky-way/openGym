# Training write guard

Agent whole-document and progression applies check durable auxiliary metadata in the same
SQLite IMMEDIATE transaction as the document write. The authenticated credential's device kind
identifies agents; a request body cannot opt out. Every guarded PUT requires exact `baseRev`
and `baseWid`. Non-agent carriers can opt into the same atomic fence with `requireIdle:true`
(the new MCP template tools always do this as well). Browser and paired v2 devices establish an idle
observation with an explicit `state.active: null` and the current `baseRev` and `baseWid`.
A device PUT with active training records only its start timestamp and a hash of session id + start (plus saved-workout editor identity/incarnation), its device ownership,
a random lease and heartbeat time. `/api/activity` heartbeats also establish active markers before
a document push. No running workout body or credential is saved in the marker.

`GET /api/data/activity` returns `status: active | idle | unknown`; only trusted browser/paired
credentials receive their own `{lease, session}` close proof. Missing metadata and expired active
heartbeats are unknown. At 70 seconds the active heartbeat expires to unknown, never idle.
Both active and unknown block agent writes with HTTP 423 `TRAINING_NOW` and `guardStatus`.
Reads remain available. Revoking a device or restarting the server does not clear its marker.

A successful exact-revision PUT with `active: null` and the matching finished workout closes only
that device's ordinary session. Historical editors retain the saved workout id/start, so their
separate W28 `editBase.sheetInstanceId` incarnation participates in the guard hash. The historical
row already in `workouts` never proves its editor ended. Editors heartbeat with `editingWorkoutId`
and `editorInstanceId`; guarded Save, delete and cancel callbacks send an authenticated close with
those captured fields, `reason:editor-closed`, profile id and session id/start. A stale callback
cannot close a reopened incarnation. A missed close stays fenced; resend the exact close or use
the owning device's lease proof only after verifying the local editor has ended. An explicit discard/idle confirmation can instead pass `trainingClose`
with its own current `{lease, session}`, plus the current document `baseRev` and `baseWid`.
Each device/session has a separate record and lease; stale or peer proofs cannot close a different
session, even with identical start timestamps or device clock rollback. A trusted client must only
send this confirmation after verifying that its local session has ended. Omitting active,
agent writes, hidden/closed/navigated presence events, and passage of time never clear training.
The normal browser Discard callback also sends an explicit `/api/activity` close with
`active:false`, `reason:discarded`, the captured profile id and exact session id/start, only after its
guarded local discard succeeds. The server closes only that authenticated device's matching marker,
including an expired marker. A newer session or another device remains protected. Its retained start
tombstone rejects delayed heartbeats from that exact discarded session. A failed/offline discard notification
leaves the guard unknown; the owning device can resend that exact discard close, or use its current
lease/session close proof in a conditional PUT. Neither recovery can close a different session. Heartbeats lacking a session id can refresh only a
unique known session with that start; ambiguous/unidentified legacy activity remains fenced until a
trusted owning-device lease close. A guessed timestamp finish cannot clear an unidentified session.
Older v1 credentials cannot establish idle, because they do not carry trustworthy device kind.
Their authenticated active PUTs and heartbeats are positive observations and always fence agents,
including after a different device established idle. Their omission, finished history, idle signals
and expiry cannot close any marker. After upgrading via the normal authenticated `/api/me` renewal,
the new trusted device can read and conditionally close its exact own lease/session proof. The
existing server-authenticated predecessor binding retains ownership of the legacy hash marker;
peers cannot obtain or use that proof. Confirm local training ended before closing, and repeat for
any other own outstanding marker. No timestamp guess or credential revocation attests closure.

Editors without a valid incarnation are conservatively marked legacy/unidentified. They require
an explicit trusted own lease close after verifying Save/cancel completed. W28 stamps new editors
on persistence; reload/upgrade old clients. An unidentifiable editor or v1 positive observation can
fence again after a close because it cannot prove a distinct incarnation. Exact identified v2
session/editor tombstones continue rejecting delayed active messages.

Limits: the server cannot detect a never-synced offline session, or a local start before the first
heartbeat reaches it. Finish uploads that lack a revision/write identity cannot clear a marker.
Ordinary session identity uses both the persisted session id and start timestamp; clients must assign a
fresh identity to every new session. Closed identity tombstones are retained and do not expire. Idle attestations do not prove another
registered device is online. These are conservative write guards, not remote workout recovery.

Metadata lives in the existing `meta` auxiliary-index store and needs no schema migration. Rollback
can keep the metadata, but an older server will not enforce the guard. Deploy server and MCP as a
matched release and back up first using the normal operator workflow.

## Agent compare-and-write seam

For any new agent action (including training-max edits), authenticate `/api/me` and verify the
configured profile, then read `GET /api/data` for `{state, rev}` and `state._wid`. Bind the preview to
that exact revision, write identity, canonical full-document fingerprint and normalized action input.
`GET /api/data/activity` supplies the read-only `status` for previews; unknown never authorizes apply.
At apply, validate that binding against a fresh authenticated document and send exactly one
`PUT /api/data` with the complete preserved state and this envelope:

```json
{"state":{"complete":"mutated profile document"},"baseRev":123,"baseWid":"exact-preview-write-id","stamped":true,"requireIdle":true}
```

`stamped:true` means the caller already applied the normal `stampChange`/deletion clocks. An
unstamped caller may omit it and use the existing server stamper, while still preserving unknown
fields. `requireIdle:true` opts every credential carrier into the atomic training fence. Credentials
whose device kind is `agent` are always fenced regardless of that flag. Never send `trainingClose`
or synthesize an idle observation from an MCP action.

The server checks revision/write identity and current durable training markers inside the same
IMMEDIATE transaction that commits the document. HTTP 423 carries `code:TRAINING_NOW` with
`guardStatus:active|unknown`; HTTP 409 is a revision/identity refusal. Neither is a retry/rebase signal.
A missing/unsupported activity endpoint also fails closed. Check `{ok:true, rev, wid}` and seal undo
against the exact readback write identity and fingerprint; an uncertain network result needs a fresh
inspection before any new action. Preview tokens/fingerprints are an MCP responsibility, never an
untrusted replacement for the server's final atomic checks.

Server-side integrations that call `DataService.compareAndWrite` directly must forward the freshly
revalidated authenticated `Session` as its third argument, as progression apply does. Omitting that
argument is reserved for trusted internal setup/import code, not authenticated agent routes.

## Agent credential authority and recovery limits

The server admits dedicated kind `agent` credentials only to the explicit coaching/data route
allowlist documented in [agent authority](AGENT-AUTHORITY.md). Agents cannot pair/redeem a
credential, manage devices, use invites/admin or call browser activity endpoints, regardless of
owner administrator status or bearer/cookie transport. Own bearer renewal retains device id/kind.
Trusted browser and paired device sync remains available while agents are fenced.

An unidentified/legacy marker has no ordinary client close UI. Recovery is an explicit trusted
own-lease operator/API action after verifying the owning device successfully saved, cancelled,
finished or discarded its local editor/session. Upgrading an old client does not prove closure.
Failed/offline close delivery remains fenced; expiry becomes unknown. The intended launcher must
use an operator-issued kind `agent` credential; GM/SM verify carrier kind for matched-release
acceptance without exposing the credential. This unit does not inspect or migrate live launchers.
