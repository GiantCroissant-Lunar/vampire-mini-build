# Setup

Configuration and secrets required to run the vampire-mini-build pipeline.

## Secrets (on vampire-mini-build)

| Secret | Purpose |
|--------|---------|
| `VAMPIRE_MINI_DEPLOY_KEY` | SSH deploy key (write access) for private repo |
| `ZAI_API_KEY` | Z.AI GLM-4.7 API |
| `KIMI_API_KEY` | Moonshot Kimi CLI |
| `DASHSCOPE_API_KEY` | Alibaba Model Studio (Qwen) |
| `GH_AW_GITHUB_TOKEN` | PAT for cross-workflow triggering (orchestrator → agent-sync) |

The PAT (`GH_AW_GITHUB_TOKEN`) is needed because `GITHUB_TOKEN` events don't trigger other workflows. Without it, orchestrator-created issues won't start agent-sync.

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
    ├── complete-app.csproj     # Godot.NET.Sdk/4.6.1 + gdUnit4.api + gdUnit4.test.adapter
    ├── project.godot           # Godot 4.6, Jolt Physics
    ├── addons/
    │   ├── phantom_camera/     # Phantom Camera addon (camera behaviors)
    │   └── phantom_camera_csharp/  # C# wrapper for Phantom Camera
    ├── Scripts/                # C# scripts (by category)
    │   └── Tests/              # GdUnit4 unit tests (mirrors Scripts/ structure)
    └── Scenes/                 # Scenes (by category)
```

## Dependencies to Install in Private Repo

### GdUnit4 (Unit Testing)

Add to `complete-app.csproj`:
```xml
<PackageReference Include="gdUnit4.api" Version="6.1.*" />
<PackageReference Include="gdUnit4.test.adapter" Version="3.*" />
```

### Phantom Camera

Install from Godot AssetLib or clone from https://github.com/ramokz/phantom-camera into `addons/phantom_camera/`. For C# support, also install the C# wrapper addon.

## Build Repo Contents (vampire-mini-build)

```
vampire-mini-build/
├── .github/
│   ├── agents/                 # GitHub Copilot agent config
│   └── workflows/
│       ├── agent-sync.yml      # Coding agent workflow
│       ├── integration.yml     # Integration build workflow
│       ├── orchestrator.md     # Task planner (gh-aw source)
│       └── orchestrator.lock.yml  # Compiled orchestrator workflow
├── .agent/skills/              # Claude Code skills
├── Taskfile.yml                # Pre-commit checks
├── GitVersion.yml              # Semver config
├── cliff.toml                  # Changelog config
├── AGENTS.md                   # Agent documentation
├── README.md                   # Project overview
└── docs/
    ├── SETUP.md                # This file
    └── PIPELINE.md             # Pipeline documentation
```

## Adding a New Agent

1. Add a new CLI install step in `agent-sync.yml`
2. Add a configuration step with the provider's API settings
3. Add a run step gated on `steps.agent.outputs.engine == '<name>'`
4. Update the round-robin modulo in the "Select agent" step
5. Add the API key as a repository secret
6. Update `AGENTS.md` with the new agent's details
