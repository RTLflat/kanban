import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isBinaryAvailableOnPath, resolveBinaryPathOnPath } from "../../../src/terminal/command-discovery";

const originalPath = process.env.PATH;
const originalPathExt = process.env.PATHEXT;
const tempDirectories: string[] = [];

function createTempDirOnPath(): string {
	const directory = mkdtempSync(join(tmpdir(), "kanban-command-discovery-"));
	tempDirectories.push(directory);
	process.env.PATH = `${directory}${delimiter}${originalPath ?? ""}`;
	return directory;
}

function writeBinary(directory: string, fileName: string, executable = false): string {
	const filePath = join(directory, fileName);
	writeFileSync(filePath, "");
	if (executable) {
		chmodSync(filePath, 0o755);
	}
	return filePath;
}

afterEach(() => {
	if (originalPath === undefined) {
		delete process.env.PATH;
	} else {
		process.env.PATH = originalPath;
	}
	if (originalPathExt === undefined) {
		delete process.env.PATHEXT;
	} else {
		process.env.PATHEXT = originalPathExt;
	}
	for (const directory of tempDirectories) {
		rmSync(directory, { recursive: true, force: true });
	}
	tempDirectories.length = 0;
});

describe("resolveBinaryPathOnPath", () => {
	it.runIf(process.platform === "win32")("resolves a bare binary to its .exe path on PATH", () => {
		const directory = createTempDirOnPath();
		const expected = writeBinary(directory, "mytool.exe");
		process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";

		// Windows paths are case-insensitive; the resolved extension casing comes from
		// PATHEXT (uppercase here), not from the on-disk file name, so compare loosely.
		expect(resolveBinaryPathOnPath("mytool")?.toLowerCase()).toBe(expected.toLowerCase());
	});

	it.runIf(process.platform === "win32")(
		"does not resolve an extensionless-only file, matching isBinaryAvailableOnPath",
		() => {
			const directory = createTempDirOnPath();
			writeBinary(directory, "mytool");
			process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";

			expect(resolveBinaryPathOnPath("mytool")).toBeNull();
			expect(isBinaryAvailableOnPath("mytool")).toBe(false);
		},
	);

	it.runIf(process.platform === "win32")("resolves a .cmd shim on PATH", () => {
		const directory = createTempDirOnPath();
		const expected = writeBinary(directory, "mytool.cmd");
		process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";

		expect(resolveBinaryPathOnPath("mytool")?.toLowerCase()).toBe(expected.toLowerCase());
		expect(isBinaryAvailableOnPath("mytool")).toBe(true);
	});

	it.runIf(process.platform === "win32")("tries the binary as-is when it already ends in a PATHEXT extension", () => {
		const directory = createTempDirOnPath();
		const expected = writeBinary(directory, "mytool.exe");
		process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";

		expect(resolveBinaryPathOnPath("mytool.exe")).toBe(expected);
	});

	it.runIf(process.platform !== "win32")("resolves an executable file on PATH", () => {
		const directory = createTempDirOnPath();
		const expected = writeBinary(directory, "mytool", true);

		expect(resolveBinaryPathOnPath("mytool")).toBe(expected);
	});

	it("returns null when the binary is missing from PATH", () => {
		createTempDirOnPath();

		expect(resolveBinaryPathOnPath("kanban-does-not-exist-tool")).toBeNull();
	});
});
