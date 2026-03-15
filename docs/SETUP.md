# vampire-mini-build

Public orchestration repo for the **vampire-mini** Godot 4.6 C# game.

## Architecture

```
vampire-mini-build (public)                 vampire-mini (private)
┌──────────────────────────┐                ┌─────────────────────┐
│                          │   SSH clone    │                     │
│  1. Plan issue created   │←──────────────│  Godot 4.6 C# game  │
│         ↓                │                │  Nuke build system   │
│  2. Orchestrator (GPT)   │                │                     │
│     breaks into tasks    │                │                     │
│         ↓                │                │                     │
│  3. Agent issues created │                │                     │
│     (GLM/Kimi/Qwen)      │                │                     │
│         ↓                │                │                     │
│  4. Pre-commit checks    │                │                     │
│     - Secret scan        │                │                     │
│     - Nuke build         │                │                     │
│         ↓                │   SSH push     │                     │
│  5. Push branch back     │───────────────→│  agent/* branches   │
│         ↓                │                │                     │
│  6. Integration build    │                │                     │
│     merges all branches  │───────────────→│  integration/latest │
│     - Pass: push         │                │                     │
│     - Fail: create fix   │                │                     │
│       issue → agent      │                │                     │
└──────────────────────────┘                └─────────────────────┘
```

No game source is stored in this public repo.

## Workflows

### agent-sync.yml — Coding Agents
Triggered by issues labeled `agent` or manual dispatch.

1. Clones private repo via SSH
2. Selects agent (3-way round-robin or manual override):
   - **GLM-4.7** via OpenCode + Z.AI
   - **Kimi** via Kimi CLI + Moonshot
   - **Qwen3 Coder Plus** via OpenCode + Alibaba Model Studio
3. Agent writes code in private repo
4. Pre-commit checks (Taskfile.yml):
   - **gitleaks** — secret scanning
   - **File size** — rejects files >5MB
   - **Forbidden patterns** — API keys, private keys
   - **Suspicious filenames** — .env, .pem, credentials
5. Build verification (Nuke):
   - `dotnet restore` + `dotnet build` via Godot.NET.Sdk/4.6.1
   - Blocks push if C# doesn't compile
6. Versioning: GitVersion (semver) + git-cliff (changelog)
7. Pushes branch to private repo

### integration.yml — Integration Build
Triggered after any agent-sync completes.

1. Merges all `agent/*` branches into `integration/latest`
2. Runs Nuke build on combined code (one build)
3. If pass: pushes `integration/latest` to private repo
4. If fail: blames files to branches, creates fix issue (labeled `agent`)
   - Another agent automatically picks up the fix

### orchestrator.md (gh-aw) — Task Planner
Triggered by issues labeled `plan`.

1. Receives high-level task description
2. Breaks into focused sub-issues (labeled `agent`)
3. Each sub-issue triggers agent-sync workflow
4. Engine: Copilot (GPT via Copilot Pro+)

## Agents

| Agent | CLI | Model | Provider | Concurrency |
|-------|-----|-------|----------|-------------|
| GLM | OpenCode | glm-4.7 | Z.AI | ~2 simultaneous |
| Kimi | Kimi CLI | kimi-for-coding | Moonshot | unlimited |
| Qwen | OpenCode | qwen3-coder-plus | Alibaba Model Studio | unlimited |

Round-robin: `issue_number % 3` → 0=kimi, 1=glm, 2=qwen

## Secrets (on vampire-mini-build)

| Secret | Purpose |
|--------|---------|
| `VAMPIRE_MINI_DEPLOY_KEY` | SSH deploy key (write) for private repo |
| `ZAI_API_KEY` | Z.AI GLM-4.7 API |
| `KIMI_API_KEY` | Moonshot Kimi CLI |
| `DASHSCOPE_API_KEY` | Alibaba Model Studio |
| `GH_AW_GITHUB_TOKEN` | PAT for cross-workflow triggering |

## Private Repo Structure (vampire-mini)

```
vampire-mini/
├── .nuke/                      # Nuke build config
├── build/
│   ├── Build.cs                # Nuke targets: Clean, Restore, Compile, Check
│   └── _build.csproj           # Nuke build project (v9.0.4, net8.0)
├── build.sh                    # Nuke bootstrapper
├── complete-app.sln            # Solution file
├── dotnet-tools.json           # Nuke global tool
└── project/hosts/complete-app/
    ├── complete-app.csproj     # Godot.NET.Sdk/4.6.1
    ├── project.godot           # Godot 4.6, Jolt Physics
    ├── Scripts/                # C# scripts (by category)
    └── Scenes/                 # Scenes (by category)
```

## Usage

### Quick: Single Task
1. Create an issue with label `agent` and describe the task
2. Agent writes code, checks pass, branch pushed
3. Review branch in private repo and merge

### Full: Multi-Task Plan
1. Create an issue with label `plan` describing a feature
2. Orchestrator breaks it into sub-issues (auto-labeled `agent`)
3. Multiple agents work in parallel
4. Integration build verifies combined code compiles
5. If integration fails, fix issue auto-created for another agent
6. Review `integration/latest` branch and merge to main
