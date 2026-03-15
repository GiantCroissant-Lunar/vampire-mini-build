# Research: Autonomous Agent Patterns

Notes on external projects and patterns that could improve the vampire-mini-build pipeline.

## autoresearch (Karpathy)

**Source:** https://github.com/karpathy/autoresearch

An autonomous AI research loop where an agent modifies code, runs experiments, evaluates results, and keeps or discards changes — repeating overnight without human intervention.

### How It Works

```
Human writes program.md (instructions)
         ↓
Agent modifies train.py
         ↓
Runs 5-min training experiment
         ↓
Checks val_bpb metric
         ↓
Improved? → Keep changes
Worse?    → Discard, try something else
         ↓
Repeat (~12 experiments/hour, ~100 overnight)
```

### Key Design Choices

- **Single file to modify** — agent only touches `train.py`, keeping scope manageable
- **Fixed time budget** — every experiment runs exactly 5 minutes, making results comparable
- **Single metric** — `val_bpb` (validation bits per byte), lower is better
- **Self-contained** — one GPU, one file, one metric, no complex configs
- **`program.md` as skill** — human iterates on the instructions, not the code

### Parallels to Our Pipeline

| autoresearch | vampire-mini-build |
|---|---|
| `program.md` | Agent prompt in `agent-sync.yml` |
| Agent modifies `train.py` | Agent modifies game code |
| Eval: `val_bpb` metric | Eval: Nuke build passes |
| Keep/discard loop | Self-healing fix issues |
| ~12 iterations/hour | ~4 parallel agents per plan |

### Ideas to Adopt

#### 1. Quality Gate Beyond Compilation

Currently our pipeline only checks "does it compile?" — equivalent to autoresearch only checking "does it run?". We could add:

- **Godot headless scene validation** — load scenes, check for missing node references
- **Script analysis** — verify exported properties match scene bindings
- **Metric tracking** — count warnings, missing refs, scene complexity

#### 2. Keep/Discard Pattern

Instead of always pushing agent code, we could:

1. Agent writes code on a temp branch
2. Run validation (build + scene check + optional tests)
3. Score the result (compile errors, warnings, missing refs)
4. Only push if score meets threshold
5. If rejected, create a new issue with feedback for retry

#### 3. Externalize Agent Instructions

Move the agent prompt from inline YAML to a standalone `program.md` file:

```
agent-prompt.md          ← Human iterates on this
agent-sync.yml           ← Pipeline reads it
```

This makes prompt iteration faster (no workflow changes needed) and mirrors autoresearch's approach.

#### 4. Overnight Iteration Mode

For larger features, create a "research mode" that:

1. Creates N variations of a solution (different agents or prompt variations)
2. Evaluates each against quality metrics
3. Keeps the best, discards the rest
4. Repeats with refinements

### Not Applicable

- ML training specifics (GPU, tokenizer, model architecture)
- Single-file constraint (game dev requires multiple files)
- The specific metric (val_bpb has no game dev equivalent)
