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
