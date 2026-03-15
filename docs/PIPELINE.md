# Pipeline

End-to-end flow from issue creation to merged code.

## Workflows

### agent-sync.yml — Coding Agents

Triggered by issues labeled `agent` or manual dispatch.

1. Clones private repo via SSH
2. Installs Godot 4.6.1 .NET
3. Selects agent (3-way round-robin or manual override)
4. Agent writes code in private repo clone
5. Pre-commit checks (Taskfile.yml)
6. Build verification (Nuke)
7. Versioning: GitVersion (semver) + git-cliff (changelog)
8. Pushes branch to private repo
9. Comments result back on the issue

### integration.yml — Integration Build

Triggered after any agent-sync completes successfully.

1. Merges all `agent/*` branches into `integration/latest`
2. Runs Nuke build on combined code
3. **Pass**: pushes `integration/latest` to private repo
4. **Fail**: blames files to branches, creates fix issue (labeled `agent`)
   - Another agent automatically picks up the fix
5. **Merge conflict**: creates a separate resolution issue per conflicting branch

### orchestrator.lock.yml — Task Planner

Triggered by issues labeled `plan`. Engine: Copilot (GPT via Copilot Pro+).

1. Receives high-level task description
2. Breaks into focused sub-issues (auto-labeled `agent`)
3. Each sub-issue triggers agent-sync

## Pre-Commit Checks

Defined in `Taskfile.yml`, run via `task check`:

| Check | What it does |
|-------|-------------|
| **secrets** | `gitleaks detect` — scans for leaked credentials |
| **filesize** | Rejects files >5MB (catches accidental binary commits) |
| **patterns** | Regex scan for API keys, private keys, hardcoded passwords in source files |
| **filenames** | Rejects `.env`, `.pem`, `.key`, `credentials.json`, etc. |

## Build Verification

Uses [Nuke](https://nuke.build) build system in the private repo:

```bash
./build.sh Check --verbosity normal
```

Targets: Clean → Restore → Compile → Check

- SDK: `Godot.NET.Sdk/4.6.1`
- Framework: `net8.0`
- Blocks push if C# doesn't compile

## Versioning

| Tool | Purpose |
|------|---------|
| **GitVersion** | Generates semver from git history |
| **git-cliff** | Generates `CHANGELOG.md` from conventional commits |

Configs: `GitVersion.yml` and `cliff.toml` in this repo, copied into the private repo at build time.

## Self-Healing

The pipeline is self-healing:

1. Agent pushes broken code → integration build fails
2. Integration workflow identifies which files/branches caused the failure
3. A new issue is created with compiler errors and blame info
4. The issue is labeled `agent`, triggering another agent to fix it
5. Merge conflicts get their own resolution issues

This loop continues until the integration build passes.
