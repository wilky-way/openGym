# openGym

A self-hosted workout log, routine planner, and programme library. Track sets, effort, body measurements, and training history; plan weeks; preview sessions; and author deterministic progression rules with a local agent.

The browser app uses React and an offline-capable Platform adapter. The server runs on Bun with SQLite. The MCP bridge reads authenticated HTTP state and supports private programme drafts, validation, previews, and conditional programme actions. It never needs direct access to the server's data directory.

**Based on openGym by Duarte Santos.** This independent continuation starts at upstream v1.4.1. Source code is **AGPL-3.0-or-later**; see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). The exercise catalogue has separate text and media notices. Licensed catalogue media is for use inside openGym; it is not AGPL artwork or a general media pack. Preserve its notice and obtain a separate license for other uses.

![Synthetic workout planner](docs/screenshots/planner.png)
![Synthetic training history](docs/screenshots/history.png)
![Synthetic programme preview](docs/screenshots/programme.png)

All screenshots use invented routines, programmes, and workout logs. No personal records or commercial programme templates are included.

## Run locally

Install Bun 1.4.1, then:

```sh
bun install --frozen-lockfile
bun run build
bun scripts/prepare-static.ts
cp .env.example .env
# Set SETUP_TOKEN to the output of: openssl rand -hex 32
bun run start:server -- --host 127.0.0.1 --port 8080 --data-dir ./data --static-dir ./packages/web/dist
```

Open `http://localhost:8080`. Enter your setup token in the invite-code field when registering the first passkey. Remove the token after setup. Bun reads the local `.env`; the compiled server requires environment variables supplied by your service manager.

`prepare-static.ts` copies licensed catalogue media into the direct server's static directory. Compose copies the media itself, so its workflow does not require that step.

For Docker, the frontend is built first and supplied to the web image:

```sh
bun install --frozen-lockfile
bun run build:web
cp .env.example .env
# Configure the one-time setup token and your exact ORIGIN/RP_ID.
docker compose build
docker compose up -d
```

Read [self-hosting](docs/SELF_HOSTING.md) before exposing an instance. Compose publishes only on loopback by default. Public exposure requires HTTPS, per-device tokens, and invites.

## Agent and developer documentation

- [MCP setup, generated tool reference, and progression workflow](docs/MCP.md)
- [HTTP API and conditional writes](docs/API.md)
- [Agent skills for Claude and Codex](docs/AGENT_SKILLS.md)
- [Exercise catalogue and media notice](catalogue/README.md)
- [Third-party attribution](NOTICE.md)

Development: `bun run --cwd packages/web dev` uses a loopback API target by default; set `API_TARGET` and `API_ORIGIN` to match your local server. Run `bun run test:core`, `bun run test:web`, `bun run test:mcp`, or `bun run test:server`. Server tests use isolated temporary data directories. The public source contains native tests; private rewrite oracle recordings and historical review evidence are excluded.

Report issues in the [project repository](https://github.com/wilky-way/openGym). Do not attach credentials, exports, or personal workout data.
