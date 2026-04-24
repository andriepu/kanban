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

<!-- Mistakes made and corrected. Each entry prevents the same mistake recurring. -->
<!-- Format: [YYYY-MM-DD] Description of what went wrong and what to do instead. -->

- [2026-04-24] In web-ui tests, always use `./node_modules/.bin/vitest` (not `npx vitest`) to run test files.
- [2026-04-24] The plan for Task 9 referenced React Query-style hooks (`.useQuery()`, `.useMutation()`) for the TRPC client — this is WRONG. The project uses `createTRPCProxyClient` (proxy pattern). All TRPC calls must use `.query()` and `.mutate()` from within `useEffect`/`useCallback`, not React Query hooks. Never use `.useQuery()` or `.useMutation()` in this project. `npx vitest` resolves the root-level vitest which cannot find jsdom (it's in web-ui/node_modules, not root/node_modules). The correct command: `cd web-ui && ./node_modules/.bin/vitest run <file>`.

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->
