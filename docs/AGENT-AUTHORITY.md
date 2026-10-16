# Agent credential authority

An authenticated device with kind `agent` has an explicit server route allowlist.
The owner's administrator status does not expand that authority. The check applies
to bearer and cookie transport, before body receipt and again before dispatch.
New routes require an explicit decision before agent devices can call them.

Agents can read health/configuration and their own identity, read and conditionally
write their profile data, inspect the data revision/activity guard, and use the
programme library and progression endpoints. Those endpoints retain their own
validation, revision, write-enable and training safeguards.

Agents cannot access authentication/bootstrap, pairing, passkeys, device links,
device management, invites, logout, or administrator routes. They also cannot use
browser push/presence routes. Refusal is `403 {"error":"forbidden"}` and occurs
before an identity handler can issue credentials, cookies or challenges.

`GET /api/me` remains the identity and renewal seam. Renewal of an agent device
keeps the same device id and kind; it does not create a browser or paired device.
Browser and paired devices retain their existing authentication flows. Anonymous
pairing redemption still requires a valid independently created pairing code.
