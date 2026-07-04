# CLI Agent Model Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-task model selection for CLI agents (Claude Code, Codex) on the kanban task card, persisted on the card and passed via the agent's `--model` flag at launch and resume.

**Architecture:** Model support is data on the agent catalog (`modelFlag` + curated `modelOptions`). A new optional `agentModelId` field rides the task card contract and the session-start request, parallel to the existing Cline-only `clineSettings`. `prepareAgentLaunch` centrally appends `[modelFlag, modelId]`; the web-ui picker grows one dropdown branch for CLI agents.

**Tech Stack:** TypeScript, zod (contract), React 19 + Vite (web-ui), Vitest, node-pty launch path.

**Spec:** `docs/superpowers/specs/2026-07-04-cli-agent-model-picker-design.md`

## Global Constraints

- Node >= 22. Lint/format is Biome (`npm run lint`); repo uses tab indentation.
- No `any` types. No inline/dynamic imports (`await import(...)`, `import("pkg").Type`) — top-level imports only. (Exception: `await import(...)` inside existing web-ui test files follows that file's established pattern.)
- Do not touch the Cline path: `clineSettings`, its legacy-field normalization in `api-contract.ts`, `clineProviderService`, or the Cline pickers' behavior.
- Empty/absent `agentModelId` means "agent default" — no flag passed. Values are trimmed; blank normalizes to unset.
- Root tests: `npx vitest run <file>`. Web-ui tests: `cd web-ui && npx vitest run <file>` (run from `web-ui/`).
- Commits per task are pre-authorized by the user's approval of this plan (satisfies the AGENTS.md "never commit unless asked" guardrail). Never use `--no-verify`.

---

### Task 1: Catalog model metadata + contract field

**Files:**
- Modify: `src/core/agent-catalog.ts`
- Modify: `src/core/api-contract.ts:93-170` (card schema) and `:972-987` (start request)
- Create: `test/runtime/core/agent-model-contract.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `RuntimeAgentCatalogEntry.modelFlag?: string`, `RuntimeAgentCatalogEntry.modelOptions?: RuntimeAgentModelOption[]` (`{ id: string; label: string }`); `RuntimeBoardCard.agentModelId?: string` (trimmed, never empty); `RuntimeTaskSessionStartRequest.agentModelId?: string`. Later tasks import `getRuntimeAgentCatalogEntry` (already exported) to read the metadata.

- [ ] **Step 1: Write the failing test**

Create `test/runtime/core/agent-model-contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { getRuntimeAgentCatalogEntry } from "../../../src/core/agent-catalog";
import { runtimeBoardCardSchema, runtimeTaskSessionStartRequestSchema } from "../../../src/core/api-contract";

describe("agent catalog model metadata", () => {
	it("exposes a model flag and curated options for claude and codex", () => {
		const claude = getRuntimeAgentCatalogEntry("claude");
		expect(claude?.modelFlag).toBe("--model");
		expect(claude?.modelOptions?.map((option) => option.id)).toEqual(["sonnet", "opus", "haiku"]);

		const codex = getRuntimeAgentCatalogEntry("codex");
		expect(codex?.modelFlag).toBe("--model");
		expect(codex?.modelOptions?.map((option) => option.id)).toEqual(["gpt-5-codex", "gpt-5"]);
	});

	it("has no model metadata for cline", () => {
		const cline = getRuntimeAgentCatalogEntry("cline");
		expect(cline?.modelFlag).toBeUndefined();
		expect(cline?.modelOptions).toBeUndefined();
	});
});

describe("agentModelId contract field", () => {
	const baseCard = {
		id: "task-1",
		prompt: "do things",
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
	};

	it("persists a trimmed agentModelId on the board card", () => {
		const parsed = runtimeBoardCardSchema.parse({ ...baseCard, agentModelId: "  opus  " });
		expect(parsed.agentModelId).toBe("opus");
	});

	it("drops a blank agentModelId", () => {
		const parsed = runtimeBoardCardSchema.parse({ ...baseCard, agentModelId: "   " });
		expect(parsed.agentModelId).toBeUndefined();
	});

	it("stays absent when not provided", () => {
		const parsed = runtimeBoardCardSchema.parse(baseCard);
		expect(parsed.agentModelId).toBeUndefined();
	});

	it("accepts agentModelId on the session start request", () => {
		const parsed = runtimeTaskSessionStartRequestSchema.parse({
			taskId: "task-1",
			prompt: "p",
			baseRef: "main",
			agentModelId: "opus",
		});
		expect(parsed.agentModelId).toBe("opus");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/runtime/core/agent-model-contract.test.ts`
Expected: FAIL — `modelFlag` does not exist / `agentModelId` is stripped by the schema.

- [ ] **Step 3: Implement catalog metadata**

In `src/core/agent-catalog.ts`, add the option type and extend the entry interface:

```ts
export interface RuntimeAgentModelOption {
	id: string;
	label: string;
}

export interface RuntimeAgentCatalogEntry {
	id: RuntimeAgentId;
	label: string;
	binary: string;
	baseArgs: string[];
	autonomousArgs: string[];
	installUrl: string;
	/** CLI flag used to pass a model at launch (e.g. "--model"). Absent = no per-task model support. */
	modelFlag?: string;
	/** Curated model list for the task card picker; users can also type a custom ID. */
	modelOptions?: RuntimeAgentModelOption[];
}
```

Extend the `claude` entry (keep existing fields):

```ts
	{
		id: "claude",
		label: "Claude Code",
		binary: "claude",
		baseArgs: [],
		autonomousArgs: ["--dangerously-skip-permissions"],
		installUrl: "https://docs.anthropic.com/en/docs/claude-code/quickstart",
		modelFlag: "--model",
		modelOptions: [
			{ id: "sonnet", label: "Sonnet" },
			{ id: "opus", label: "Opus" },
			{ id: "haiku", label: "Haiku" },
		],
	},
```

Extend the `codex` entry:

```ts
	{
		id: "codex",
		label: "OpenAI Codex",
		binary: "codex",
		baseArgs: [],
		autonomousArgs: ["--dangerously-bypass-approvals-and-sandbox"],
		installUrl: "https://github.com/openai/codex",
		modelFlag: "--model",
		modelOptions: [
			{ id: "gpt-5-codex", label: "GPT-5 Codex" },
			{ id: "gpt-5", label: "GPT-5" },
		],
	},
```

Leave cline/opencode/droid/kiro/gemini entries untouched.

- [ ] **Step 4: Implement contract field**

In `src/core/api-contract.ts`, add to the `runtimeBoardCardSchema` object (after `clineSettings` at line 142):

```ts
		agentModelId: z.string().optional(),
```

Update the `.transform` (lines 150-169) to destructure and normalize it:

```ts
	.transform(
		({
			clineProviderId: _legacyProviderId,
			clineModelId: _legacyModelId,
			clineReasoningEffort: _legacyReasoningEffort,
			agentModelId: rawAgentModelId,
			...card
		}) => {
			const clineSettings = normalizeRuntimeTaskClineSettings({
				clineSettings: card.clineSettings,
				clineProviderId: _legacyProviderId,
				clineModelId: _legacyModelId,
				clineReasoningEffort: _legacyReasoningEffort,
			});
			const agentModelId = rawAgentModelId?.trim();
			return {
				...card,
				...(clineSettings !== undefined ? { clineSettings } : {}),
				...(agentModelId ? { agentModelId } : {}),
				title: resolveTaskTitle(card.title, card.prompt),
			};
		},
	);
```

Note: `agentModelId` must be typed `string | undefined` in the inferred `RuntimeBoardCard` — the conditional spread produces exactly that.

In `runtimeTaskSessionStartRequestSchema` (after `clineSettings` at line 985):

```ts
	agentModelId: z.string().optional(),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/runtime/core/agent-model-contract.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/core/agent-catalog.ts src/core/api-contract.ts test/runtime/core/agent-model-contract.test.ts
git commit -m "feat: add per-task agent model metadata to catalog and contract"
```

---

### Task 2: Server launch threading (`--model` at launch)

**Files:**
- Modify: `src/terminal/agent-session-adapters.ts:28-41` (launch input) and `:1440-1449` (`prepareAgentLaunch`)
- Modify: `src/terminal/session-manager.ts:78-93` (`StartTaskSessionRequest`) and `:324-337` (prepare call)
- Modify: `src/trpc/runtime-api.ts:281-295` (CLI start path)
- Test: `test/runtime/terminal/agent-session-adapters.test.ts`

**Interfaces:**
- Consumes: `getRuntimeAgentCatalogEntry(agentId)` → `{ modelFlag?: string } | null` from Task 1; existing `hasCliOption(args, optionName)` helper in `agent-session-adapters.ts:120`.
- Produces: `AgentAdapterLaunchInput.modelId?: string`; `StartTaskSessionRequest.modelId?: string`. Trimming happens in `prepareAgentLaunch`; callers pass the raw value.

- [ ] **Step 1: Write the failing tests**

Append to `test/runtime/terminal/agent-session-adapters.test.ts` (uses the file's existing `setupTempHome()` helper and `prepareAgentLaunch` import):

```ts
describe("per-task model flag", () => {
	it("appends the catalog model flag and value for claude", async () => {
		setupTempHome();
		const launch = await prepareAgentLaunch({
			taskId: "task-model-1",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp",
			prompt: "hello",
			modelId: "opus",
		});
		const flagIndex = launch.args.indexOf("--model");
		expect(flagIndex).toBeGreaterThanOrEqual(0);
		expect(launch.args[flagIndex + 1]).toBe("opus");
	});

	it("appends --model for codex before the prompt", async () => {
		setupTempHome();
		const launch = await prepareAgentLaunch({
			taskId: "task-model-2",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp",
			prompt: "hello",
			modelId: "gpt-5-codex",
		});
		const flagIndex = launch.args.indexOf("--model");
		expect(flagIndex).toBeGreaterThanOrEqual(0);
		expect(launch.args[flagIndex + 1]).toBe("gpt-5-codex");
		expect(launch.args.indexOf("hello")).toBeGreaterThan(flagIndex);
	});

	it("trims the model and skips a blank value", async () => {
		setupTempHome();
		const launch = await prepareAgentLaunch({
			taskId: "task-model-3",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp",
			prompt: "hello",
			modelId: "   ",
		});
		expect(launch.args).not.toContain("--model");
	});

	it("does not duplicate an existing --model argument", async () => {
		setupTempHome();
		const launch = await prepareAgentLaunch({
			taskId: "task-model-4",
			agentId: "claude",
			binary: "claude",
			args: ["--model", "sonnet"],
			cwd: "/tmp",
			prompt: "hello",
			modelId: "opus",
		});
		expect(launch.args.filter((arg) => arg === "--model")).toHaveLength(1);
		expect(launch.args[launch.args.indexOf("--model") + 1]).toBe("sonnet");
	});

	it("ignores modelId for agents without model metadata", async () => {
		setupTempHome();
		const launch = await prepareAgentLaunch({
			taskId: "task-model-5",
			agentId: "gemini",
			binary: "gemini",
			args: [],
			cwd: "/tmp",
			prompt: "hello",
			modelId: "gpt-5",
		});
		expect(launch.args).not.toContain("--model");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/runtime/terminal/agent-session-adapters.test.ts -t "per-task model flag"`
Expected: FAIL — `modelId` is not a known property / no `--model` in args.

- [ ] **Step 3: Implement**

In `src/terminal/agent-session-adapters.ts`:

Add to the imports from `../core/agent-catalog` (new import line next to the existing `../core/api-contract` import):

```ts
import { getRuntimeAgentCatalogEntry } from "../core/agent-catalog";
```

Add to `AgentAdapterLaunchInput` (after `args: string[];`):

```ts
	/** Per-task model override; appended as [catalog modelFlag, modelId] when the agent supports it. */
	modelId?: string;
```

Replace `prepareAgentLaunch` (lines 1440-1449):

```ts
export async function prepareAgentLaunch(input: AgentAdapterLaunchInput): Promise<PreparedAgentLaunch> {
	const preparedPrompt = await prepareTaskPromptWithImages({
		prompt: input.prompt,
		images: input.images,
	});
	const modelId = input.modelId?.trim();
	const modelFlag = getRuntimeAgentCatalogEntry(input.agentId)?.modelFlag;
	const args =
		modelId && modelFlag && !hasCliOption(input.args, modelFlag)
			? [...input.args, modelFlag, modelId]
			: input.args;
	return await ADAPTERS[input.agentId].prepare({
		...input,
		args,
		prompt: preparedPrompt,
	});
}
```

In `src/terminal/session-manager.ts`, add to `StartTaskSessionRequest` (after `args: string[];`):

```ts
	modelId?: string;
```

and to the `prepareAgentLaunch` call at lines 324-337 (after `args: request.args,`):

```ts
			modelId: request.modelId,
```

(`cloneStartTaskSessionRequest` spreads the request, so restart-after-crash keeps the model automatically.)

In `src/trpc/runtime-api.ts`, add to the `terminalManager.startTaskSession` call at lines 281-295 (after `args: resolved.args,`):

```ts
					modelId: body.agentModelId,
```

The Cline path (`useClinePath` branch) ignores `agentModelId` by design.

**Known risk (from spec):** on trash-restore the codex adapter appends the `resume --last` subcommand after the args, producing `codex --model X ... resume --last`. If the installed Codex CLI rejects a root-level `--model` before the `resume` subcommand (verify in Task 7's smoke test), the mitigation is: in `codexAdapter.prepare`, when `input.resumeFromTrash` is set, strip the trailing `["--model", value]` pair from `codexArgs` — resumed Codex sessions keep their original model anyway.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/runtime/terminal/agent-session-adapters.test.ts`
Expected: PASS, including all pre-existing tests in the file.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/terminal/agent-session-adapters.ts src/terminal/session-manager.ts src/trpc/runtime-api.ts test/runtime/terminal/agent-session-adapters.test.ts
git commit -m "feat: pass per-task agent model flag at CLI agent launch"
```

---

### Task 3: Task card picker UI (web-ui component)

**Files:**
- Modify: `web-ui/src/components/task-agent-model-picker.tsx`
- Test: `web-ui/src/components/task-agent-model-picker.test.tsx`

**Interfaces:**
- Consumes: `getRuntimeAgentCatalogEntry` via the `@runtime-agent-catalog` alias (→ `src/core/agent-catalog.ts`); `SearchSelectDropdown` props `allowCustomValue` / `customValueLabel` (`web-ui/src/components/search-select-dropdown.tsx:49-50`).
- Produces: `TaskAgentModelPicker` component props `agentModelId?: string` and `onAgentModelIdChange?: (value: string | undefined) => void`. Task 5 wires these from both creation surfaces. The `useTaskAgentModelPicker` hook is unchanged.

- [ ] **Step 1: Update the catalog mock and write the failing tests**

In `web-ui/src/components/task-agent-model-picker.test.tsx`, replace the `vi.mock("@runtime-agent-catalog", ...)` block (lines 16-21) — the component will now also import `getRuntimeAgentCatalogEntry`, and the old mock would return `undefined` for it and crash every existing test:

```ts
const mockAgentCatalog = [
	{ id: "cline", label: "Cline", binary: "cline" },
	{
		id: "claude",
		label: "Claude Code",
		binary: "claude",
		modelFlag: "--model",
		modelOptions: [
			{ id: "sonnet", label: "Sonnet" },
			{ id: "opus", label: "Opus" },
		],
	},
	{ id: "droid", label: "Factory Droid", binary: "droid" },
];

vi.mock("@runtime-agent-catalog", () => ({
	getRuntimeLaunchSupportedAgentCatalog: vi.fn(() => mockAgentCatalog),
	getRuntimeAgentCatalogEntry: vi.fn(
		(agentId: string) => mockAgentCatalog.find((entry) => entry.id === agentId) ?? null,
	),
}));
```

Append a new describe block at the end of the file (same render harness as the existing component tests):

```tsx
describe("TaskAgentModelPicker – CLI agent model picker", () => {
	async function renderCliPicker(props: {
		agentId: RuntimeAgentId | undefined;
		agentModelId?: string;
		onAgentModelIdChange?: (value: string | undefined) => void;
	}) {
		const { TaskAgentModelPicker } = await import("@/components/task-agent-model-picker");
		await act(async () =>
			root.render(
				<TaskAgentModelPicker
					agentId={props.agentId}
					onAgentIdChange={() => {}}
					agentModelId={props.agentModelId}
					onAgentModelIdChange={props.onAgentModelIdChange}
					onClineSettingsChange={() => {}}
					agentOptions={[
						{ value: "", label: "Cline" },
						{ value: "claude", label: "Claude Code" },
						{ value: "droid", label: "Factory Droid" },
					]}
					clineProviderOptions={[]}
					clineModelOptions={[]}
					isLoadingProviders={false}
					isLoadingModels={false}
					defaultAgentId={"cline" as RuntimeAgentId}
				/>,
			),
		);
	}

	function expandSettings() {
		const trigger = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Override Agent Settings"),
		);
		expect(trigger).toBeDefined();
		act(() => trigger?.click());
	}

	it("shows the model picker for a CLI agent with model metadata", async () => {
		await renderCliPicker({ agentId: "claude" as RuntimeAgentId });
		expandSettings();
		expect(container.textContent).toContain("Model");
	});

	it("hides the model picker for a CLI agent without model metadata", async () => {
		await renderCliPicker({ agentId: "droid" as RuntimeAgentId });
		expandSettings();
		expect(container.textContent).not.toContain("Model");
	});

	it("clears the model when the agent changes", async () => {
		const onAgentModelIdChange = vi.fn();
		await renderCliPicker({
			agentId: "claude" as RuntimeAgentId,
			agentModelId: "opus",
			onAgentModelIdChange,
		});
		expandSettings();
		const select = container.querySelector("select");
		expect(select).not.toBeNull();
		await act(async () => {
			if (select) {
				select.value = "droid";
				select.dispatchEvent(new Event("change", { bubbles: true }));
			}
		});
		expect(onAgentModelIdChange).toHaveBeenCalledWith(undefined);
	});
});
```

- [ ] **Step 2: Run tests to verify the new ones fail and old ones still pass**

Run: `cd web-ui && npx vitest run src/components/task-agent-model-picker.test.tsx`
Expected: the three new tests FAIL (no `agentModelId` prop / no Model dropdown for claude); all pre-existing tests PASS (the mock replacement must not break them — if it does, fix the mock, not the tests).

- [ ] **Step 3: Implement the component branch**

In `web-ui/src/components/task-agent-model-picker.tsx`:

Change the line-2 import:

```ts
import { getRuntimeAgentCatalogEntry, getRuntimeLaunchSupportedAgentCatalog } from "@runtime-agent-catalog";
```

Add the two props to `TaskAgentModelPicker` (both the destructuring and the type literal, next to `clineSettings` / `onClineSettingsChange`):

```ts
	agentModelId,
	onAgentModelIdChange,
```

```ts
	/** Per-task model override for CLI agents (claude, codex, ...); unset = agent default. */
	agentModelId?: string;
	onAgentModelIdChange?: (value: string | undefined) => void;
```

Inside the component, after the `showClineModelPicker` computation (line 285), add:

```ts
	// CLI agents (claude, codex, ...) get a catalog-driven model picker instead of the Cline pickers.
	const effectiveAgentEntry = effectiveAgentId ? getRuntimeAgentCatalogEntry(effectiveAgentId) : null;
	const showCliModelPicker = !showClineProviderPicker && Boolean(effectiveAgentEntry?.modelFlag);
	const [isCliModelPopoverOpen, setIsCliModelPopoverOpen] = useState(false);
	const cliModelOptions = useMemo(() => {
		const curated = (effectiveAgentEntry?.modelOptions ?? []).map((option) => ({
			value: option.id,
			label: option.label,
		}));
		const selected = agentModelId?.trim() ?? "";
		const isSelectedCurated = !selected || curated.some((option) => option.value === selected);
		return [
			{ value: "", label: "Agent default" },
			...curated,
			// Keep a previously chosen custom ID visible in the dropdown button.
			...(isSelectedCurated ? [] : [{ value: selected, label: selected }]),
		];
	}, [agentModelId, effectiveAgentEntry]);
```

Extend the two popover effects (lines 374-383) to include the new popover:

```ts
	useEffect(() => {
		if (!isSettingsExpanded) {
			setIsProviderPopoverOpen(false);
			setIsModelPopoverOpen(false);
			setIsCliModelPopoverOpen(false);
		}
	}, [isSettingsExpanded]);

	useEffect(() => {
		onPopoverOpenChange?.(isProviderPopoverOpen || isModelPopoverOpen || isCliModelPopoverOpen);
	}, [isCliModelPopoverOpen, isModelPopoverOpen, isProviderPopoverOpen, onPopoverOpenChange]);
```

In the agent `NativeSelect` `onChange` (lines 473-480), clear the model on every agent change:

```ts
								onChange={(e) => {
									const value = e.currentTarget.value;
									onAgentIdChange(value ? (value as RuntimeAgentId) : undefined);
									onAgentModelIdChange?.(undefined);
									if (value !== "cline") {
										onClineSettingsChange?.(undefined);
										setReasoningEffort("");
									}
								}}
```

After the `{showClineProviderPicker ? (...) : null}` block (line 601), add the CLI model dropdown as a sibling:

```tsx
						{showCliModelPicker ? (
							<div className="w-full sm:w-1/2 min-w-0">
								<span className="text-[11px] text-text-secondary block mb-1">Model</span>
								<SearchSelectDropdown
									options={cliModelOptions}
									selectedValue={agentModelId ?? ""}
									onSelect={(value) => {
										const trimmed = value.trim();
										onAgentModelIdChange?.(trimmed ? trimmed : undefined);
									}}
									fill
									size="sm"
									placeholder="Search models..."
									emptyText="No models available"
									noResultsText="No matching models"
									showSelectedIndicator
									allowCustomValue
									customValueLabel={(query) => `Use "${query}" as model ID`}
									onPopoverOpenChange={setIsCliModelPopoverOpen}
								/>
							</div>
						) : null}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web-ui && npx vitest run src/components/task-agent-model-picker.test.tsx`
Expected: PASS (all new and pre-existing tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run web:typecheck`
Expected: clean (call sites don't pass the new optional props yet — that's Task 5).

```bash
git add web-ui/src/components/task-agent-model-picker.tsx web-ui/src/components/task-agent-model-picker.test.tsx
git commit -m "feat(web-ui): CLI agent model dropdown in task agent picker"
```

---

### Task 4: Persist `agentModelId` through board state and editor hooks

**Files:**
- Modify: `src/core/task-board-mutations.ts:17-37` (input types), `:305-315` (create), `:621-635` (update)
- Modify: `web-ui/src/types/board.ts:47-48` (`BoardCard`)
- Modify: `web-ui/src/state/board-state.ts` — `TaskDraft` (:23-31), `boardCardFromUnknown` (:155-205), `addTaskToColumnWithResult` (:337-352), `updateTask` (:532-549), `updateTaskTitle` (:569-579), `disableTaskAutoReview` (:659-668)
- Modify: `web-ui/src/hooks/use-task-editor.ts` (state at :124-127, handlers at :205-475)
- Modify: `web-ui/src/hooks/use-task-sessions.ts:167-168`
- Modify: `web-ui/src/hooks/use-board-interactions.ts:807-816`
- Test: `web-ui/src/state/board-state.test.ts`

**Interfaces:**
- Consumes: `BoardCard.agentModelId?: string` mirrors `RuntimeBoardCard.agentModelId` from Task 1.
- Produces: `TaskDraft.agentModelId?: string`; `RuntimeCreateTaskInput.agentModelId?: string`; `RuntimeUpdateTaskInput.agentModelId?: string | null`; `useTaskEditor` returns `newTaskAgentModelId` / `setNewTaskAgentModelId` / `editTaskAgentModelId` / `setEditTaskAgentModelId` (types: `string | undefined` / `(value: string | undefined) => void`). Task 5 consumes these.

- [ ] **Step 1: Write the failing test**

Append to `web-ui/src/state/board-state.test.ts` (uses the file's existing `createInitialBoardData` import; add `updateTask` to the existing `@/state/board-state` import list):

```ts
describe("agentModelId threading", () => {
	it("persists agentModelId through create, title update, and auto-review disable", () => {
		let board = addTaskToColumn(createInitialBoardData(), "backlog", {
			prompt: "Model task",
			baseRef: "main",
			agentId: "claude",
			agentModelId: "opus",
		});
		const findCard = () =>
			board.columns.find((column) => column.id === "backlog")?.cards.find((card) => card.prompt === "Model task");
		const created = findCard();
		expect(created?.agentModelId).toBe("opus");

		board = updateTaskTitle(board, created?.id ?? "", "Renamed").board;
		expect(findCard()?.agentModelId).toBe("opus");

		board = disableTaskAutoReview(board, created?.id ?? "").board;
		expect(findCard()?.agentModelId).toBe("opus");
	});

	it("clears agentModelId when an update omits it", () => {
		let board = addTaskToColumn(createInitialBoardData(), "backlog", {
			prompt: "Model task",
			baseRef: "main",
			agentId: "claude",
			agentModelId: "opus",
		});
		const taskId =
			board.columns.find((column) => column.id === "backlog")?.cards.find((card) => card.prompt === "Model task")
				?.id ?? "";
		board = updateTask(board, taskId, {
			prompt: "Model task",
			startInPlanMode: false,
			baseRef: "main",
		}).board;
		const card = board.columns
			.find((column) => column.id === "backlog")
			?.cards.find((task) => task.id === taskId);
		expect(card?.agentModelId).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web-ui && npx vitest run src/state/board-state.test.ts -t "agentModelId threading"`
Expected: FAIL — `agentModelId` is not an accepted draft field / undefined on the created card.

- [ ] **Step 3: Implement the shared mutations**

In `src/core/task-board-mutations.ts`:

`RuntimeCreateTaskInput` (after `clineSettings` at line 23): `agentModelId?: string;`
`RuntimeUpdateTaskInput` (after `clineSettings` at line 35): `agentModelId?: string | null;`

In `addTaskToColumn`'s card literal (after the `clineSettings` spread at line 311):

```ts
		...(input.agentModelId ? { agentModelId: input.agentModelId } : {}),
```

In `updateTask`'s card literal (after the `clineSettings` ternary at lines 627-632):

```ts
				agentModelId: input.agentModelId === undefined ? card.agentModelId : (input.agentModelId ?? undefined),
```

- [ ] **Step 4: Implement the web-ui state layer**

`web-ui/src/types/board.ts` — `BoardCard` after `clineSettings` (line 48): `agentModelId?: string;`

`web-ui/src/state/board-state.ts`:
- `TaskDraft` (after `clineSettings` at line 29): `agentModelId?: string;`
- `boardCardFromUnknown`: add `agentModelId?: unknown;` to the raw shape (after `clineSettings` at line 161) and to the returned object (after the `clineSettings` spread at line 201):

```ts
		...(typeof card.agentModelId === "string" && card.agentModelId.trim()
			? { agentModelId: card.agentModelId.trim() }
			: {}),
```

- `addTaskToColumnWithResult` input literal (after `clineSettings: draft.clineSettings,` at line 348): `agentModelId: draft.agentModelId,`
- `updateTask` card literal (after `clineSettings: draft.clineSettings,` at line 546): `agentModelId: draft.agentModelId,`
- `updateTaskTitle` draft (after line 577): `agentModelId: selection.card.agentModelId,`
- `disableTaskAutoReview` draft (after line 666): `agentModelId: selection.card.agentModelId,`
- `applyTaskDetailClineSettingsSelection` (lines 601-610): deliberately do NOT pass `agentModelId` — switching the task to Cline via the detail panel clears any CLI model override (the `updateTask` draft assignment sets it to `undefined`).

`web-ui/src/hooks/use-board-interactions.ts` — duplicate-task draft (after `clineSettings: selection.card.clineSettings,` at line 814): `agentModelId: selection.card.agentModelId,`

`web-ui/src/hooks/use-task-sessions.ts` — start-request payload (after `clineSettings: task.clineSettings,` at line 168): `agentModelId: task.agentModelId,`

- [ ] **Step 5: Implement the editor hook state**

In `web-ui/src/hooks/use-task-editor.ts`, mirror `clineSettings` at every site:

State (after line 127):

```ts
	const [newTaskAgentModelId, setNewTaskAgentModelId] = useState<string | undefined>(undefined);
	const [editTaskAgentModelId, setEditTaskAgentModelId] = useState<string | undefined>(undefined);
```

- `handleOpenCreateTask` (:205-213): add `setNewTaskAgentModelId(undefined);` next to `setNewTaskClineSettings(undefined);`
- `handleCancelCreateTask` (:215-223): add `setNewTaskAgentModelId(undefined);`
- `handleOpenEditTask` (:225-248): add `setEditTaskAgentModelId(task.agentModelId);` after `setEditTaskClineSettings(task.clineSettings);`
- `handleSaveEditedTask` (:261-303): add `agentModelId: editTaskAgentModelId,` to the `updateTask` draft (after `clineSettings`), add `setEditTaskAgentModelId(undefined);` to the reset block, and add `editTaskAgentModelId` to the dependency array.
- `handleCreateTask` (:340-398): add `agentModelId: newTaskAgentModelId,` to the `addTaskToColumnWithResult` draft, `setNewTaskAgentModelId(undefined);` to the reset block, and `newTaskAgentModelId` to the dependency array.
- `handleCreateTasks` (:400-468): same three additions.
- `resetTaskEditorState` (:470+): add `setNewTaskAgentModelId(undefined);` and `setEditTaskAgentModelId(undefined);`
- Hook return object and its TypeScript interface (`newTaskAgentModelId` at :52-54 area, `editTaskAgentModelId` at :70-72 area): add all four new members:

```ts
	newTaskAgentModelId: string | undefined;
	setNewTaskAgentModelId: (value: string | undefined) => void;
	editTaskAgentModelId: string | undefined;
	setEditTaskAgentModelId: (value: string | undefined) => void;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd web-ui && npx vitest run src/state/board-state.test.ts src/hooks/use-task-editor.test.tsx src/hooks/use-board-interactions.test.tsx src/hooks/use-task-sessions.test.tsx`
Expected: PASS (new tests plus all pre-existing ones).

Run: `npx vitest run test/runtime/core/agent-model-contract.test.ts` (shared `task-board-mutations.ts` changed — root suite must still be green; also run any existing task-board-mutations tests: `npx vitest run test/runtime`)
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck && npm run web:typecheck`
Expected: clean.

```bash
git add src/core/task-board-mutations.ts web-ui/src/types/board.ts web-ui/src/state/board-state.ts web-ui/src/state/board-state.test.ts web-ui/src/hooks/use-task-editor.ts web-ui/src/hooks/use-task-sessions.ts web-ui/src/hooks/use-board-interactions.ts
git commit -m "feat(web-ui): persist per-task agent model on board cards"
```

---

### Task 5: Wire App, creation surfaces, and board-card badge

**Files:**
- Modify: `web-ui/src/App.tsx` (destructure at :303-306/:321-324, edit card props at :784-791, create card props at :1132-1139, and the `TaskCreateDialog` call site — search for `<TaskCreateDialog`)
- Modify: `web-ui/src/components/task-inline-create-card.tsx:70-113` (props) and `:311-330` (picker)
- Modify: `web-ui/src/components/task-create-dialog.tsx:152-163` (props) and the `<TaskAgentModelPicker` at `:580`
- Modify: `web-ui/src/components/board-card.tsx:437-464` (badge label)
- Test: `web-ui/src/components/board-card.test.tsx`

**Interfaces:**
- Consumes: `useTaskEditor` members and picker props produced in Tasks 3-4.
- Produces: user-visible feature — nothing downstream consumes new symbols.

- [ ] **Step 1: Write the failing badge test**

Append to `web-ui/src/components/board-card.test.tsx`, using the file's existing `createCard(overrides)` helper and render harness (mirror how an existing badge/label test in that file renders `BoardCard` and asserts on `container.textContent`):

```tsx
describe("BoardCard – CLI agent model badge", () => {
	it("shows the agent label and curated model label", async () => {
		await renderBoardCard(createCard({ agentId: "claude", agentModelId: "opus" }));
		expect(container.textContent).toContain("Claude Code · Opus");
	});

	it("falls back to the raw model id for custom models", async () => {
		await renderBoardCard(createCard({ agentId: "claude", agentModelId: "claude-fable-5" }));
		expect(container.textContent).toContain("Claude Code · claude-fable-5");
	});
});
```

(`renderBoardCard` = whatever render helper the existing tests in this file use; reuse it verbatim rather than inventing a new harness. If the file's catalog import is mocked, extend the mock the same way Task 3 extended the picker test's mock.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web-ui && npx vitest run src/components/board-card.test.tsx -t "CLI agent model badge"`
Expected: FAIL — badge renders only "Claude Code", no model part.

- [ ] **Step 3: Implement the badge**

In `web-ui/src/components/board-card.tsx`, extend `modelOverrideLabel` (lines 437-464) with a CLI branch ahead of the Cline logic, and add the new deps:

```ts
	const modelOverrideLabel = useMemo(() => {
		if (card.agentModelId) {
			const entry = card.agentId ? getRuntimeAgentCatalogEntry(card.agentId) : null;
			return entry?.modelOptions?.find((option) => option.id === card.agentModelId)?.label ?? card.agentModelId;
		}
		if (card.clineSettings === undefined) {
			return null;
		}
		// ... existing Cline label logic unchanged ...
	}, [card.agentId, card.agentModelId, card.clineSettings, defaultClineModelId]);
```

(`getRuntimeAgentCatalogEntry` is already imported in this file — see line 434.)

- [ ] **Step 4: Wire the creation surfaces**

`web-ui/src/components/task-inline-create-card.tsx`: add props (destructuring after `onClineSettingsChange` at line 73, type literal after line 105):

```ts
	agentModelId,
	onAgentModelIdChange,
```

```ts
	agentModelId?: string;
	onAgentModelIdChange?: (value: string | undefined) => void;
```

and pass them to `<TaskAgentModelPicker` (after `onClineSettingsChange={onClineSettingsChange}` at line 316):

```tsx
						agentModelId={agentModelId}
						onAgentModelIdChange={onAgentModelIdChange}
```

`web-ui/src/components/task-create-dialog.tsx`: identical prop additions (destructuring + type literal near lines 152-163) and pass-through on its `<TaskAgentModelPicker` (line 580).

`web-ui/src/App.tsx`:
- Destructure from `useTaskEditor` (after `setNewTaskClineSettings` at line 306): `newTaskAgentModelId, setNewTaskAgentModelId,` and (after `setEditTaskClineSettings` at line 324): `editTaskAgentModelId, setEditTaskAgentModelId,`
- Edit-card call site (after `onClineSettingsChange={setEditTaskClineSettings}` at line 787):

```tsx
			agentModelId={editTaskAgentModelId}
			onAgentModelIdChange={setEditTaskAgentModelId}
```

- Create-card call site (after line 1135):

```tsx
					agentModelId={newTaskAgentModelId}
					onAgentModelIdChange={setNewTaskAgentModelId}
```

- `<TaskCreateDialog` call site: add the same two props as the create card (`newTask*` pair).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web-ui && npx vitest run src/components/board-card.test.tsx src/components/task-agent-model-picker.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run web:typecheck`
Expected: clean.

```bash
git add web-ui/src/App.tsx web-ui/src/components/task-inline-create-card.tsx web-ui/src/components/task-create-dialog.tsx web-ui/src/components/board-card.tsx web-ui/src/components/board-card.test.tsx
git commit -m "feat(web-ui): choose CLI agent model on the task card"
```

---

### Task 6: Verify Droid and Kiro model flags (data-only follow-up)

**Files:**
- Modify (only if confirmed): `src/core/agent-catalog.ts`, `test/runtime/core/agent-model-contract.test.ts`, `test/runtime/terminal/agent-session-adapters.test.ts`

**Interfaces:**
- Consumes: the Task 1 metadata shape. No new symbols.

- [ ] **Step 1: Verify against official docs**

Check whether the *interactive* launch commands Kanban uses accept a model flag:
- Droid: Kanban launches `droid` (interactive TUI, `src/core/agent-catalog.ts:48`). Check https://docs.factory.ai/cli/ — the documented `-m/--model` flag belongs to `droid exec`; confirm whether plain `droid` accepts it too.
- Kiro: Kanban launches `kiro-cli chat` (`src/core/agent-catalog.ts:56-57`). Check https://kiro.dev/docs/ for a `--model` option on the `chat` subcommand.

- [ ] **Step 2: Add metadata only for confirmed agents**

For each confirmed agent, add `modelFlag` + a curated `modelOptions` list (top 2-4 models from that vendor's docs) to its catalog entry — same shape as claude/codex in Task 1 — plus:
- one assertion in `test/runtime/core/agent-model-contract.test.ts` mirroring the claude/codex expectations, and
- one launch test in `test/runtime/terminal/agent-session-adapters.test.ts` mirroring the Task 2 claude test (note: kiro's `baseArgs` is `["chat"]`, so pass `args: ["chat"]` and assert the flag lands after it).

If a flag is NOT confirmed for interactive launch, make no change for that agent — absence of metadata correctly hides the picker.

- [ ] **Step 3: Run tests and commit (skip commit if nothing confirmed)**

Run: `npx vitest run test/runtime/core/agent-model-contract.test.ts test/runtime/terminal/agent-session-adapters.test.ts`
Expected: PASS.

```bash
git add src/core/agent-catalog.ts test/runtime/core/agent-model-contract.test.ts test/runtime/terminal/agent-session-adapters.test.ts
git commit -m "feat: per-task model support for droid/kiro"
```

If neither is confirmed: no commit; report the finding in the task summary.

---

### Task 7: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Root gate**

Run: `npm run check`
Expected: Biome clean, typecheck clean, all root tests pass.

- [ ] **Step 2: Web-ui gate**

Run: `npm run web:typecheck && npm run web:test`
Expected: clean / all pass.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: completes without errors.

- [ ] **Step 4: End-to-end smoke (manual, use the `verify` skill if executing interactively)**

Start `npm run dev` + `npm run web:dev`, create a task with Agent = Claude Code and Model = Opus, start it, and confirm the spawned terminal command line includes `--model opus` (visible in the task terminal's first line / process args). Confirm a task with Model = "Agent default" launches without a `--model` flag.

Also exercise the Task 2 known risk: create a Codex task with a model set, move it to Done/trash, restore it, and confirm the resumed session launches (no "unexpected argument --model" error). If it errors, apply the codexAdapter mitigation documented in Task 2 Step 3 and add a regression test for `resumeFromTrash` + `modelId` in `agent-session-adapters.test.ts`.
