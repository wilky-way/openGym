---
name: opengym-programmes
description: Author private openGym programmes and deterministic progression rules with validation, previews, conditional publishing/applying, and explicit deload factors.
---

# openGym programme authoring

Read `docs/MCP.md`, `docs/MCP-TOOLS.md`, and the relevant input schemas from the installed openGym source. Draft authoring works on macOS/Linux and keeps private working copies outside repositories and cloud-sync folders.

1. Read the intended profile, active cycle, current revision, library version, and existing programme before changing anything. Use `get_programme`, `programme_position`, and `list_programmes`. Preserve the athlete's equipment, schedule, units, and effort scale.
2. Use `create_program_draft` from scratch/clone/import. Imported content stays private; never package proprietary templates or personal logs as public examples. Use stable identities and `expected_rev` for edits. Prefer `set_slot`, `set_slot_targets`, `set_progression`, and `set_progression_rule` for focused changes.
3. Attach declarative rules only where needed: percentage, RPE load, double, linear, AMRAP training-max, stall, scheduled deload, or volume ramp. Supply rounding, rule references, bounds, and factors explicitly. Do not invent deterministic behavior outside the schema.
4. Run `validate_progression` and draft conformance checks. Repair missing/unknown references and invalid prescriptions. Then `preview_progression` for explicit weeks, including hypothetical logs only when labeled as assumptions. Explain each load with its returned `Why`.
5. Use `diff_programs` and a dry-run `publish_program_draft` to review the result. Publishing is to the private server library; it is not a public export. Only `Ready` drafts publish, with current draft and library-parent versions. Clone active/paused definitions. Real publishing requires user authorization, both write gates, `dry_run:false`, and `confirm:true`.
6. Preview `apply_progression` first. A real apply requires current profile revision and writer epoch, both gates, `dry_run:false`, `confirm:true`, and the human's `confirmNoActiveSession:true`. Obtain separate consent for `confirmInventoryAdjustment:true`. Never auto-retry or auto-confirm a 409/422. Read again and explain changed conditions.
7. For a deload use `generate_deload` with explicit set/load factors and effort targets. Preview first, then confirm the draft edit at its expected revision, revalidate, and preview. Do not assume a universal deload percentage or silently reduce logged work.

Do not print tokens, return full private programme JSON unless needed, or modify a live cycle while training. Summarize the proposed behavior, affected weeks, and material warnings before obtaining any required write authorization.
