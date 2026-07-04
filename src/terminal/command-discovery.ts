import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

function canAccessPath(path: string): boolean {
	try {
		accessSync(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function getWindowsPathExtensions(): string[] {
	return process.env.PATHEXT?.split(";").filter(Boolean) ?? [".COM", ".EXE", ".BAT", ".CMD"];
}

// CreateProcess (and the node-pty backend that wraps it) cannot launch an extensionless
// file or a bare name by itself the way a shell can: it needs a concrete, launchable
// candidate (an explicit extension, in PATHEXT order). This intentionally excludes the
// bare extensionless name that `getWindowsPathExtensions` callers used to also try.
function getWindowsLaunchableCandidates(binary: string): string[] {
	const pathext = getWindowsPathExtensions();
	const lowerBinary = binary.toLowerCase();
	if (pathext.some((extension) => lowerBinary.endsWith(extension.toLowerCase()))) {
		return [binary];
	}
	return pathext.map((extension) => `${binary}${extension}`);
}

// Intentionally perform PATH inspection in-process instead of spawning `which`, `where`,
// `command -v`, or an interactive shell.
//
// Why this exists:
// Kanban is launched from the user's shell and inherits that shell's environment, including
// PATH and exported variables. For agent detection and other startup-time capability checks,
// the question we care about is "can the current Kanban process directly execute this binary
// from its inherited environment?" A direct PATH scan answers exactly that question.
//
// Why we do not delegate to shell commands:
// 1. Spawning helper commands like `which` or `where` adds unnecessary subprocess overhead
//    to hot paths such as loading runtime config.
// 2. Falling back to `zsh -ic 'command -v ...'` or similar is much worse because it can
//    trigger full interactive shell startup. On machines with heavy shell init like `conda`
//    or `nvm`, doing that repeatedly per task or per config read can freeze the runtime and
//    even make new terminal windows feel hung while the machine is saturated.
// 3. Depending on external lookup commands is also less robust than inspecting PATH directly.
//    For example, detection should not depend on `which` itself being available on PATH.
//
// Why this is acceptable:
// If a binary is only available after re-running shell init files, Kanban should treat it as
// unavailable for task-agent startup. That keeps behavior predictable and aligned with the
// environment the Kanban process already has, instead of silently relying on hidden shell
// side effects.
//
// Launchability on win32: this must agree with what can actually be spawned. An extensionless
// file or a `.ps1` script cannot be launched directly by CreateProcess/node-pty, so on win32
// this delegates to `resolveBinaryPathOnPath`, which only counts PATHEXT-launchable candidates.
export function isBinaryAvailableOnPath(binary: string): boolean {
	const trimmed = binary.trim();
	if (!trimmed) {
		return false;
	}
	if (trimmed.includes("/") || trimmed.includes("\\")) {
		return canAccessPath(trimmed);
	}

	if (process.platform === "win32") {
		return resolveBinaryPathOnPath(trimmed) !== null;
	}

	const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
	if (pathEntries.length === 0) {
		return false;
	}

	for (const entry of pathEntries) {
		if (canAccessPath(join(entry, trimmed))) {
			return true;
		}
	}
	return false;
}

// Resolves `binary` to the concrete, absolute, launchable path node-pty should spawn.
// This exists because a bare name that resolves fine for *detection* purposes (see above)
// is not always something CreateProcess can launch directly by that same bare name on
// win32 — the caller needs the real file path, PATHEXT and all.
export function resolveBinaryPathOnPath(binary: string): string | null {
	const trimmed = binary.trim();
	if (!trimmed) {
		return null;
	}
	if (trimmed.includes("/") || trimmed.includes("\\")) {
		return canAccessPath(trimmed) ? trimmed : null;
	}

	const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
	if (pathEntries.length === 0) {
		return null;
	}

	if (process.platform === "win32") {
		const candidates = getWindowsLaunchableCandidates(trimmed);
		for (const entry of pathEntries) {
			for (const candidate of candidates) {
				const candidatePath = join(entry, candidate);
				if (canAccessPath(candidatePath)) {
					return candidatePath;
				}
			}
		}
		return null;
	}

	for (const entry of pathEntries) {
		const candidatePath = join(entry, trimmed);
		if (canAccessPath(candidatePath)) {
			return candidatePath;
		}
	}
	return null;
}
