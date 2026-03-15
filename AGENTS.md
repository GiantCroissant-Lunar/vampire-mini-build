# Agents

Three AI coding agents work on the **vampire-mini** Godot 4.6 C# game. Each runs in CI via GitHub Actions (`agent-sync.yml`), clones the private repo, writes code, then pushes a branch back.

## Agent Roster

| Agent | CLI | Model | Provider | Base URL |
|-------|-----|-------|----------|----------|
| **GLM** | [OpenCode](https://opencode.ai) | glm-4.7 | Z.AI | `https://api.z.ai/api/coding/paas/v4` |
| **Kimi** | [Kimi CLI](https://code.kimi.com) | kimi-for-coding | Moonshot | `https://api.kimi.com/coding/v1` |
| **Qwen** | [OpenCode](https://opencode.ai) | qwen3-coder-plus | Alibaba Model Studio | `https://coding-intl.dashscope.aliyuncs.com/v1` |

## Selection (Round-Robin)

Assignment is automatic based on issue number:

```
issue_number % 3:
  0 → Kimi
  1 → GLM
  2 → Qwen
```

Manual override available via `workflow_dispatch` input (`agent: glm|kimi|qwen`).

## Agent Prompt

All agents receive the same base prompt:

- Engine: Godot 4.6 with C# scripting, Jolt Physics
- Project path: `project/hosts/complete-app/`
- Scripts: `Scripts/<Category>/`, Scenes: `Scenes/<Category>/`
- Conventions: PascalCase, `[Export]` attributes, `GetNode<T>()`

The issue title and body are appended as the task description.

## CLI Details

### GLM (OpenCode)

Configured via `opencode.json` with provider `zai`. Runs with:

```bash
opencode run "<prompt>"
```

Secret: `ZAI_API_KEY`

### Kimi (Kimi CLI)

Configured via `~/.kimi/config.toml`. Requires Python 3.12+. Runs with:

```bash
kimi --quiet -p "<prompt>"
```

Secret: `KIMI_API_KEY`

### Qwen (OpenCode)

Configured via `opencode.json` with provider `bailian-coding-plan`. Context window: 1M tokens, output limit: 64K. Runs with:

```bash
opencode run "<prompt>"
```

Secret: `DASHSCOPE_API_KEY`

## Orchestrator

A fourth agent (not a coding agent) acts as a task planner:

- **Engine**: Copilot (GPT via Copilot Pro+)
- **Trigger**: Issues labeled `plan`
- **Action**: Breaks high-level tasks into focused sub-issues labeled `agent`
- **Workflow**: `orchestrator.md` (compiled to `orchestrator.lock.yml`)

## Pipeline Flow

```
1. Issue labeled "agent" (or created by orchestrator)
2. agent-sync.yml triggers
3. Round-robin selects agent
4. Agent writes code in private repo clone
5. Pre-commit checks: gitleaks, file size, forbidden patterns
6. Nuke build verification (dotnet restore + build)
7. GitVersion (semver) + git-cliff (changelog)
8. Push branch to private repo
9. integration.yml merges all agent/* branches
10. If build fails → fix issue created → another agent picks it up
```

## Concurrency

| Agent | Limit |
|-------|-------|
| GLM | ~2 simultaneous |
| Kimi | unlimited |
| Qwen | unlimited |
