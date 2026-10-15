# openGym

A self-hosted workout log, routine planner, and programme library. Track sets, effort, body measurements, and training history; plan weeks; preview sessions; and author deterministic progression rules with a local agent.

The browser app uses React and an offline-capable Platform adapter. The server runs on Bun with SQLite. The MCP bridge reads authenticated HTTP state and supports private programme drafts, validation, previews, conditional programme actions, and gated workout history writes. It never needs direct access to the server's data directory.

**Based on openGym by Duarte Santos.** This independent continuation starts at upstream v1.4.1. Source code is **AGPL-3.0-or-later**; see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). The exercise catalogue has separate text and media notices. Licensed catalogue media is for use inside openGym; it is not AGPL artwork or a general media pack. Preserve its notice and obtain a separate license for other uses.

## Features

- **Logging:** Focus, cards, list, and compact layouts; sets, reps, load, RIR/RPE, supersets, rest timers, notes, and past-workout editing. Browse history and repeat a session.
- **Planning & programmes:** a calendar, fixed weeks or rotations, reusable routines, a private programme library, week-by-week prescriptions, and read-only session previews. Pause, switch, or repeat a block.
- **Progression engine:** deterministic percentage, effort-based load, double progression, linear increments, training-max changes, stall responses, deloads, and volume ramps. Expand **Why** to inspect the inputs behind a prescription; your logged values remain yours to choose.
- **Stats & body:** activity, exercise progress, estimated 1RM, muscle volume, fatigue and strength maps, structural balance, bodyweight goals, circumference measurements, and a gym check-in card.
- **Sync, offline & devices:** browser-local guest mode, offline-capable logging, profile sync, passkeys, one-time device pairing, and device revocation. JSON backup/export and imports help keep your records portable.
- **MCP & agents:** 35 tools for authenticated reads, session previews, private programme drafts, progression validation and previews, conditional programme actions, and past-workout logging. `log_workout` previews by default; saving and the restricted `delete_workout` undo require an explicit write gate. See [the tool guide](docs/MCP.md).
- **Self-hosting:** Bun, SQLite, a compiled server or Docker Compose, invite-only registration, an admin dashboard, and configurable units, equipment, appearance, workout controls, and alerts.

## App tour

All images use invented routines, programmes, workouts, measurements, devices, and membership codes. Phone captures are 390 × 844; desktop captures are 1440 × 900. Open an image for its full size. The [capture guide and complete inventory](docs/screenshots/README.md) include reproduction steps and browser limitations.

<table>
  <tr>
    <td align="center"><a href="docs/screenshots/home.png"><img src="docs/screenshots/home.png" width="240" alt="Today & next session"></a><br><sub>Today & next session</sub></td>
    <td align="center"><a href="docs/screenshots/workout-focus.png"><img src="docs/screenshots/workout-focus.png" width="240" alt="Focus logging & rest timer"></a><br><sub>Focus logging & rest timer</sub></td>
    <td align="center"><a href="docs/screenshots/workout-effort.png"><img src="docs/screenshots/workout-effort.png" width="240" alt="Effort entry"></a><br><sub>Effort entry</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="docs/screenshots/history.png"><img src="docs/screenshots/history.png" width="240" alt="Training history"></a><br><sub>Training history</sub></td>
    <td align="center"><a href="docs/screenshots/workout-detail.png"><img src="docs/screenshots/workout-detail.png" width="240" alt="Workout detail & editing"></a><br><sub>Workout detail & editing</sub></td>
    <td align="center"><a href="docs/screenshots/routine-editor.png"><img src="docs/screenshots/routine-editor.png" width="240" alt="Routine editor"></a><br><sub>Routine editor</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="docs/screenshots/planner.png"><img src="docs/screenshots/planner.png" width="240" alt="Plan calendar"></a><br><sub>Plan calendar</sub></td>
    <td align="center"><a href="docs/screenshots/programmes.png"><img src="docs/screenshots/programmes.png" width="240" alt="Programme library"></a><br><sub>Programme library</sub></td>
    <td align="center"><a href="docs/screenshots/programme-week.png"><img src="docs/screenshots/programme-week.png" width="240" alt="Programme week"></a><br><sub>Programme week</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="docs/screenshots/programme.png"><img src="docs/screenshots/programme.png" width="240" alt="Session preview"></a><br><sub>Session preview</sub></td>
    <td align="center"><a href="docs/screenshots/progression-why.png"><img src="docs/screenshots/progression-why.png" width="240" alt="Progression: Why"></a><br><sub>Progression: Why</sub></td>
    <td align="center"><a href="docs/screenshots/library.png"><img src="docs/screenshots/library.png" width="240" alt="Exercise search"></a><br><sub>Exercise search</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="docs/screenshots/exercise-detail.png"><img src="docs/screenshots/exercise-detail.png" width="240" alt="Exercise detail"></a><br><sub>Exercise detail</sub></td>
    <td align="center"><a href="docs/screenshots/muscles.png"><img src="docs/screenshots/muscles.png" width="240" alt="Explore muscles"></a><br><sub>Explore muscles</sub></td>
    <td align="center"><a href="docs/screenshots/muscle-balance.png"><img src="docs/screenshots/muscle-balance.png" width="240" alt="Muscle balance"></a><br><sub>Muscle balance</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="docs/screenshots/stats.png"><img src="docs/screenshots/stats.png" width="240" alt="Activity & stats"></a><br><sub>Activity & stats</sub></td>
    <td align="center"><a href="docs/screenshots/e1rm.png"><img src="docs/screenshots/e1rm.png" width="240" alt="Estimated 1RM"></a><br><sub>Estimated 1RM</sub></td>
    <td align="center"><a href="docs/screenshots/structural-balance.png"><img src="docs/screenshots/structural-balance.png" width="240" alt="Structural balance"></a><br><sub>Structural balance</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="docs/screenshots/bodyweight.png"><img src="docs/screenshots/bodyweight.png" width="240" alt="Bodyweight & goals"></a><br><sub>Bodyweight & goals</sub></td>
    <td align="center"><a href="docs/screenshots/measurements.png"><img src="docs/screenshots/measurements.png" width="240" alt="Body measurements"></a><br><sub>Body measurements</sub></td>
    <td align="center"><a href="docs/screenshots/check-in.png"><img src="docs/screenshots/check-in.png" width="240" alt="Gym check-in"></a><br><sub>Gym check-in</sub></td>
  </tr>
</table>

### Settings & devices

<table>
  <tr>
    <td align="center"><a href="docs/screenshots/settings.png"><img src="docs/screenshots/settings.png" width="240" alt="Settings & search"></a><br><sub>Settings & search</sub></td>
    <td align="center"><a href="docs/screenshots/settings-workout.png"><img src="docs/screenshots/settings-workout.png" width="240" alt="Workout preferences"></a><br><sub>Workout preferences</sub></td>
    <td align="center"><a href="docs/screenshots/settings-advanced.png"><img src="docs/screenshots/settings-advanced.png" width="240" alt="Fine-tuning"></a><br><sub>Fine-tuning</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="docs/screenshots/settings-alerts.png"><img src="docs/screenshots/settings-alerts.png" width="240" alt="Timer alerts"></a><br><sub>Timer alerts</sub></td>
    <td align="center"><a href="docs/screenshots/settings-reminders.png"><img src="docs/screenshots/settings-reminders.png" width="240" alt="Reminders: browser support"></a><br><sub>Reminders: browser support</sub></td>
    <td align="center"><a href="docs/screenshots/settings-plan.png"><img src="docs/screenshots/settings-plan.png" width="240" alt="Plan & schedule"></a><br><sub>Plan & schedule</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="docs/screenshots/settings-units.png"><img src="docs/screenshots/settings-units.png" width="240" alt="Units & language"></a><br><sub>Units & language</sub></td>
    <td align="center"><a href="docs/screenshots/settings-equipment.png"><img src="docs/screenshots/settings-equipment.png" width="240" alt="Equipment"></a><br><sub>Equipment</sub></td>
    <td align="center"><a href="docs/screenshots/settings-look.png"><img src="docs/screenshots/settings-look.png" width="240" alt="Look & Home"></a><br><sub>Look & Home</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="docs/screenshots/settings-data.png"><img src="docs/screenshots/settings-data.png" width="240" alt="Data & backup"></a><br><sub>Data & backup</sub></td>
    <td align="center"><a href="docs/screenshots/settings-about.png"><img src="docs/screenshots/settings-about.png" width="240" alt="About & updates"></a><br><sub>About & updates</sub></td>
    <td align="center"><a href="docs/screenshots/settings-account.png"><img src="docs/screenshots/settings-account.png" width="240" alt="Account & sync"></a><br><sub>Account & sync</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="docs/screenshots/settings-devices.png"><img src="docs/screenshots/settings-devices.png" width="240" alt="Signed-in devices"></a><br><sub>Signed-in devices</sub></td>
    <td align="center"><a href="docs/screenshots/settings-pairing.png"><img src="docs/screenshots/settings-pairing.png" width="240" alt="Pair an agent or device"></a><br><sub>Pair an agent or device</sub></td>
    <td align="center"><a href="docs/screenshots/admin.png"><img src="docs/screenshots/admin.png" width="240" alt="Admin & invites"></a><br><sub>Admin & invites</sub></td>
  </tr>
</table>

Additional settings views: [more settings](docs/screenshots/settings-more.png), [workout controls](docs/screenshots/settings-workout-more.png), [fine-tuning details](docs/screenshots/settings-advanced-more.png), [plate inventory](docs/screenshots/settings-plates.png), [dumbbell inventory](docs/screenshots/settings-dumbbells.png), and [invite and activity details](docs/screenshots/admin-invites.png). Reminder controls depend on browser notification support; the capture browser reports them unavailable.

### Desktop & dark mode

<table>
  <tr>
    <td align="center"><a href="docs/screenshots/planner-desktop.png"><img src="docs/screenshots/planner-desktop.png" width="480" alt="Desktop planning"></a><br><sub>Desktop planning</sub></td>
    <td align="center"><a href="docs/screenshots/stats-desktop.png"><img src="docs/screenshots/stats-desktop.png" width="480" alt="Desktop stats"></a><br><sub>Desktop stats</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td align="center"><a href="docs/screenshots/home-dark.png"><img src="docs/screenshots/home-dark.png" width="240" alt="Today in dark mode"></a><br><sub>Today in dark mode</sub></td>
    <td align="center"><a href="docs/screenshots/settings-dark.png"><img src="docs/screenshots/settings-dark.png" width="240" alt="Dark appearance"></a><br><sub>Dark appearance</sub></td>
  </tr>
</table>

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
