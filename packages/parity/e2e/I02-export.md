# Export receipt hygiene

This command fragment documents immediate credential-file cleanup for a separately
authorized, disposable integration rehearsal. Checker fixtures are invented inputs,
not receipts of browser, authentication, cache, rollback, or container execution.

```sh
  curl --fail --config "$CUTOVER_DIR/curl.conf" "$ORIGIN/api/data" > "$CUTOVER_DIR/api-data-before.json"
  rm -f "$CUTOVER_DIR/curl.conf"
```

The directory must be owned and private. Supply newly measured receipts to
`bun packages/parity/e2e/I02-assert.mjs --evidence-dir <directory>`. No receipt
directory is inferred from a checkout or historical private release.
