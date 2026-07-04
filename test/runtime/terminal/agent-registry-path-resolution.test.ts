import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import { buildRuntimeConfigResponse, resolveAgentCommand } from "../../../src/terminal/agent-registry";

// Unlike agent-registry.test.ts, this file does not mock command-discovery.ts.
// It exercises the real PATH-resolution wiring end to end: a fake agent binary
// placed on PATH must come back out of resolveAgentCommand as its absolute path.
const originalPath = process.env.PATH;
const tempDirectories: string[] = [];

function createRuntimeConfigState(overrides: Partial<RuntimeConfigState> = {}): RuntimeConfigState {
	return {
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project-config.json",
		selectedAgentId: "claude",
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		readyForReviewNotificationsEnabled: true,
		shortcuts: [],
		commitPromptTemplate: "commit",
		openPrPromptTemplate: "pr",
		commitPromptTemplateDefault: "commit",
		openPrPromptTemplateDefault: "pr",
		...overrides,
	};
}

afterEach(() => {
	if (originalPath === undefined) {
		delete process.env.PATH;
	} else {
		process.env.PATH = originalPath;
	}
	for (const directory of tempDirectories) {
		rmSync(directory, { recursive: true, force: true });
	}
	tempDirectories.length = 0;
});

describe("resolveAgentCommand PATH resolution (unmocked)", () => {
	it("resolves the configured agent binary to its absolute path when found on PATH", () => {
		const directory = mkdtempSync(join(tmpdir(), "kanban-agent-registry-path-"));
		tempDirectories.push(directory);
		const fileName = process.platform === "win32" ? "claude.exe" : "claude";
		const filePath = join(directory, fileName);
		writeFileSync(filePath, "");
		if (process.platform !== "win32") {
			chmodSync(filePath, 0o755);
		}
		process.env.PATH = `${directory}${delimiter}${originalPath ?? ""}`;

		const resolved = resolveAgentCommand(createRuntimeConfigState({ selectedAgentId: "claude" }));

		// Windows paths are case-insensitive; the resolved extension casing comes from
		// PATHEXT, not necessarily from the on-disk file name, so compare loosely.
		expect(resolved?.binary?.toLowerCase()).toBe(filePath.toLowerCase());
		expect(resolved?.command).toBe("claude");
	});

	it("keeps buildRuntimeConfigResponse's effectiveCommand as the short display form, not the absolute resolved path", () => {
		const directory = mkdtempSync(join(tmpdir(), "kanban-agent-registry-path-"));
		tempDirectories.push(directory);
		const fileName = process.platform === "win32" ? "claude.exe" : "claude";
		const filePath = join(directory, fileName);
		writeFileSync(filePath, "");
		if (process.platform !== "win32") {
			chmodSync(filePath, 0o755);
		}
		process.env.PATH = `${directory}${delimiter}${originalPath ?? ""}`;

		const response = buildRuntimeConfigResponse(createRuntimeConfigState({ selectedAgentId: "claude" }), {
			providerId: null,
			modelId: null,
			baseUrl: null,
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});

		// The resolved binary is an absolute filesystem path; effectiveCommand is a
		// UI-facing label (terminal panel + "Run" button) and must stay short.
		expect(response.effectiveCommand).toBe("claude");
		expect(response.effectiveCommand).not.toContain(directory);
	});
});
