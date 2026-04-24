# Memory

> Chronological action log. Hooks and AI append to this file automatically.
> Old sessions are consolidated by the daemon weekly.

| 01:00 | Fix 3 quality issues in Task 3 files: narrow ReaddirWithFileTypes, split symlink try/catch, replace inline type import with named import | src/jira/jira-worktree.ts, test/runtime/jira/jira-worktree.test.ts | committed 1496d02, all 328 tests pass | ~2500 |
| 08:22 | Fix 3 issues in jira-api.ts: runtime guard before fetchIssue cast, remove unused getJiraProjectKey from interface+server+test, merge double loadJiraSubtasks in startSubtaskSession | src/trpc/jira-api.ts, src/server/runtime-server.ts, test/runtime/trpc/jira-api.test.ts | tsc clean, 331/331 tests pass | ~600 |
| 08:28 | Task 5: Created web-ui/src/types/jira.ts, web-ui/src/hooks/use-jira-board.ts (useTrpcQuery pattern with direct .mutate calls), and tests use-jira-board.test.tsx (react-dom createRoot pattern, NOT @testing-library/react) | web-ui/src/types/jira.ts, web-ui/src/hooks/use-jira-board.ts, web-ui/src/hooks/use-jira-board.test.tsx | 3/3 new tests pass, 331 backend + 274 frontend tests all pass, tsc clean (6 pre-existing errors in other files) | ~1500 |
| 08:10 | Task 4: Added Jira Zod schemas to api-contract.ts, created jira-api.ts with createJiraApi, added jira router to app-router.ts, added customCwd to startTaskSession, wired jiraApi in runtime-server.ts | src/core/api-contract.ts, src/trpc/jira-api.ts, src/trpc/app-router.ts, src/trpc/runtime-api.ts, src/server/runtime-server.ts, test/runtime/trpc/jira-api.test.ts | 331 tests pass, TypeScript clean | ~4000 |

| 07:55 | Created src/jira/jira-mcp.ts and src/jira/jira-worktree.ts with tests | src/jira/jira-mcp.ts, src/jira/jira-worktree.ts, test/runtime/jira/jira-mcp.test.ts, test/runtime/jira/jira-worktree.test.ts | 9/9 tests pass, TypeScript clean, committed abd5dec | ~800 |

| 07:35 | Investigated TS errors in runtime-config.test.ts (null arg + missing fields) | src/config/runtime-config.ts, test/runtime/config/runtime-config.test.ts | No fixes needed — tsc clean, 312 tests pass; IDE was showing stale errors | ~800 |

## Session: 2026-04-23 23:08

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|
| 05:12 | Task 1: deleted .plan/docs, publish infra, Sentry packages | .plan/docs, .github/workflows/publish.yml, scripts/upload-sentry-sourcemaps.mjs, RELEASE_WORKFLOW.md, CONTRIBUTING.md, package.json | Commit daa42ef; typecheck OK; tests 345/345 pass | ~10k |
| 23:25 | Task 2: Spec compliance verification | src/cli.ts, src/server/runtime-server.ts | ✅ SPEC COMPLIANT - All 14 requirements verified | ~2k |
| 05:30 | Task 3: removed frontend telemetry (Sentry+PostHog), passcode gate, remote-file-browser-dialog; rewrote main.tsx; replaced Sentry.ErrorBoundary with native React class boundary; removed selectedAgentId from UseTaskEditorInput | web-ui/src/telemetry/*, web-ui/src/components/passcode-gate.tsx, main.tsx, app-error-boundary.tsx, hooks | committed 520ed39 | ~2500 |
| 05:36 | Task 4: removed codex/droid/kiro/gemini hook handlers, rewrote hooks.ts to Claude-only | src/commands/hooks.ts, src/commands/hook-events/codex-hook-events.ts, droid-hook-events.ts, kiro-hook-events.ts | committed | ~3000 |
| 23:45 | Task 4 verification: All 14 spec requirements pass | src/commands/hooks.ts, test/runtime/hooks-source-inference.test.ts | ✅ SPEC COMPLIANT - verified: deleted files, imports, re-exports, func calls, subcommands, source inference logic, tests | ~2k |
| 07:33 | Task 1: add worktreesRoot, reposRoot, jiraProjectKey to global config | src/config/runtime-config.ts, src/core/api-contract.ts, src/terminal/agent-registry.ts, tests | 312 tests pass, committed 0ae775f | ~3500 |
| 07:40 | Fixed 3 code quality issues: required fields in createRuntimeConfigStateFromValues, saveRuntimeConfig preserves Jira fields from disk, null-clear comments | src/config/runtime-config.ts | committed 186102b, 312 tests pass | ~1500 |
| 07:44 | Task 2: created jira-board-state.ts with full CRUD + atomic locking | src/jira/jira-board-state.ts, test/runtime/jira/jira-board-state.test.ts | 6/6 tests pass, 318 total pass, tsc clean, committed aeeea0b | ~800 |
| 07:51 | Applied 4 code quality fixes to Task 2 (Jira state persistence): guard for orphaned subtask creation, test HOME isolation via process.env not os.homedir(), USERPROFILE coverage, new error-case test | src/jira/jira-board-state.ts, test/runtime/jira/jira-board-state.test.ts | committed ff0eb65, 7/7 tests pass, 319/319 full suite pass | ~800 |
| 08:15 | Fixed 3 TS diagnostic errors: removed .js extension from jira-board-state import, removed unused beforeEach import in jira-api test, removed unnecessary await on synchronous trpcHttpHandler | test/runtime/jira/jira-board-state.test.ts, test/runtime/trpc/jira-api.test.ts, src/server/runtime-server.ts | tsc clean (exit 0), 331/331 tests pass | ~400 |
| 08:56 | Fixed use-jira-board.ts: useUnmount, rollback, removed casts; added 5 tests all passing | use-jira-board.ts, use-jira-board.test.tsx | success | ~4500 |
