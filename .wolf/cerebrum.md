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

## Do-Not-Repeat

<!-- Mistakes made and corrected. Each entry prevents the same mistake recurring. -->
<!-- Format: [YYYY-MM-DD] Description of what went wrong and what to do instead. -->

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->
