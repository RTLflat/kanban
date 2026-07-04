# CLI Agent Model Picker — Design

**Date:** 2026-07-04
**Status:** Approved

## Problem

The task card's "Override Agent Settings" section lets you pick a provider and model only when the agent is the native Cline runtime. For CLI agents (Claude Code, Codex, Droid, Kiro) there is no model control anywhere — launch adapters never pass a model flag, so every task runs on the agent's own default model.

## Goal

Per-task model selection for CLI agents on the task card, persisted with the card and applied at launch and resume via the agent's `--model` flag. Model options come from a short curated list per agent plus free-text custom input.

Out of scope: global default model settings, changing anything about the Cline provider/model picker, pre-validating model IDs against provider APIs.

## Design

### 1. Agent catalog metadata (`src/core/agent-catalog.ts`)

`RuntimeAgentCatalogEntry` gains two optional fields:

```ts
modelFlag?: string;                              // e.g. "--model"
modelOptions?: { id: string; label: string }[];  // curated list
```

Initial data:

| Agent | modelFlag | modelOptions |
|---|---|---|
| claude | `--model` | `sonnet`, `opus`, `haiku` (aliases; Claude Code resolves to latest) |
| codex | `--model` | `gpt-5-codex`, `gpt-5` |
| droid, kiro | none initially | verify flag support against vendor docs during implementation; add metadata if confirmed |
| cline | none | uses existing `clineSettings` path |

No metadata on an entry means no picker is shown for that agent. Adding model support for a new agent is a catalog data edit, not a code change.

### 2. Contract (`src/core/api-contract.ts`)

One new optional field, `agentModelId: string` (trimmed, non-empty), added to:

- `runtimeBoardCardSchema` — persisted per task card
- `runtimeTaskSessionStartRequestSchema` — sent when a task session starts

It sits alongside `clineSettings`, never inside it. The existing Cline settings bundle and its legacy-field normalization are untouched. Absent/empty means "agent default" — no flag is passed.

### 3. UI (web-ui)

- **`task-agent-model-picker.tsx`** — new branch: when the effective agent is a CLI agent whose catalog entry has `modelFlag`, render a Model dropdown in the existing "Override Agent Settings" collapsible. Uses the existing `SearchSelectDropdown` with `allowCustomValue` (curated list + free-text custom IDs). First option "Agent default" (empty). `useTaskAgentModelPicker` tracks `agentModelId` and resets it when the agent changes. The Cline provider→model pickers and the CLI model picker are mutually exclusive per agent.
- **Creation surfaces** — `task-inline-create-card.tsx` and `task-create-dialog.tsx` persist `agentModelId` onto the card exactly as they persist `clineSettings` today.
- **`board-card.tsx`** — the badge that shows Cline model/provider also shows `agentModelId` for CLI agents (e.g. "Claude Code · opus").
- **Post-creation editing** — wherever card agent settings are editable today (`use-task-editor` handles `clineSettings`), `agentModelId` gets the same treatment. No new editing surface.

### 4. Launch path (server)

- **`src/trpc/runtime-api.ts`** — the CLI-agent start path threads `agentModelId` from the start request into the terminal launch, next to `agentId`. The Cline path ignores it.
- **`src/terminal/agent-session-adapters.ts`** — `AgentAdapterLaunchInput` gains `modelId?: string`. A shared helper appends `[modelFlag, modelId]` after the agent's base args when both catalog metadata and a value are present (after-base-args placement keeps subcommand CLIs like `kiro-cli chat` correct if added later).
- **Resume** — the flag is passed again on resume so a task keeps its model across restarts. `claude --resume --model X` is valid; Codex resume behavior is verified during implementation.
- **OpenCode** — its existing self-config `--model` logic is untouched (not launch-supported today).

### 5. Error handling

- Args go to `node-pty` as an argv array — no shell interpolation, no injection surface.
- Values are trimmed; empty treated as unset (enforced in zod and in the adapter helper).
- Invalid custom model IDs fail inside the agent CLI, visibly in the task terminal — same failure mode as running the CLI by hand. No pre-validation.

### 6. Testing

Unit tests in the seams that already have them:

- **Adapter arg-building** — claude/codex launch and resume with/without model; model combined with autonomy flags; no flag emitted when metadata or value is missing.
- **Picker hook/component** (`task-agent-model-picker.test.tsx` patterns) — dropdown visible only for agents with `modelFlag`; hidden for Cline (provider pickers shown instead); `agentModelId` resets on agent switch.
- **Contract schema** — `agentModelId` optional, trimmed, empty rejected/normalized to unset.

## Alternatives considered

- **Generalize `clineSettings.modelId` for all agents** — rejected: entangles the Cline-specific provider/reasoning bundle (with its legacy-field normalization) with CLI flag semantics for near-zero savings.
- **Global per-agent default model in runtime settings** — rejected: not per-task, which is the point of the request.
- **Free-text only / curated-only model lists** — rejected in favor of curated + custom via the existing `allowCustomValue` dropdown.
