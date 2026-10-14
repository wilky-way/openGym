---
name: opengym-workouts
description: Read openGym workouts, prescriptions, routines and training history through its authenticated MCP bridge, and guide accurate workout logging.
---

# openGym workouts

Use the connected openGym MCP bridge. Read `docs/MCP.md` and the relevant schemas in `docs/MCP-TOOLS.md` in the installed source tree before calling unfamiliar tools.

1. Establish the intended profile and date; do not infer a missing workout from a failed API read. Use `get_week_plan`, `programme_position`, and `list_routines` for schedule context.
2. Before prescribing today's sets or load, call `preview_session`. `get_routine` is the stored template; it can differ from the actual opening prescription. Keep authored effort, displayed RPE/RIR, and progression explanations distinct.
3. Use `list_workouts` and `get_workout` to inspect completed sets, units, dates, warm-ups, and per-set effort. Use `estimate_1rm` only for qualifying logged sets; explain the formula and limits returned by the tool. `get_bodyweight` and `muscle_balance` support context, not invented measurements.
4. To record a workout, use the app. The current MCP registry has no arbitrary workout-write tool. If the user explicitly requests an API integration, follow the conditional whole-document write contract in `docs/API.md`: fetch current state, preserve unknown fields and concurrent changes, use current stamps, and stop on conflict. Never claim a preview recorded sets.
5. Report only the changes and totals supported by returned data. Never include credentials or private programme prose in exported reports. Ask for missing sets/reps/load/units when necessary; do not fabricate a completed session.

Programme lifecycle writes require explicit authorization and enabled write gates. Never skip a session, activate a programme, or modify a live cycle merely because a read suggests it would help. A conflict requires a fresh read and a new decision.
