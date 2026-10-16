# Synthetic screenshot tour

Captured from the compiled application with **agent-browser 0.8.5**, using the invented state from `scripts/screenshot-fixture.ts`. No user export, personal account, private programme library, commercial programme template, or personal browser profile is read. Names, logs, measurements, membership values, device labels, and the demo invite are invented. Exercise text and any catalogue media retain the notices in [NOTICE.md](../../NOTICE.md).

Seven images were refreshed on 2026-10-16 from runtime build **a6c1ddccbc**: Library, exercise detail, Focus workout, programme session preview, native prescription preview, native relative loads, and training max adjustment. The other **42 images** retain their historical build attribution, including the base-build stamp visible in About. The refresh changes only the synthetic fixture, documentation, and screenshots; it uses the compiled runtime at that build.

All phone PNGs are **390 × 844**. Desktop PNGs are **1440 × 900**. These are viewport captures, with additional scrolled views for long pages. The 42 historical PNGs retain their lossless Pillow optimization (`optimize=True, compress_level=9`); neither pngquant nor oxipng was installed. The seven refreshed PNGs are exact browser outputs. No screenshot pixels or UI elements were retouched.

## Reproduction

### Current prescription and illustration examples

The bounded refresh uses the same invented state generator, with two optional modes:

```sh
bun scripts/screenshot-fixture.ts --native > .gate/screenshot-native.json
bun scripts/screenshot-fixture.ts --max > .gate/screenshot-max.json
```

Both modes create original examples through the public programme importer and activation functions. The native example authors three sets of five, with the last two rows ten percent below the first completed set's actual load. Start the session through the UI, enter and complete 100 kg on the anchor, and inspect the planned 90 kg back-off without replacing the blank actual-load field. The max example starts with a 100 kg training max and two five-rep targets at 80% and 90%, with 2 RIR. Open the active programme card → **Adjust max**, enter 110 kg, and inspect the future **87.5 / 100 kg** preview after 2.5 kg rounding. The captured example cancels without saving.

Load each fixture into a fresh guest state as described below. These views require no signed-in account. Serve the licensed catalogue stills and clips used by the visible exercises, preserving [NOTICE.md](../../NOTICE.md). Confirm thumbnails have decoded, the workout animation has advanced, and **tap to pause** and **Minimize** work before capture. Use real UI controls; do not replace images, labels, or prescriptions in the DOM. The native preview and workout rows show the complete targets; the legacy Home shorthand can still show `3 × 0` in the blurred background. The refresh verifies the row prescriptions and records that summary limitation. The strict media allowlist returns 404 for `exercise-media/NOTICE.txt`; preserve the file alongside prepared media and use the repository notice links for attribution.

### Original full tour

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

49 PNGs, **3,152,448 bytes** total (3.01 MiB).

| Image | Size | View / action |
| --- | ---: | --- |
| [admin-invites.png](admin-invites.png) | 59,545 B · 390 × 844 | Admin scrolled to invite, user, and activity cards. |
| [admin.png](admin.png) | 63,310 B · 390 × 844 | Account → Admin dashboard; summary, invites, and synthetic user. |
| [bodyweight.png](bodyweight.png) | 58,153 B · 390 × 844 | Stats; scroll Body weight into view. |
| [check-in.png](check-in.png) | 27,669 B · 390 × 844 | Check in; invented, unusable demo membership QR. |
| [e1rm.png](e1rm.png) | 70,137 B · 390 × 844 | Stats → Exercise progress → Est. 1RM; scroll to the card. |
| [exercise-detail.png](exercise-detail.png) | 96,159 B · 390 × 844 | Current build: Exercises → search barbell bench press → first result; pause to the decoded still drawing. |
| [history.png](history.png) | 76,495 B · 390 × 844 | History; 18 invented completed workouts. |
| [home-dark.png](home-dark.png) | 70,591 B · 390 × 844 | Home after Look & Home → Dark. |
| [home.png](home.png) | 69,122 B · 390 × 844 | Home; top of Today with the next prescription. |
| [library.png](library.png) | 79,332 B · 390 × 844 | Current build: Exercises; default rows with decoded licensed thumbnails. |
| [measurements.png](measurements.png) | 58,075 B · 390 × 844 | Body measurements; waist history. |
| [muscle-balance.png](muscle-balance.png) | 85,985 B · 390 × 844 | Stats; scroll Muscle balance into view. |
| [muscles.png](muscles.png) | 84,219 B · 390 × 844 | Explore muscles → Chest; exercise discovery by muscle. |
| [native-prescription.png](native-prescription.png) | 111,058 B · 390 × 844 | Current build: --native fixture → Home → Preview; three five-rep rows, authored 10% back-off relation, pending anchor. |
| [native-relative.png](native-relative.png) | 67,553 B · 390 × 844 | Current build: --native fixture → Start → enter and complete 100 kg anchor → Minimize media; planned 90 kg back-offs keep blank actual loads. |
| [planner-desktop.png](planner-desktop.png) | 63,933 B · 1440 × 900 | Plan → Schedule at desktop size; scroll to top. |
| [planner.png](planner.png) | 39,835 B · 390 × 844 | Plan → Schedule; month calendar. |
| [programme-week.png](programme-week.png) | 55,168 B · 390 × 844 | Programs → Upper/Lower Strength; scroll Week 1 into view. |
| [programme.png](programme.png) | 77,205 B · 390 × 844 | Current build: original fixture → Home → Preview; read-only projected Upper Strength session. |
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
| [training-max.png](training-max.png) | 78,838 B · 390 × 844 | Current build: --max fixture → Plan → Programs → active card → Adjust max → 110 kg; future 87.5 / 100 kg preview, cancelled after capture. |
| [workout-detail.png](workout-detail.png) | 68,292 B · 390 × 844 | History → newest Full Body workout. |
| [workout-effort.png](workout-effort.png) | 75,060 B · 390 × 844 | Active Focus workout → RIR; capture the effort picker. |
| [workout-focus.png](workout-focus.png) | 87,209 B · 390 × 844 | Current build: original fixture → Start without weighing in → complete one set; exercise animation, tap-to-pause, Minimize, and rest timer; scroll to top. |
