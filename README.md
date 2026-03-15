# vampire-mini-build

Public orchestration repo for **vampire-mini**, a Godot 4.6 C# vampire survival game.

No game source lives here — this repo holds CI/CD workflows, agent configs, and build tooling. AI coding agents receive tasks as GitHub issues, write code in the [private repo](https://github.com/GiantCroissant-Lunar/vampire-mini), and push branches back automatically.

## How It Works

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

## Quick Start

### Single task
Create an issue with label **`agent`** describing what to build. An AI agent picks it up, writes code, and pushes a branch to the private repo.

### Multi-task plan
Create an issue with label **`plan`** describing a feature. The orchestrator breaks it into sub-issues, multiple agents work in parallel, and the integration build verifies everything compiles together.

## Documentation

| Doc | Description |
|-----|-------------|
| [AGENTS.md](AGENTS.md) | Agent roster, round-robin selection, CLI configs, pipeline flow |
| [docs/SETUP.md](docs/SETUP.md) | Secrets, private repo structure, detailed workflow reference |
| [docs/PIPELINE.md](docs/PIPELINE.md) | Pre-commit checks, build verification, integration process |
