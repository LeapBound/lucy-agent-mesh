# Directory Layout

Use this layout when you want project code and skill assets to evolve together.

```text
lucy-agent-mesh/
  apps/
    node-daemon/
    mcp-server/
  packages/
    core/
    sdk/
    storage-sqlite/
  skills/
    lucy-mesh-operator/
      SKILL.md
      agents/
        openai.yaml
      references/
        workflow.md
        tool-playbook.md
        error-recovery.md
        directory-layout.md
      scripts/
        preflight-check.sh
```

## Why this structure

- Keep product runtime code (`apps`, `packages`) separate from agent operating knowledge (`skills`).
- Let skill versions move with code changes in one repository and one commit history.
- Make Codex onboarding trivial: copy one folder (`skills/lucy-mesh-operator`) into local skill home.

## Suggested extension points

- Add a new skill directory per domain (for example `skills/lucy-mesh-observability`).
- Keep each skill focused; avoid one giant `SKILL.md` with unrelated procedures.
- Put low-level API details in `references/` instead of bloating `SKILL.md`.
