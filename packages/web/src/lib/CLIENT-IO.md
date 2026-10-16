# Client boot (W01)

After creating the Platform and before rendering the app, configure the clients:

```ts
configureClientIO(platform, shellCapabilities)
refreshApiCapabilities()
setNavReaders(browserNavReaders())
await setLang('en')
```

`createBrowserPlatform()` configures W04's UX adapter. `configureClientIO` defaults to
`createBrowserClientCapabilities(platform)` for the browser; a Tauri shell supplies the same
capability interface. `refreshApiCapabilities` refreshes the legacy live exports
`IS_APPLE`, `IS_ANDROID`, `BIO` and `VAULT` from that shell. `setLang` initializes the
lazy English details loader and its online retry listener. Explicit `initializeI18n()`
returns a teardown function for hosts/tests that need to stop the listener.

`api(path, options)` preserves the legacy request/error behavior. The additive
`apiRoute(route, body, query)` checks request and response types against the frozen
HTTP route table; parameterized routes use the legacy API with a resolved path.
All requests, including Hevy and pairing diagnostics, call `platform.transport`.
Pass a relative `/api/...` path; Platform owns the endpoint, bearer, cookie and
same-origin proxy mount. Do not prepend `appBase()` yourself.

`sha256Hex(input)` in this directory calls K01 with `browserSha256Options()`; core
keeps its pure default. Hevy callers may pass the real ExerciseIndex as a trailing
argument to `importHevyData`. Keys are held only for that import and never stored.

Connection changes return a promise: await `setRemoteAuth(baseUrl, token)` before
sending authenticated requests. Browser token failures restore the prior endpoint;
a native shell supplies `ClientCapabilities.connection` to configure its own
endpoint and keychain without browser KV keys.
