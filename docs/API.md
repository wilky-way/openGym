# HTTP API

The Bun server exposes JSON routes under `/api`. Pass a profile token as `Authorization: Bearer <token>` or use the same-origin session cookie. Never include credentials in URLs. Cookies retain CSRF checks on unsafe requests even when a Bearer header is also present. The configured origin is the CORS allowlist; use the same origin for browser requests. Health and rate-limited authentication bootstrap routes are unauthenticated; profile and administrator operations require their respective permissions.

The complete request/response types live in [the HTTP contract](../packages/contract/http/api.ts); [runtime request validators](../packages/contract/src/validators.ts) and the server enforce body and reference constraints. Historical compatibility comments and retired-route declarations in the contract do not override current secure runtime behavior described here. The generated [HTTP-ROUTES.md](HTTP-ROUTES.md) lists the contract's route-policy inventory, with retired media routes omitted.

| Operation | Route |
| --- | --- |
| Health/config | `GET /api/health`, `GET /api/config` |
| Current account | `GET /api/me` |
| Profile state/revision | `GET /api/data`, `GET /api/data/rev` |
| Conditional state write | `PUT /api/data` |
| Programme library | `GET /api/programmes/library`; `GET/PUT /api/programmes/library/:id`; `GET /api/programmes/library/:id/versions` |
| Programme conformance | `POST /api/programmes/validate` |
| Programme lifecycle | MCP activation/shift/skip uses a conditional `PUT /api/data`; no separate lifecycle HTTP endpoint |
| Rule validation | `POST /api/progression/validate` |
| Rule preview | `POST /api/progression/preview` |
| Rule apply | `POST /api/progression/apply` |

## Whole-document state

`GET /api/data` returns `{state, rev}`; absent state is `null`, while unreadable storage is an error. `GET /api/data/rev` is a lightweight revision check. Preserve every unknown key in a document: the server stores the document verbatim and extensions may add fields.

For an authorized workout-log integration, fetch the current document, modify only the intended log fields, and send:

```json
{
  "state": {"...": "the complete updated document, not a partial patch"},
  "baseRev": 12,
  "baseWid": "the-writer-epoch-returned-in-state",
  "stamped": false
}
```

`baseRev` is the revision read; `baseWid` must match `state._wid`, or `null` when absent. The snippet is a shape illustration, not executable fixture data. Server stamping is appropriate for an integration that does not implement the app's stamp protocol. Client `_rev`/`_wid` are not authoritative and active workout state is stripped. A successful write returns `{ok, ts, rev, wid}`; read again before the next change because the stored stamped revision may differ from the acknowledgment revision. Never omit conditional fields to bypass a conflict. HTTP 409 returns current state/revision: stop, inspect concurrent changes, and rebuild the intended edit after authorization.

Do not send only one new workout as the whole `state`: this endpoint is not a log append API. Prefer the app's set-entry flow unless you deliberately implement the full document contract. Requests are capped at 5 MiB and have a receipt deadline.

## Progression

- Validate: send `{definition}` to `/api/progression/validate`; the response contains validation status/issues and performs no write.
- Preview: send `{source: {definition}, weeks: [1]}` to `/api/progression/preview`; a library source can use `{definitionId, versionId?}`. Optional `cycleId`, `asOf`, and `hypotheticalLogs` affect the preview only. Sets include prescribed loads and their `Why` explanations.
- Apply: send `{cycleId, weeks, expectedRev, expectedWid, confirmNoActiveSession: true, dryRun: true}` to `/api/progression/apply` first. A real change uses `dryRun:false` only after explicit approval. Returned inventory-adjustment warnings require separate `confirmInventoryAdjustment:true`. Past weeks, inactive cycles, live training, invalid references, and stale stamps are refused.

MCP uses snake_case wrappers for several arguments; the HTTP API uses the camelCase fields above. Consult [MCP.md](MCP.md) for draft privacy, write gates, and agent confirmations.

## Errors

Errors contain an `error` string and may contain a machine-readable `code`, validation issues, or `retryAfter`. Typical statuses are 400 malformed input, 401 signed out, 403 wrong permission/origin, 409 revision/version conflict, 413 oversized body, 422 invalid programme/rules, 423 training in progress, 429 throttled, and 503 unreadable storage. Honor `Retry-After`; never automatically retry a refused mutation with weakened guards.
