# vampire-mini-build

Public orchestration repo for the **vampire-mini** Godot C# game.

## Architecture

```
vampire-mini-build (public)              vampire-mini (private)
┌────────────────────────┐               ┌──────────────────┐
│ Issue labeled 'agent'  │   SSH clone   │                  │
│         ↓              │←──────────────│  Godot C# game   │
│ GitHub Actions clones  │               │                  │
│ private repo via SSH   │               │                  │
│         ↓              │               │                  │
│ Agent edits game code  │               │                  │
│         ↓              │   SSH push    │                  │
│ Pushes branch back     │──────────────→│  branch created  │
│                        │               │  with changes    │
└────────────────────────┘               └──────────────────┘
```

No game source is stored in this public repo.

## Workflows

- **agent-sync.yml** — Clones private repo, runs coding agent, pushes changes back.

## SSH Deploy Key (already configured)

- Deploy key (write access) on `GiantCroissant-Lunar/vampire-mini`
- Secret `VAMPIRE_MINI_DEPLOY_KEY` on `GiantCroissant-Lunar/vampire-mini-build`

## Usage

1. Create an issue in this repo with the label `agent`
2. The workflow clones the private repo, runs the agent, pushes a branch
3. A comment is posted on the issue with the result
4. Review the branch in the private repo and merge
