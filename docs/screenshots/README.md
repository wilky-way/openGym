# Synthetic screenshot tour

Captured from the compiled application with **agent-browser 0.8.5**, using the invented state from `scripts/screenshot-fixture.ts`. No user export, personal account, private programme library, commercial programme template, or personal browser profile is read. Names, logs, measurements, membership values, device labels, and the demo invite are invented. Exercise text and any catalogue media retain the notices in [NOTICE.md](../../NOTICE.md).

All phone PNGs are **390 × 844**. Desktop PNGs are **1440 × 900**. These are viewport captures, with additional scrolled views for long pages. PNGs are losslessly optimized with Pillow (`optimize=True, compress_level=9`); neither pngquant nor oxipng was installed. No screenshot pixels or UI elements were retouched.

## Reproduction

1. Install with `bun install --frozen-lockfile`, then run `bun run build` and `bun scripts/prepare-static.ts`.
2. Make ignored scratch storage and generate only invented state:

   ```sh
   mkdir -p .gate
   bun scripts/screenshot-fixture.ts > .gate/screenshot-state.json
   bun scripts/screenshot-account.ts .gate/screenshot-state.json > .gate/screenshot-session.json
   ```

   The account helper always creates a **new** `screenshot-*` data directory under `.gate`; it never accepts an existing data directory. It seeds an isolated owner, two devices, one demo invite, and the synthetic profile. Its output includes a disposable local session credential: keep that manifest ignored and delete it after capture.

3. In a foreground terminal, start the compiled server with the `dataDir` reported in the local manifest. Verify port **18195** is free first; choose another free loopback port and adjust the helper's `ORIGIN` and all URLs if necessary. Do not use a live app port or data directory.

   ```sh
   echo $$ > .gate/showcase-server.pid
   exec env ORIGIN=http://127.0.0.1:18195 DEVICE_TOKENS=1 ./dist/opengym-server \
     --host 127.0.0.1 --port 18195 \
     --data-dir .gate/screenshot-REPLACE_WITH_GENERATED_SUFFIX \
     --static-dir ./packages/web/dist
   ```

4. Open a fresh isolated agent-browser session with no personal profile. Start as a guest; the first part of this tour uses no authentication:

   ```sh
   agent-browser --session showcase-tour open http://127.0.0.1:18195
   agent-browser --session showcase-tour set viewport 390 844
   ```

   Load the generated JSON into `gym_state_v1`, set `gym_guest=1`, and reload. Passing JavaScript as an argument array avoids shell interpolation of the JSON:

   ```python
   import json, pathlib, subprocess
   fixture = pathlib.Path('.gate/screenshot-state.json').read_text()
   code = ('localStorage.clear();localStorage.setItem("gym_guest","1");'
           'localStorage.setItem("gym_state_v1",' + json.dumps(fixture) + ');'
           'location.hash="/home";location.reload()')
   subprocess.run(['agent-browser', '--session', 'showcase-tour', 'eval', code], check=True)
   ```

5. Follow the route/action inventory below. Use `agent-browser snapshot -i -c` after navigation and act on the current refs. Wait at least 500–900 ms for transitions and `document.fonts.ready` before capturing. Explicitly scroll to the desired card after navigation, because the app restores earlier scroll positions. Use `agent-browser screenshot <path>` for each viewport. For Focus logging, start the scheduled workout, skip the weigh-in, complete one set, then open RIR. Clear the disposable guest's active workout before moving on.
6. For Account, devices, pairing, admin, and the signed-in Settings pages, clear guest local storage and install only the helper's synthetic session cookie:

   ```python
   import json, pathlib, subprocess
   session = json.loads(pathlib.Path('.gate/screenshot-session.json').read_text())
   browser = ['agent-browser', '--session', 'showcase-tour']
   subprocess.run(browser + ['eval', 'localStorage.clear()'], check=True)
   subprocess.run(browser + ['cookies', 'set', 'gymsid', session['cookie'],
                            '--url', 'http://127.0.0.1:18195', '--httpOnly',
                            '--sameSite', 'Lax'], check=True, stdout=subprocess.DEVNULL)
   subprocess.run(browser + ['open', 'http://127.0.0.1:18195/#/settings/account'], check=True)
   subprocess.run(browser + ['reload'], check=True)
   ```

   The browser now reads the seeded profile through the real HTTP API. Capture pairing **before** generating any one-time code. The demo invite is usable only inside this disposable instance, which is destroyed after capture.
7. Select Dark through Settings → Look & Home for the dark shots. Set viewport `1440 900` for desktop shots, and restore `390 844` afterward. Use snapshots and inspect every output image before committing it.
8. Stop the preview with `kill -TERM` using the exact PID in `.gate/showcase-server.pid`; never stop by a process-name pattern. Confirm that PID and the listener are gone. Close the isolated agent-browser session, then delete the generated data directory, fixture, manifest, and browser scratch state. No server, credentials, or accounts from the tour should remain.

## Capture limits

The browser reports **“Not supported in this browser”** on Reminders, so that screenshot honestly shows the support boundary. No push subscription or notification was created. Passkey hardware enrollment, camera scanning, and a second physical device were not exercised; the account, pairing setup, and signed-in-device screens use only the disposable synthetic server. The About page reports the build metadata embedded during the release build.

## Inventory

46 PNGs, **2,835,685 bytes** total (2.70 MiB).

| Image | Size | View / action |
| --- | ---: | --- |
| [admin-invites.png](admin-invites.png) | 59,545 B · 390 × 844 | Admin scrolled to invite, user, and activity cards. |
| [admin.png](admin.png) | 63,310 B · 390 × 844 | Account → Admin dashboard; summary, invites, and synthetic user. |
| [bodyweight.png](bodyweight.png) | 58,153 B · 390 × 844 | Stats; scroll Body weight into view. |
| [check-in.png](check-in.png) | 27,669 B · 390 × 844 | Check in; invented, unusable demo membership QR. |
| [e1rm.png](e1rm.png) | 70,137 B · 390 × 844 | Stats → Exercise progress → Est. 1RM; scroll to the card. |
| [exercise-detail.png](exercise-detail.png) | 83,722 B · 390 × 844 | Search results → Barbell Bench Press. |
| [history.png](history.png) | 76,495 B · 390 × 844 | History; 18 invented completed workouts. |
| [home-dark.png](home-dark.png) | 70,591 B · 390 × 844 | Home after Look & Home → Dark. |
| [home.png](home.png) | 69,122 B · 390 × 844 | Home; top of Today with the next prescription. |
| [library.png](library.png) | 82,773 B · 390 × 844 | Exercises → search “barbell bench press”. |
| [measurements.png](measurements.png) | 58,075 B · 390 × 844 | Body measurements; waist history. |
| [muscle-balance.png](muscle-balance.png) | 85,985 B · 390 × 844 | Stats; scroll Muscle balance into view. |
| [muscles.png](muscles.png) | 84,219 B · 390 × 844 | Explore muscles → Chest; exercise discovery by muscle. |
| [planner-desktop.png](planner-desktop.png) | 63,933 B · 1440 × 900 | Plan → Schedule at desktop size; scroll to top. |
| [planner.png](planner.png) | 39,835 B · 390 × 844 | Plan → Schedule; month calendar. |
| [programme-week.png](programme-week.png) | 55,168 B · 390 × 844 | Programs → Upper/Lower Strength; scroll Week 1 into view. |
| [programme.png](programme.png) | 63,770 B · 390 × 844 | Programme week → D1 Upper Strength; read-only session preview. |
| [programmes.png](programmes.png) | 60,617 B · 390 × 844 | Plan → Programs; active cycle and two synthetic definitions. |
| [progression-why.png](progression-why.png) | 70,712 B · 390 × 844 | Home → first Why disclosure; scroll to the expanded prescription. |
| [routine-editor.png](routine-editor.png) | 86,174 B · 390 × 844 | Plan → Routines → first Edit. |
| [settings-about.png](settings-about.png) | 48,125 B · 390 × 844 | Settings → About & updates (`#/settings/about`). |
| [settings-account.png](settings-account.png) | 67,653 B · 390 × 844 | Settings → Account (`#/settings/account`). |
| [settings-advanced-more.png](settings-advanced-more.png) | 88,132 B · 390 × 844 | Fine-tuning scrolled to its final controls and explanation. |
| [settings-advanced.png](settings-advanced.png) | 88,131 B · 390 × 844 | Settings → Fine-tuning (`#/settings/advanced`). |
| [settings-alerts.png](settings-alerts.png) | 30,310 B · 390 × 844 | Settings → Timer alerts (`#/settings/alerts`). |
| [settings-dark.png](settings-dark.png) | 54,203 B · 390 × 844 | Look & Home after selecting Dark. |
| [settings-data.png](settings-data.png) | 40,855 B · 390 × 844 | Settings → Data & backup (`#/settings/data`). |
| [settings-devices.png](settings-devices.png) | 70,593 B · 390 × 844 | Account → Signed-in devices; Demo Browser and Demo Local Agent. |
| [settings-dumbbells.png](settings-dumbbells.png) | 62,462 B · 390 × 844 | Equipment → Dumbbells; dark mode. |
| [settings-equipment.png](settings-equipment.png) | 36,353 B · 390 × 844 | Settings → Equipment (`#/settings/equipment`). |
| [settings-look.png](settings-look.png) | 53,581 B · 390 × 844 | Settings → Look & Home (`#/settings/look`). |
| [settings-more.png](settings-more.png) | 59,109 B · 390 × 844 | Settings root scrolled to the final rows. |
| [settings-pairing.png](settings-pairing.png) | 76,064 B · 390 × 844 | Account → Pair an agent or device; before generating a code. |
| [settings-plan.png](settings-plan.png) | 27,350 B · 390 × 844 | Settings → Plan & schedule (`#/settings/plan`). |
| [settings-plates.png](settings-plates.png) | 44,544 B · 390 × 844 | Equipment → Plates; dark mode. |
| [settings-reminders.png](settings-reminders.png) | 17,839 B · 390 × 844 | Settings → Reminders (`#/settings/reminders`). |
| [settings-units.png](settings-units.png) | 36,799 B · 390 × 844 | Settings → Units & language (`#/settings/units`). |
| [settings-workout-more.png](settings-workout-more.png) | 70,762 B · 390 × 844 | Workout preferences scrolled to before/during and Fine-tuning. |
| [settings-workout.png](settings-workout.png) | 67,334 B · 390 × 844 | Settings → Workout (`#/settings/workout`). |
| [settings.png](settings.png) | 57,158 B · 390 × 844 | Settings root; synthetic signed-in owner. |
| [stats-desktop.png](stats-desktop.png) | 101,180 B · 1440 × 900 | Stats at desktop size; scroll to top. |
| [stats.png](stats.png) | 51,412 B · 390 × 844 | Stats; activity and summary at the top. |
| [structural-balance.png](structural-balance.png) | 62,053 B · 390 × 844 | Structural balance; select the powerlifting ratio table, with synthetic squat/bench/deadlift history. |
| [workout-detail.png](workout-detail.png) | 68,292 B · 390 × 844 | History → newest Full Body workout. |
| [workout-effort.png](workout-effort.png) | 75,060 B · 390 × 844 | Active Focus workout → RIR; capture the effort picker. |
| [workout-focus.png](workout-focus.png) | 50,326 B · 390 × 844 | Home → Start → Start without weighing in; complete one set to start the rest timer. |
