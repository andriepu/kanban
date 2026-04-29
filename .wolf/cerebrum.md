# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-04-23

## User Preferences

<!-- How the user likes things done. Code style, tools, patterns, communication. -->

## Key Learnings

- **Project:** kanban
- **Description:** A kanban foundation for coding agents
- **TRPC client is a proxy client** — The project uses `createTRPCProxyClient` (NOT `@trpc/react-query`). Calls are `.query()` and `.mutate()`, not `.useQuery()` / `.useMutation()`. Never mock with React Query shapes.
- **getRuntimeTrpcClient takes workspaceId** — Signature: `getRuntimeTrpcClient(workspaceId: string | null)`. Hooks that use it typically receive `currentProjectId: string | null` as a param. For board-level (unscoped) hooks, pass `null`.
- **Web-UI tests use createRoot, NOT @testing-library/react** — `@testing-library/react` is not installed. Tests use `react-dom/client` `createRoot` + a HookHarness component + `act()` from react. Never import from `@testing-library/react`.
- **Custom useTrpcQuery hook** — There is a project-specific `useTrpcQuery` in `web-ui/src/runtime/use-trpc-query.ts` for async queries with loading state, race protection, and unmount safety. For simpler hooks, direct useEffect+fetch is also used.
- **Avoid async act with never-settling promises** — In hook tests, if the hook calls an async query on mount, mock that query with `new Promise<never>(() => undefined)` to prevent the test from timing out while still allowing synchronous assertions on initial state.
- **TypeScript null narrowing in tests** — After `if (snapshot === null) throw new Error(...)`, TS still narrows `snapshot` to `never` for let bindings. Fix by assigning to a typed const: `const result: MyType = snapshot;`

- **JiraBoardView now accepts jiraBoard prop** — After Task 9 refactor, `JiraBoardView` no longer calls `useJiraBoard()` internally. It accepts a `jiraBoard: UseJiraBoardResult` prop. The hook is called in App.tsx and passed down. This avoids duplicate data fetching when the detail view also needs board+subtasks.
- **startSubtaskSession returns workspaceId** — After Task 9, `startSubtaskSession` returns `{ started, workspacePath, workspaceId }`. The `addWorkspace` dep in CreateJiraApiDependencies returns `Promise<string>` (the workspaceId). Use `workspaceId` when rendering `AgentTerminalPanel`.

## Do-Not-Repeat

- [2026-04-24] `execFile` does not support `input` option for stdin. To spawn `claude -p` with stdin closed, use `spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] })` instead of `execFile` + `promisify`. Without this, Claude CLI waits 3s for stdin and exits code 1.
- [2026-04-24] `claude -p --output-format json` output is `{ type: "result", result: "<text string>", ... }` — `result` is a **string**, not a parsed object. When `importFromJira` (or any `callJiraMcp` caller) expects Claude to return JSON, must parse `raw.result` as a string: `JSON.parse(raw.result)`. Checking `Array.isArray(raw.result)` is always false and silently returns 0 results.

- [2026-04-24] `claude -p` subprocess spawned from project cwd will inherit and load all project CLAUDE.md/hooks (.wolf/, AGENTS.md, .claude/settings.json) plus user SessionStart injections (superpowers, caveman). These consume 3-5 turns before the agent executes even one tool call. To isolate the subprocess, spawn with `cwd: os.tmpdir()` + `--disable-slash-commands` + `--allowedTools <only-needed-tools>` + `--append-system-prompt`. This drops project context while keeping user-level OAuth auth and MCP server registration. See bug-045.

- [2026-04-24] Jira default status names use hyphens/spaces: `"To-Do"` not `"Todo"`, `"In Progress"` (space) not `"In-Progress"`. JIRA_STATUS_MAP must include both hyphenated and spaced variants, or issues are silently skipped/removed. Always verify against real Jira API response before adding to the map.
- [2026-04-24] In web-ui tests, always use `./node_modules/.bin/vitest` (not `npx vitest`) to run test files.
- [2026-04-25] In React hook tests, after `if (snapshot === null) throw new Error(...)`, TypeScript still narrows `snapshot` to `never` for let bindings. After EACH null guard, assign to a typed const: `const snap: MyType = snapshot;` and use that for subsequent assertions. Do NOT use `snapshot!` — it still yields `never`. This applies to every null guard, including secondary ones after `await act(...)` calls.
- [2026-04-24] The plan for Task 9 referenced React Query-style hooks (`.useQuery()`, `.useMutation()`) for the TRPC client — this is WRONG. The project uses `createTRPCProxyClient` (proxy pattern). All TRPC calls must use `.query()` and `.mutate()` from within `useEffect`/`useCallback`, not React Query hooks. Never use `.useQuery()` or `.useMutation()` in this project. `npx vitest` resolves the root-level vitest which cannot find jsdom (it's in web-ui/node_modules, not root/node_modules). The correct command: `cd web-ui && ./node_modules/.bin/vitest run <file>`.

- [2026-04-25] When adding a field to `JiraSubtask` (disk type), also update `jiraSubtaskSchema` in `src/core/api-contract.ts`. tRPC routes with `.output(schema)` use zod's default `.strip()` mode — unknown keys are silently dropped. Missing the schema update causes the field to survive `loadBoard` (no output validator) but get stripped by `scanAndAttachPRs` (`.output(jiraScanAndAttachPrsResponseSchema)`). This caused `prState: "merged"` to be correct on first load but dropped on auto-scan, making merged PRs render green after ~1 second.

- [2026-04-28] When nuking a full feature from runtime config, `repoConfigPath` and other removed fields must also be stripped from ALL test fixtures that have a `RuntimeConfigState` / `RuntimeConfigResponse` literal, not just the fields explicitly listed in the plan. Grep for removed field names across all test files after tsc to find stragglers.
- [2026-04-28] `updateRuntimeConfig` and `saveRuntimeConfig` signature change: previously took `(cwd, config)`, now takes `(config)` only. All test callers in `test/runtime/config/runtime-config.test.ts` must be updated.
- [2026-04-29] `useCallback` that reads React state will get a new reference every time that state changes, which re-triggers any `useEffect` that lists the callback in its deps. When an auto-open effect (`openHomeTerminal`) is triggered by data (selectedJiraKey), and the callback itself reads `isHomeTerminalOpen` state, external code that closes the terminal recreates the callback, re-runs the effect, and reopens it → oscillation/flashing. Fix: use a ref (`isHomeTerminalOpenRef`) updated each render to read the value inside the callback without making it a dep.

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->
