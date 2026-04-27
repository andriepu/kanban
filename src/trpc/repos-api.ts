import { readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type {
	RuntimeBoardData,
	RuntimeDirectoryListResponse,
	RuntimeRepoAddResponse,
	RuntimeRepoSummary,
	RuntimeRepoTaskCounts,
} from "../core/api-contract";
import { parseDirectoryListRequest, parseRepoAddRequest, parseRepoRemoveRequest } from "../core/api-validation";
import type { RepoInfo } from "../jira/jira-worktree";
import {
	listWorkspaceIndexEntries,
	loadWorkspaceContext,
	loadWorkspaceContextById,
	loadWorkspaceState,
	removeWorkspaceIndexEntry,
	removeWorkspaceStateFiles,
} from "../state/workspace-state";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { cloneGitRepository } from "../workspace/git-clone";
import { ensureInitialCommit, initializeGitRepository } from "../workspace/initialize-repo";
import { isPathWithinRoot } from "../workspace/path-sandbox";
import { deleteTaskWorktree } from "../workspace/task-worktree";
import type { RuntimeTrpcContext } from "./app-router";

interface DisposeWorkspaceOptions {
	stopTerminalSessions?: boolean;
}

export interface CreateReposApiDependencies {
	getActiveWorkspacePath: () => string | null;
	getActiveWorkspaceId: () => string | null;
	rememberWorkspace: (workspaceId: string, repoPath: string) => void;
	setActiveWorkspace: (workspaceId: string, repoPath: string) => Promise<void>;
	clearActiveWorkspace: () => void;
	resolveRepoInputPath: (inputPath: string, cwd: string) => string;
	assertPathIsDirectory: (path: string) => Promise<void>;
	hasGitRepository: (path: string) => boolean;
	summarizeRepoTaskCounts: (workspaceId: string, repoPath: string) => Promise<RuntimeRepoTaskCounts>;
	createRepoSummary: (project: {
		workspaceId: string;
		repoPath: string;
		taskCounts: RuntimeRepoTaskCounts;
		pullRequestCount: number;
	}) => RuntimeRepoSummary;
	broadcastRuntimeReposUpdated: (preferredCurrentRepoId: string | null) => Promise<void> | void;
	getTerminalManagerForWorkspace: (workspaceId: string) => TerminalSessionManager | null;
	disposeWorkspace: (
		workspaceId: string,
		options?: DisposeWorkspaceOptions,
	) => { terminalManager: TerminalSessionManager | null; workspacePath: string | null };
	collectRepoWorktreeTaskIdsForRemoval: (board: RuntimeBoardData) => Set<string>;
	warn: (message: string) => void;
	buildReposPayload: (preferredCurrentRepoId: string | null) => Promise<{
		currentRepoId: string | null;
		repos: RuntimeRepoSummary[];
	}>;
	pickDirectoryPathFromSystemDialog: () => string | null;
	serverCwd: string;
	getReposRoot: () => string | null;
	scanReposInRoot: (reposRoot: string) => Promise<RepoInfo[]>;
}

export function createReposApi(deps: CreateReposApiDependencies): RuntimeTrpcContext["reposApi"] {
	const filesystemRoot = resolve(deps.serverCwd, "/");

	return {
		listRepos: async (preferredWorkspaceId) => {
			const payload = await deps.buildReposPayload(preferredWorkspaceId);
			return {
				currentRepoId: payload.currentRepoId,
				repos: payload.repos,
			};
		},
		addRepo: async (preferredWorkspaceId, input) => {
			const body = parseRepoAddRequest(input);
			const preferredWorkspaceContext = preferredWorkspaceId
				? await loadWorkspaceContextById(preferredWorkspaceId)
				: null;
			const resolveBasePath = preferredWorkspaceContext?.repoPath ?? deps.getActiveWorkspacePath() ?? process.cwd();
			try {
				let repoPath: string;
				if (body.gitUrl) {
					// Clone from Git URL. If a custom path is provided alongside
					// gitUrl, use it as the clone destination. Otherwise derive
					// a destination from the URL.
					// Resolve relative to serverCwd (the default clone base), not the
					// active repo — the clone target belongs under the kanban
					// working directory, not inside another repo.
					const customDest = body.path ? deps.resolveRepoInputPath(body.path, deps.serverCwd) : undefined;
					const cloneResult = await cloneGitRepository(body.gitUrl, deps.serverCwd, customDest, filesystemRoot);
					if (!cloneResult.ok) {
						return {
							ok: false,
							repo: null,
							error: cloneResult.error ?? "Git clone failed.",
						} satisfies RuntimeRepoAddResponse;
					}
					repoPath = cloneResult.clonedPath;
				} else {
					// path is guaranteed to exist here by the schema refine and the gitUrl branch above.
					repoPath = deps.resolveRepoInputPath(body.path as string, resolveBasePath);
				}
				await deps.assertPathIsDirectory(repoPath);
				if (!deps.hasGitRepository(repoPath)) {
					if (!body.initializeGit) {
						return {
							ok: false,
							repo: null,
							requiresGitInitialization: true,
							error: "This folder is not a git repository. Kanban requires git to manage worktrees. Initialize git to continue.",
						} satisfies RuntimeRepoAddResponse;
					}
					const initResult = await initializeGitRepository(repoPath);
					if (!initResult.ok) {
						return {
							ok: false,
							repo: null,
							error: initResult.error ?? "Failed to initialize git repository.",
						} satisfies RuntimeRepoAddResponse;
					}
				} else {
					const commitResult = await ensureInitialCommit(repoPath);
					if (!commitResult.ok) {
						return {
							ok: false,
							repo: null,
							error: commitResult.error ?? "Failed to ensure initial commit.",
						} satisfies RuntimeRepoAddResponse;
					}
				}
				const context = await loadWorkspaceContext(repoPath);
				deps.rememberWorkspace(context.workspaceId, context.repoPath);
				const reposAfterAdd = await listWorkspaceIndexEntries();
				const activeWorkspaceId = deps.getActiveWorkspaceId();
				const hasActiveWorkspace = activeWorkspaceId
					? reposAfterAdd.some((project) => project.workspaceId === activeWorkspaceId)
					: false;
				if (!hasActiveWorkspace) {
					await deps.setActiveWorkspace(context.workspaceId, context.repoPath);
				}
				const taskCounts = await deps.summarizeRepoTaskCounts(context.workspaceId, context.repoPath);
				void deps.broadcastRuntimeReposUpdated(context.workspaceId);
				return {
					ok: true,
					repo: deps.createRepoSummary({
						workspaceId: context.workspaceId,
						repoPath: context.repoPath,
						taskCounts,
						pullRequestCount: 0,
					}),
				} satisfies RuntimeRepoAddResponse;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					repo: null,
					error: message,
				} satisfies RuntimeRepoAddResponse;
			}
		},
		removeRepo: async (_preferredWorkspaceId, input) => {
			try {
				const body = parseRepoRemoveRequest(input);
				const reposBeforeRemoval = await listWorkspaceIndexEntries();
				const repoToRemove = reposBeforeRemoval.find((project) => project.workspaceId === body.repoId);
				if (!repoToRemove) {
					return {
						ok: false,
						error: `Unknown repo ID: ${body.repoId}`,
					};
				}

				const taskIdsToCleanup = new Set<string>();
				try {
					const workspaceState = await loadWorkspaceState(repoToRemove.repoPath);
					for (const taskId of deps.collectRepoWorktreeTaskIdsForRemoval(workspaceState.board)) {
						taskIdsToCleanup.add(taskId);
					}
				} catch {
					// Best effort: if board state cannot be read, skip worktree cleanup IDs.
				}

				const removedTerminalManager = deps.getTerminalManagerForWorkspace(body.repoId);
				if (removedTerminalManager) {
					removedTerminalManager.markInterruptedAndStopAll();
				}

				const removed = await removeWorkspaceIndexEntry(body.repoId);
				if (!removed) {
					throw new Error(`Could not remove repo index entry for "${body.repoId}".`);
				}
				await removeWorkspaceStateFiles(body.repoId);
				deps.disposeWorkspace(body.repoId, {
					stopTerminalSessions: false,
				});

				if (deps.getActiveWorkspaceId() === body.repoId) {
					const remaining = await listWorkspaceIndexEntries();
					const fallbackWorkspace = remaining[0];
					if (fallbackWorkspace) {
						await deps.setActiveWorkspace(fallbackWorkspace.workspaceId, fallbackWorkspace.repoPath);
					} else {
						deps.clearActiveWorkspace();
					}
				}
				void deps.broadcastRuntimeReposUpdated(deps.getActiveWorkspaceId());
				if (taskIdsToCleanup.size > 0) {
					const cleanupTaskIds = Array.from(taskIdsToCleanup);
					void (async () => {
						const deletions = await Promise.all(
							cleanupTaskIds.map(async (taskId) => ({
								taskId,
								deleted: await deleteTaskWorktree({
									repoPath: repoToRemove.repoPath,
									taskId,
								}),
							})),
						);
						for (const { taskId, deleted } of deletions) {
							if (deleted.ok) {
								continue;
							}
							const message = deleted.error ?? `Could not delete task workspace for task "${taskId}".`;
							deps.warn(message);
						}
					})();
				}
				return {
					ok: true,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					error: message,
				};
			}
		},
		pickRepoDirectory: async () => {
			try {
				const selectedPath = deps.pickDirectoryPathFromSystemDialog();
				if (!selectedPath) {
					return {
						ok: false,
						path: null,
						error: "No directory was selected.",
					};
				}
				return {
					ok: true,
					path: selectedPath,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					path: null,
					error: message,
				};
			}
		},
		listDirectoryContents: async (_preferredWorkspaceId, input) => {
			const body = parseDirectoryListRequest(input);
			const rootPath = filesystemRoot;
			const requestedPath = body.path?.trim() || "";
			// Reject absolute paths that fall outside the sandbox
			if (requestedPath && isAbsolute(requestedPath)) {
				if (!isPathWithinRoot(rootPath, requestedPath)) {
					return {
						ok: false,
						currentPath: rootPath,
						parentPath: null,
						rootPath,
						entries: [],
						error: "Access denied: absolute path is outside the server root directory.",
					} satisfies RuntimeDirectoryListResponse;
				}
				// Absolute path is within sandbox — fall through to existing stat/readdir logic
			}
			const resolvedPath = resolve(rootPath, requestedPath) || rootPath;

			if (!isPathWithinRoot(rootPath, resolvedPath)) {
				return {
					ok: false,
					currentPath: rootPath,
					parentPath: null,
					rootPath,
					entries: [],
					error: "Access denied: path is outside the server root directory.",
				} satisfies RuntimeDirectoryListResponse;
			}

			try {
				const dirStat = await stat(resolvedPath);
				if (!dirStat.isDirectory()) {
					return {
						ok: false,
						currentPath: resolvedPath,
						parentPath: null,
						rootPath,
						entries: [],
						error: "The specified path is not a directory.",
					} satisfies RuntimeDirectoryListResponse;
				}

				const dirEntries = await readdir(resolvedPath, { withFileTypes: true });
				const directoryEntries = dirEntries.filter((entry) => {
					if (!entry.isDirectory()) {
						return false;
					}
					if (entry.name.startsWith(".")) {
						return false;
					}
					return true;
				});

				directoryEntries.sort((a, b) => a.name.localeCompare(b.name));

				const entries = await Promise.all(
					directoryEntries.map(async (entry) => {
						const entryPath = resolve(resolvedPath, entry.name);
						let isGitRepository = false;
						try {
							const gitDirStat = await stat(resolve(entryPath, ".git"));
							isGitRepository = gitDirStat.isDirectory() || gitDirStat.isFile();
						} catch {
							// .git does not exist or is not accessible
						}
						return {
							name: entry.name,
							path: entryPath,
							isGitRepository,
						};
					}),
				);

				const isAtRoot = resolvedPath === rootPath;
				const rawParent = dirname(resolvedPath);
				const parentIsWithinRoot = isPathWithinRoot(rootPath, rawParent);
				const parentPath = isAtRoot ? null : parentIsWithinRoot ? rawParent : null;

				return {
					ok: true,
					currentPath: resolvedPath,
					parentPath,
					rootPath,
					entries,
				} satisfies RuntimeDirectoryListResponse;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const isPermissionError =
					error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EACCES";
				const isNotFoundError =
					error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
				return {
					ok: false,
					currentPath: resolvedPath,
					parentPath: null,
					rootPath,
					entries: [],
					error: isPermissionError
						? "Permission denied: cannot read this directory."
						: isNotFoundError
							? "Directory not found."
							: message,
				} satisfies RuntimeDirectoryListResponse;
			}
		},
		syncFromReposRoot: async () => {
			const reposRoot = deps.getReposRoot();
			if (!reposRoot?.trim()) {
				return { added: 0, skipped: 0 };
			}
			const repos = await deps.scanReposInRoot(reposRoot);
			const existingEntries = await listWorkspaceIndexEntries();
			const existingRepoPaths = new Set(existingEntries.map((e) => e.repoPath));
			let added = 0;
			let skipped = 0;
			await Promise.all(
				repos.map(async (repo) => {
					if (existingRepoPaths.has(repo.path)) {
						skipped += 1;
						return;
					}
					const context = await loadWorkspaceContext(repo.path);
					deps.rememberWorkspace(context.workspaceId, context.repoPath);
					added += 1;
				}),
			);
			await deps.broadcastRuntimeReposUpdated(null);
			return { added, skipped };
		},
	};
}
