Browser adapter (W00)
=====================

`createBrowserPlatform({ buildSha })` creates the frozen `Platform` interface.
Boot owns injection into app code; importing this module has no storage or browser side effects.
Creating the adapter configures W04's browser UX (`configureUx(createBrowserUx())`).
Tests may stub browser globals; lower-level adapter constructors also accept a window.
No build setting selects the API server.

For pairing/configuration, call `configureBrowserServer(platform.kv, origin)` and
`await platform.server.setDeviceToken(token)`. `gym_server_url` stores a validated HTTPS origin;
`gym_device_token` stores the per-device token. Empty origin returns to same-origin cookies;
`setDeviceToken(null)` removes the token. A restored adapter reads both values from the same KV store.

Call `platform.transport.fetch('/api/me', init)` with an API path relative to the server.
The adapter adds the app's reverse-proxy mount for same-origin requests (e.g. `/gym/api/me`).
W01 must not prepend that mount a second time. Absolute third-party URLs retain caller headers
and receive neither the stored device token nor cookies. Remote server requests use Bearer
authentication and omit cookies. Same-origin server requests include cookies.

K02's navigation module consumes `setNavReaders(browserNavReaders())` at boot:
`sheetEntry()` returns the current `history.state.openGymSheet` boolean, while
`currentHash()` returns the current hash (`#/workout`, etc.). The helper also exposes the
approved `onSheetEntry`/`currentRoute` aliases; nav is imported only for its reader type.

W01 supplies native hashing to K01 explicitly:

```ts
import { sha256Hex } from '@opengym/core/sha256'
import { browserSha256Options } from './platform/browser'
const hash = await sha256Hex(bytes, browserSha256Options())
```

The options contain the browser's native `subtle`; an unavailable implementation leaves core
on its pure-JS fallback. W00 does not import the not-yet-integrated K01 implementation.

KV stores unchanged keys and string bytes and translates quota errors to contract `QuotaError`.
IndexedDB uses the new `opengym-platform` cache and resolves writes only after commit. Both
frozen ObjectStore bucket names are available; no deleted legacy upload data is migrated.
SW registration follows legacy's HTTPS gate, with caller-visible registration failures.

Device-token storage boundary
-----------------------------

The browser adapter keeps gym_device_token in Platform KV backed by localStorage for the approved per-device connection contract. This token is readable by JavaScript on the app origin, including injected script if that origin suffers XSS. It is not an HttpOnly credential. The browser adapter owns that persistence; native shells must supply their own Platform storage implementation.
