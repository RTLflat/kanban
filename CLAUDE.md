# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Node >= 22. Three npm projects: root (CLI/runtime/server), `web-ui` (React SPA), `packages/desktop` (Electron shell).

- Install everything: `npm run install:all` (root + web-ui + desktop)
- Dev: `npm run dev` (backend, tsx watch) **and** `npm run web:dev` (Vite, separate terminal). `npm run dev:full` runs both.
- Build production bundle: `npm run build` (cleans, builds web-ui, esbuilds CLI via `scripts/build.mjs`, copies web-ui into `dist/web-ui`)
- Lint / format: `npm run lint` / `npm run format` (Biome — config in `biome.json`)
- Typecheck: `npm run typecheck` (root), `npm run web:typecheck` (web-ui)
- Pre-PR gate: `npm run check` (Biome + typecheck + tests) and `npm run build` must both pass.

Tests use Vitest:
- All root tests: `npm run test`
- Fast unit only: `npm run test:fast` (= `test/runtime` + `test/utilities`)
- Integration only: `npm run test:integration` (= `test/integration`)
- web-ui tests: `npm run web:test`
- Single file / name: `npx vitest run test/runtime/foo.test.ts` or `npx vitest run -t "test name"`

## Architecture

`kanban` is a single CLI (`src/cli.ts` → `dist/cli.js`) that launches a **local HTTP/WebSocket server**; your browser SPA (`web-ui`) is the actual UI. There is no cloud backend.

**Server boundary (`src/server/`, `src/trpc/`):** `runtime-server.ts` serves the built `web-ui` and the API. The browser talks to it two ways:
- **tRPC** (`src/trpc/app-router.ts`) at `/api/trpc` for request/response. Types/zod schemas are shared via `src/core/api-contract.ts` — the single source of truth for both sides; change a contract there, not in two places.
- **WebSocket** (`src/server/runtime-state-hub.ts`) pushes live state (terminal output, Cline chat, project list, workspace metadata) to clients.

**Workspace scoping:** everything is keyed by `workspaceId` (one per git repo). `workspace-registry.ts` creates and tracks a terminal manager + state per workspace. Most tRPC procedures are `workspaceProcedure` and require the `x-kanban-workspace-id` header.

**Two agent execution paths** — know which one you're touching:
1. **Native Cline runtime** (`src/cline-sdk/`): runs Cline in-process via `@clinebot/core`/`@clinebot/llms`, surfaced as the chat panel in web-ui. `src/cline-sdk/` is the boundary layer over the SDK — inspect it (and the installed packages) for real behavior rather than redefining SDK shapes locally.
2. **PTY terminal sessions** (`src/terminal/session-manager.ts`): for command-line CLIs (Claude Code, Codex, Gemini, Droid, Kiro, OpenCode) via `node-pty` + headless xterm. The agent list (binaries, autonomy flags, launch-supported set) lives in `src/core/agent-catalog.ts`.

**Tasks → worktrees (`src/workspace/`):** each task card gets an ephemeral git worktree; gitignored files like `node_modules` are symlinked in so copies are cheap. Auto-commit / auto-PR is driven by prompts built in web-ui (`web-ui/src/git-actions/`).

**Hooks (`src/commands/hooks.ts`, `src/commands/hook-events/`):** running agents report progress back to the board through runtime hooks; `kanban hooks ...` subcommands ingest those events.

**Lightweight subcommand path:** `kanban task ...` and `kanban hooks ...` must NOT pull in the server stack. `src/cli.ts` lazily imports server modules only when starting the runtime — eager imports there have previously leaked process handles and hung command-style invocations (see the comment in `startServer`).

**Tests:** `test/runtime` + `test/utilities` are fast/unit, `test/integration` is integration. web-ui colocates `*.test.tsx` next to components.

@AGENTS.md
