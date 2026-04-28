import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { join } from "node:path";

import { TRPCError } from "@trpc/server";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { loadJiraApiToken, saveJiraApiToken } from "../config/runtime-config";
import type { RuntimeCommandRunResponse, RuntimeWorkspaceStateResponse } from "../core/api-contract";
import {
	buildKanbanRuntimeUrl,
	getKanbanRuntimeHost,
	getKanbanRuntimeOrigin,
	getKanbanRuntimePort,
} from "../core/runtime-endpoint";
import {
	createJiraPullRequest,
	deleteJiraPullRequest,
	loadJiraBoard,
	loadJiraDetails,
	loadJiraPullRequests,
	saveJiraBoard,
	saveJiraDetail,
	saveJiraPullRequests,
} from "../jira/jira-board-state";
import { fetchGhPullRequestDetail, listAuthoredGhPullRequestsForProject } from "../jira/jira-pr-scan";
import type { JiraRestCredentials } from "../jira/jira-rest";
import { fetchJiraIssueViaRest, searchJiraIssuesViaRest, transitionJiraIssueViaRest } from "../jira/jira-rest";
import { createPullRequestWorktree, removePullRequestWorktree, scanReposInRoot } from "../jira/jira-worktree";
import { loadWorkspaceContext, loadWorkspaceContextById } from "../state/workspace-state";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { createTerminalWebSocketBridge } from "../terminal/ws-server";
import { type RuntimeTrpcContext, type RuntimeTrpcWorkspaceScope, runtimeAppRouter } from "../trpc/app-router";
import { createHooksApi } from "../trpc/hooks-api";
import { createJiraApi } from "../trpc/jira-api";
import { createReposApi } from "../trpc/repos-api";
import { createRuntimeApi } from "../trpc/runtime-api";
import { createWorkspaceApi } from "../trpc/workspace-api";
import { getWebUiDir, normalizeRequestPath, readAsset } from "./assets";
import type { RuntimeStateHub } from "./runtime-state-hub";
import type { WorkspaceRegistry } from "./workspace-registry";

interface DisposeTrackedWorkspaceResult {
	terminalManager: TerminalSessionManager | null;
	workspacePath: string | null;
}

export interface CreateRuntimeServerDependencies {
	workspaceRegistry: WorkspaceRegistry;
	runtimeStateHub: RuntimeStateHub;
	warn: (message: string) => void;
	ensureTerminalManagerForWorkspace: (workspaceId: string, repoPath: string) => Promise<TerminalSessionManager>;
	resolveInteractiveShellCommand: () => { binary: string; args: string[] };
	runCommand: (command: string, cwd: string) => Promise<RuntimeCommandRunResponse>;
	resolveRepoInputPath: (inputPath: string, basePath: string) => string;
	assertPathIsDirectory: (targetPath: string) => Promise<void>;
	hasGitRepository: (path: string) => boolean;
	disposeWorkspace: (
		workspaceId: string,
		options?: {
			stopTerminalSessions?: boolean;
		},
	) => DisposeTrackedWorkspaceResult;
	collectRepoWorktreeTaskIdsForRemoval: (board: RuntimeWorkspaceStateResponse["board"]) => Set<string>;
	pickDirectoryPathFromSystemDialog: () => string | null;
}

export interface RuntimeServer {
	url: string;
	close: () => Promise<void>;
}

function readWorkspaceIdFromRequest(request: IncomingMessage, requestUrl: URL): string | null {
	const headerValue = request.headers["x-kanban-workspace-id"];
	const headerWorkspaceId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
	if (typeof headerWorkspaceId === "string") {
		const normalized = headerWorkspaceId.trim();
		if (normalized) {
			return normalized;
		}
	}
	const queryWorkspaceId = requestUrl.searchParams.get("workspaceId");
	if (typeof queryWorkspaceId === "string") {
		const normalized = queryWorkspaceId.trim();
		if (normalized) {
			return normalized;
		}
	}
	return null;
}

export async function createRuntimeServer(deps: CreateRuntimeServerDependencies): Promise<RuntimeServer> {
	const webUiDir = getWebUiDir();

	try {
		await readFile(join(webUiDir, "index.html"));
	} catch {
		throw new Error("Could not find web UI assets. Run `npm run build` to generate and package the web UI.");
	}

	const resolveWorkspaceScopeFromRequest = async (
		request: IncomingMessage,
		requestUrl: URL,
	): Promise<{
		requestedWorkspaceId: string | null;
		workspaceScope: RuntimeTrpcWorkspaceScope | null;
	}> => {
		const requestedWorkspaceId = readWorkspaceIdFromRequest(request, requestUrl);
		if (!requestedWorkspaceId) {
			return {
				requestedWorkspaceId: null,
				workspaceScope: null,
			};
		}
		const requestedWorkspaceContext = await loadWorkspaceContextById(requestedWorkspaceId);
		if (!requestedWorkspaceContext) {
			return {
				requestedWorkspaceId,
				workspaceScope: null,
			};
		}
		return {
			requestedWorkspaceId,
			workspaceScope: {
				workspaceId: requestedWorkspaceContext.workspaceId,
				workspacePath: requestedWorkspaceContext.repoPath,
			},
		};
	};

	const getScopedTerminalManager = async (scope: RuntimeTrpcWorkspaceScope): Promise<TerminalSessionManager> =>
		await deps.ensureTerminalManagerForWorkspace(scope.workspaceId, scope.workspacePath);
	const prepareForStateReset = async (): Promise<void> => {
		const workspaceIds = new Set<string>();
		for (const { workspaceId } of deps.workspaceRegistry.listManagedWorkspaces()) {
			workspaceIds.add(workspaceId);
		}
		const activeWorkspaceId = deps.workspaceRegistry.getActiveWorkspaceId();
		if (activeWorkspaceId) {
			workspaceIds.add(activeWorkspaceId);
		}
		for (const workspaceId of workspaceIds) {
			deps.disposeWorkspace(workspaceId, {
				stopTerminalSessions: true,
			});
		}
		deps.workspaceRegistry.clearActiveWorkspace();
	};

	const runtimeApiInstance = createRuntimeApi({
		getActiveWorkspaceId: deps.workspaceRegistry.getActiveWorkspaceId,
		getActiveRuntimeConfig: deps.workspaceRegistry.getActiveRuntimeConfig,
		loadScopedRuntimeConfig: deps.workspaceRegistry.loadScopedRuntimeConfig,
		setActiveRuntimeConfig: deps.workspaceRegistry.setActiveRuntimeConfig,
		getScopedTerminalManager,
		resolveInteractiveShellCommand: deps.resolveInteractiveShellCommand,
		runCommand: deps.runCommand,
		broadcastTaskChatCleared: deps.runtimeStateHub.broadcastTaskChatCleared,
		prepareForStateReset,
	});

	async function loadJiraRestCredentials(): Promise<JiraRestCredentials | null> {
		const runtimeConfig = deps.workspaceRegistry.getActiveRuntimeConfig?.();
		const apiToken = await loadJiraApiToken();
		const baseUrl = runtimeConfig?.jiraBaseUrl ?? null;
		const email = runtimeConfig?.jiraEmail ?? null;
		if (baseUrl && email && apiToken) {
			return { baseUrl, email, apiToken };
		}
		return null;
	}

	async function requireJiraRestCredentials(): Promise<JiraRestCredentials> {
		const creds = await loadJiraRestCredentials();
		if (!creds) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "Jira credentials not configured. Set base URL, email, and API token in Settings.",
			});
		}
		return creds;
	}

	const jiraApiInstance = createJiraApi({
		loadJiraBoard,
		saveJiraBoard,
		loadJiraPullRequests,
		saveJiraPullRequests,
		loadJiraDetails,
		saveJiraDetail,
		createJiraPullRequest,
		deleteJiraPullRequest,
		searchJiraIssues: async (jql: string) => {
			const creds = await requireJiraRestCredentials();
			return searchJiraIssuesViaRest(jql, creds);
		},
		fetchIssue: async (issueKey: string) => {
			const creds = await requireJiraRestCredentials();
			return fetchJiraIssueViaRest(issueKey, creds);
		},
		transitionIssue: async (issueKey: string, targetName: string) => {
			const creds = await requireJiraRestCredentials();
			await transitionJiraIssueViaRest(issueKey, targetName, creds);
		},
		setApiToken: saveJiraApiToken,
		scanRepos: scanReposInRoot,
		createPullRequestWorktree,
		removePullRequestWorktree,
		startTaskSession: async (workspacePath, taskId, prompt, customCwd) => {
			const ctx = await loadWorkspaceContext(workspacePath);
			const workspaceScope: RuntimeTrpcWorkspaceScope = {
				workspaceId: ctx.workspaceId,
				workspacePath: ctx.repoPath,
			};
			const result = await runtimeApiInstance.startTaskSession(workspaceScope, {
				taskId,
				prompt,
				baseRef: "main",
				customCwd,
			});
			return { started: result.ok };
		},
		stopTaskSession: async (workspacePath, taskId) => {
			const ctx = await loadWorkspaceContext(workspacePath);
			const workspaceScope: RuntimeTrpcWorkspaceScope = {
				workspaceId: ctx.workspaceId,
				workspacePath: ctx.repoPath,
			};
			const result = await runtimeApiInstance.stopTaskSession(workspaceScope, { taskId });
			return { stopped: result.ok };
		},
		addWorkspace: async (workspacePath) => {
			const ctx = await loadWorkspaceContext(workspacePath);
			await deps.ensureTerminalManagerForWorkspace(ctx.workspaceId, workspacePath);
			return ctx.workspaceId;
		},
		getWorktreesRoot: () => deps.workspaceRegistry.getActiveRuntimeConfig?.()?.worktreesRoot ?? null,
		getReposRoot: () => deps.workspaceRegistry.getActiveRuntimeConfig?.()?.reposRoot ?? null,
		listAuthoredGhPullRequestsForProject,
		fetchGhPullRequestDetail,
		getJiraProjectKey: () => deps.workspaceRegistry.getActiveRuntimeConfig?.()?.jiraProjectKey ?? null,
		broadcastRuntimeReposUpdated: () => {
			void deps.runtimeStateHub.broadcastRuntimeReposUpdated(null);
		},
	});

	const createTrpcContext = async (req: IncomingMessage): Promise<RuntimeTrpcContext> => {
		const requestUrl = new URL(req.url ?? "/", "http://localhost");
		const scope = await resolveWorkspaceScopeFromRequest(req, requestUrl);
		return {
			requestedWorkspaceId: scope.requestedWorkspaceId,
			workspaceScope: scope.workspaceScope,
			runtimeApi: runtimeApiInstance,
			workspaceApi: createWorkspaceApi({
				ensureTerminalManagerForWorkspace: deps.ensureTerminalManagerForWorkspace,
				broadcastRuntimeWorkspaceStateUpdated: deps.runtimeStateHub.broadcastRuntimeWorkspaceStateUpdated,
				broadcastRuntimeReposUpdated: deps.runtimeStateHub.broadcastRuntimeReposUpdated,
				buildWorkspaceStateSnapshot: deps.workspaceRegistry.buildWorkspaceStateSnapshot,
			}),
			reposApi: createReposApi({
				getActiveWorkspacePath: deps.workspaceRegistry.getActiveWorkspacePath,
				getActiveWorkspaceId: deps.workspaceRegistry.getActiveWorkspaceId,
				rememberWorkspace: deps.workspaceRegistry.rememberWorkspace,
				setActiveWorkspace: deps.workspaceRegistry.setActiveWorkspace,
				clearActiveWorkspace: deps.workspaceRegistry.clearActiveWorkspace,
				resolveRepoInputPath: deps.resolveRepoInputPath,
				assertPathIsDirectory: deps.assertPathIsDirectory,
				hasGitRepository: deps.hasGitRepository,
				summarizeRepoTaskCounts: deps.workspaceRegistry.summarizeRepoTaskCounts,
				createRepoSummary: deps.workspaceRegistry.createRepoSummary,
				broadcastRuntimeReposUpdated: deps.runtimeStateHub.broadcastRuntimeReposUpdated,
				getTerminalManagerForWorkspace: deps.workspaceRegistry.getTerminalManagerForWorkspace,
				disposeWorkspace: (workspaceId, options) => {
					return deps.disposeWorkspace(workspaceId, options);
				},
				collectRepoWorktreeTaskIdsForRemoval: deps.collectRepoWorktreeTaskIdsForRemoval,
				warn: deps.warn,
				buildReposPayload: deps.workspaceRegistry.buildReposPayload,
				pickDirectoryPathFromSystemDialog: deps.pickDirectoryPathFromSystemDialog,
				serverCwd: process.cwd(),
				getReposRoot: () => deps.workspaceRegistry.getActiveRuntimeConfig?.()?.reposRoot ?? null,
				scanReposInRoot,
			}),
			hooksApi: createHooksApi({
				getWorkspacePathById: deps.workspaceRegistry.getWorkspacePathById,
				ensureTerminalManagerForWorkspace: deps.ensureTerminalManagerForWorkspace,
				broadcastRuntimeWorkspaceStateUpdated: deps.runtimeStateHub.broadcastRuntimeWorkspaceStateUpdated,
				broadcastTaskReadyForReview: deps.runtimeStateHub.broadcastTaskReadyForReview,
			}),
			jiraApi: jiraApiInstance,
		};
	};

	const trpcHttpHandler = createHTTPHandler({
		basePath: "/api/trpc/",
		router: runtimeAppRouter,
		createContext: async ({ req }) => await createTrpcContext(req),
	});

	const requestHandler = async (req: IncomingMessage, res: import("node:http").ServerResponse) => {
		try {
			const requestUrl = new URL(req.url ?? "/", "http://localhost");
			const pathname = normalizeRequestPath(requestUrl.pathname);

			if (pathname.startsWith("/api/trpc")) {
				trpcHttpHandler(req, res);
				return;
			}
			if (pathname.startsWith("/api/")) {
				res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
				res.end('{"error":"Not found"}');
				return;
			}

			const asset = await readAsset(webUiDir, pathname);
			res.writeHead(200, {
				"Content-Type": asset.contentType,
				"Cache-Control": "no-store",
			});
			res.end(asset.content);
		} catch {
			res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			res.end("Not Found");
		}
	};
	const server = createServer(requestHandler);
	server.on("upgrade", (request, socket, head) => {
		let requestUrl: URL;
		try {
			requestUrl = new URL(request.url ?? "/", getKanbanRuntimeOrigin());
		} catch {
			socket.destroy();
			return;
		}
		if (normalizeRequestPath(requestUrl.pathname) !== "/api/runtime/ws") {
			return;
		}
		(request as IncomingMessage & { __kanbanUpgradeHandled?: boolean }).__kanbanUpgradeHandled = true;
		const requestedWorkspaceId = requestUrl.searchParams.get("workspaceId")?.trim() || null;
		deps.runtimeStateHub.handleUpgrade(request, socket, head, { requestedWorkspaceId });
	});
	const terminalWebSocketBridge = createTerminalWebSocketBridge({
		server,
		resolveTerminalManager: (workspaceId) => deps.workspaceRegistry.getTerminalManagerForWorkspace(workspaceId),
		isTerminalIoWebSocketPath: (pathname) => normalizeRequestPath(pathname) === "/api/terminal/io",
		isTerminalControlWebSocketPath: (pathname) => normalizeRequestPath(pathname) === "/api/terminal/control",
	});
	server.on("upgrade", (request, socket) => {
		const handled = (request as IncomingMessage & { __kanbanUpgradeHandled?: boolean }).__kanbanUpgradeHandled;
		if (handled) {
			return;
		}
		socket.destroy();
	});

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(getKanbanRuntimePort(), getKanbanRuntimeHost(), () => {
			server.off("error", rejectListen);
			resolveListen();
		});
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Failed to start local server.");
	}
	const activeWorkspaceId = deps.workspaceRegistry.getActiveWorkspaceId();
	const url = activeWorkspaceId
		? buildKanbanRuntimeUrl(`/${encodeURIComponent(activeWorkspaceId)}`)
		: getKanbanRuntimeOrigin();

	return {
		url,
		close: async () => {
			await deps.runtimeStateHub.close();
			await terminalWebSocketBridge.close();
			await new Promise<void>((resolveClose, rejectClose) => {
				server.close((error) => {
					if (error) {
						rejectClose(error);
						return;
					}
					resolveClose();
				});
			});
		},
	};
}
