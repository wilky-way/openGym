# Agent skills

Three portable `SKILL.md` files are included:

- [opengym-workouts](../skills/opengym-workouts/SKILL.md): inspect prescriptions and logs; guide workout recording accurately.
- [opengym-templates](../skills/opengym-templates/SKILL.md): search exercises, author routine templates and custom exercises with sealed previews and undo.
- [opengym-programmes](../skills/opengym-programmes/SKILL.md): author private programmes, validate/preview/apply rules, and plan deloads.

Copy the desired directory into your client's local skill directory: `.claude/skills/` for Claude or `.agents/skills/` for compatible Codex project skills. Install/configure the MCP server independently, following [MCP.md](MCP.md). A skill provides instructions, not credentials or a scheduler. Keep tokens and draft stores outside version control.

The skills contain generic workflows only. They include no paid templates, personal logs, or machine-specific configuration. Use the generated tool schemas as the authority for available operations and arguments.
