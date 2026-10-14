# Self-hosting

Use Bun 1.4.1 and the source build in the README. SQLite and its mirrors live in `DATA_DIR`; never put this directory in the source repository. A single compiled server can serve `packages/web/dist`; Compose instead uses an unprivileged nginx web container and a compiled Bun API. The API build context is the repository root, not `api/`. Run `bun run build:web` before `docker compose build` because the web image consumes that output.

For the direct server, run `bun scripts/prepare-static.ts` after building: it copies the licensed catalogue media to `packages/web/dist/exercise-media/`. Compose supplies that media directly from `catalogue/media/` instead. Compose uses a named data volume initialized with the API image's `/data` ownership, so the unprivileged API can write it. If you deliberately replace it with a host bind mount, pre-create the directory and give the container's `bun` user (UID/GID 1000) write access. Do not solve permissions by running the API as root.

## Secure setup

The shipped Compose configuration exposes the web port on `127.0.0.1` and publishes no API port. Leave invite-only registration enabled. Generate a setup token with `openssl rand -hex 32`, put it in `SETUP_TOKEN`, and register a passkey using that token in the invite-code field. On an empty instance it creates the first administrator once. Remove `SETUP_TOKEN` and restart after registration; the stored consumption marker prevents reuse. Normal users join with administrator-created invites. `ADMIN_UIDS` is an explicit recovery mechanism for an existing installation.

Passkeys bind to the exact hostname: use `RP_ID=localhost` with `ORIGIN=http://localhost:8080` for local testing. For a public instance, terminate TLS at your reverse proxy, set `EXPOSURE=public`, `ORIGIN=https://gym.example.com`, and `RP_ID=gym.example.com`. Public mode refuses disabled device tokens, insecure origins, and first-user-admin mode. Keep `DEVICE_TOKENS=1`, `INVITE_ONLY=1`, and preferably `ALLOW_GUEST=0` for a restricted instance. Configure your proxy to replace forwarding headers. `TRUST_PROXY=1` is appropriate only when every request passes through that trusted proxy.

Devices have separate revocable tokens. Revoke a lost device from Settings. Disabling an account invalidates existing sessions; re-enabling it does not revive them. Agent tokens are credentials for a specific profile: keep them out of screenshots, logs, shell history, repositories, and shared agent configuration.

## Environment reference

| Variable | Default / use |
| --- | --- |
| `PORT`, `HOST` | API `3000`, `0.0.0.0`; direct local use should pass `--host 127.0.0.1` |
| `DATA_DIR`, `STATIC_DIR` | `/data`; optional static web directory; CLI `--data-dir` / `--static-dir` override |
| `ORIGIN`, `RP_ID`, `RP_NAME` | `http://localhost:8080`, `localhost`, `openGym` |
| `EXPOSURE` | `private` or `public`; public requires HTTPS and secure account policy |
| `DEVICE_TOKENS` | `1`; per-device sessions |
| `INVITE_ONLY`, `FIRST_USER_ADMIN` | Invite-only by default; first-user-admin off by default |
| `SETUP_TOKEN`, `ADMIN_UIDS` | One-time first-admin token; optional comma-separated recovery admin IDs |
| `ALLOW_GUEST` | `1`; local browser-only guest profiles |
| `TRUST_PROXY` | `0` direct server; Compose enables for its trusted proxy |
| `SESSION_DAYS` | `90`; session lifetime |
| `DEFAULT_LANG` | Empty; app UI is English with en-US dates |
| `AUDIT_LOG`, `AUDIT_MAX`, `AUDIT_DAYS`, `AUDIT_IP` | On, 5000, 90, `off`; optional `net` / `full` IP retention |
| `BODY_TIMEOUT_MS` | `300000` (5 minutes); receipt deadline; bounded body size remains enforced |
| `VAPID_SUBJECT`, `ALLOWED_PRIVATE_IPS` | Push contact URI; explicit allowlist for push destinations on private addresses |
| `REMINDER_TICK_MS` | `10000`; background reminder interval |
| `WEB_PORT`, `NGINX_PORT`, `BASE_PATH` | Compose `8080`, `80`, empty; subpath must have a leading slash and no trailing slash |
| `OPENGYM_LIVE_DATA_DIR` | Optional explicit protected data root for migration tools; no machine-specific default |
| `API_TARGET`, `API_ORIGIN`, `MEDIA_TARGET` | Vite development proxy targets/origin; media target optional |
| `APP_BUILD` | Optional frontend build identifier; otherwise git commit ID |
| `VITE_UMAMI_SRC`, `VITE_UMAMI_ID` | Optional analytics; absent means no analytics script |

MCP-only variables are documented in [MCP.md](MCP.md). Never set an authoring directory inside a repository or cloud-sync folder.

## Backups and updates

Stop writes or use the provided backup CLI to produce a consistent snapshot: `DATA_DIR=./data bun run backup:create /path/to/backups/opengym.db`, then `bun run backup:verify /path/to/backups/opengym.db`. Keep the accompanying manifest with the backup. Store backups separately from the repository and restrict access: they contain account and workout data. Verify a backup and prepare a rollback before changing storage or updating an instance. No scheduler is installed by this project. Exercise-media uploads and mobile shells are outside this release.
