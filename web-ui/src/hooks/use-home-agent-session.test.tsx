import { act, useCallback, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHomeAgentSession } from "@/hooks/use-home-agent-session";
import type { RuntimeConfigResponse, RuntimeGitRepositoryInfo, RuntimeTaskSessionSummary } from "@/runtime/types";

const startTaskSessionMutateMock = vi.hoisted(() => vi.fn());
const stopTaskSessionMutateMock = vi.hoisted(() => vi.fn());
const reloadTaskChatSessionMutateMock = vi.hoisted(() => vi.fn());
const notifyErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: (workspaceId: string | null) => ({
		runtime: {
			startTaskSession: {
				mutate: (input: object) => startTaskSessionMutateMock({ workspaceId, ...input }),
			},
			stopTaskSession: {
				mutate: (input: object) => stopTaskSessionMutateMock({ workspaceId, ...input }),
			},
			reloadTaskChatSession: {
				mutate: (input: object) => reloadTaskChatSessionMutateMock({ workspaceId, ...input }),
			},
		},
	}),
}));

vi.mock("@/runtime/task-session-geometry", () => ({
	estimateTaskSessionGeometry: () => ({ cols: 120, rows: 24 }),
}));

vi.mock("@/components/app-toaster", () => ({
	notifyError: notifyErrorMock,
}));

interface HookSnapshot {
	panelMode: ReturnType<typeof useHomeAgentSession>["panelMode"];
	sessionKeys: string[];
	taskId: string | null;
}

function createSummary(taskId: string, agentId: RuntimeTaskSessionSummary["agentId"]): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "running",
		agentId,
		workspacePath: "/tmp/repo",
		pid: 1234,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		lastOutputAt: Date.now(),
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

function createRuntimeConfig(overrides: Partial<RuntimeConfigResponse> = {}): RuntimeConfigResponse {
	return {
		selectedAgentId: "claude",
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		effectiveCommand: "claude --dangerously-skip-permissions",
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project-config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: ["claude"],
		agents: [
			{
				id: "claude",
				label: "Claude Code",
				binary: "claude",
				command: "claude --dangerously-skip-permissions",
				defaultArgs: [],
				installed: true,
				configured: true,
			},
		],
		shortcuts: [],
		commitPromptTemplate: "commit",
		openPrPromptTemplate: "pr",
		commitPromptTemplateDefault: "commit",
		openPrPromptTemplateDefault: "pr",
		worktreesRoot: null,
		reposRoot: null,
		jiraProjectKey: null,
		jiraBaseUrl: null,
		jiraEmail: null,
		jiraSyncIntervalMs: 60 * 60 * 1000,
		...overrides,
	};
}

const DEFAULT_WORKSPACE_GIT: RuntimeGitRepositoryInfo = {
	currentBranch: "main",
	defaultBranch: "main",
	branches: ["main"],
};

function createFlushPromises(): Promise<void> {
	return Promise.resolve().then(() => Promise.resolve());
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolvePromise: ((value: T) => void) | null = null;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	if (!resolvePromise) {
		throw new Error("Could not create deferred promise.");
	}
	return {
		promise,
		resolve: resolvePromise,
	};
}

function requireSnapshot(snapshot: HookSnapshot | null): HookSnapshot {
	if (snapshot === null) {
		throw new Error("Expected a hook snapshot.");
	}
	return snapshot;
}

function requireTaskId(taskId: string | null): string {
	if (taskId === null) {
		throw new Error("Expected a task id.");
	}
	return taskId;
}

function HookHarness({
	config,
	currentProjectId,
	onSnapshot,
	workspaceGit = DEFAULT_WORKSPACE_GIT,
	seedSessionSummary = false,
}: {
	config: RuntimeConfigResponse | null;
	currentProjectId: string | null;
	onSnapshot: (snapshot: HookSnapshot) => void;
	workspaceGit?: RuntimeGitRepositoryInfo | null;
	seedSessionSummary?: boolean;
}): null {
	const [sessionSummaries, setSessionSummaries] = useState<Record<string, RuntimeTaskSessionSummary>>({});
	const upsertSessionSummary = useCallback((summary: RuntimeTaskSessionSummary) => {
		setSessionSummaries((currentSessions) => ({
			...currentSessions,
			[summary.taskId]: summary,
		}));
	}, []);
	const result = useHomeAgentSession({
		currentProjectId,
		runtimeProjectConfig: config,
		workspaceGit,
		sessionSummaries,
		setSessionSummaries,
		upsertSessionSummary,
	});

	useEffect(() => {
		if (!seedSessionSummary || !result.taskId) {
			return;
		}
		upsertSessionSummary(createSummary(result.taskId, config?.selectedAgentId ?? "claude"));
	}, [config?.selectedAgentId, result.taskId, seedSessionSummary, upsertSessionSummary]);

	useEffect(() => {
		onSnapshot({
			panelMode: result.panelMode,
			sessionKeys: Object.keys(sessionSummaries),
			taskId: result.taskId,
		});
	}, [onSnapshot, result.panelMode, result.taskId, sessionSummaries]);

	return null;
}

describe("useHomeAgentSession", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		startTaskSessionMutateMock.mockReset();
		stopTaskSessionMutateMock.mockReset();
		reloadTaskChatSessionMutateMock.mockReset();
		startTaskSessionMutateMock.mockImplementation(async ({ taskId }: { taskId: string }) => ({
			ok: true,
			summary: createSummary(taskId, "claude"),
		}));
		reloadTaskChatSessionMutateMock.mockImplementation(async ({ taskId }: { taskId: string }) => ({
			ok: true,
			summary: createSummary(taskId, "claude"),
		}));
		notifyErrorMock.mockReset();
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("starts a home terminal session", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const initialSnapshot = requireSnapshot(latestSnapshot);
		const initialTaskId = initialSnapshot.taskId;
		expect(initialSnapshot.panelMode).toBe("terminal");
		expect(initialTaskId).toMatch(/^__home_agent__:workspace-1:claude$/);
		expect(startTaskSessionMutateMock).toHaveBeenCalledTimes(1);
		expect(startTaskSessionMutateMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				taskId: initialTaskId,
				prompt: "",
				baseRef: "main",
			}),
		);
		expect(initialSnapshot.sessionKeys).toEqual([initialTaskId]);
	});

	it("does not restart the home terminal session on a no-op rerender", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const initialTaskId = requireTaskId(requireSnapshot(latestSnapshot).taskId);

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const rerenderedSnapshot = requireSnapshot(latestSnapshot);
		expect(rerenderedSnapshot.taskId).toBe(initialTaskId);
		expect(startTaskSessionMutateMock).toHaveBeenCalledTimes(1);
		expect(stopTaskSessionMutateMock).not.toHaveBeenCalled();
	});

	it("starts the home terminal session even when a stale summary was restored", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					seedSessionSummary
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const snapshot = requireSnapshot(latestSnapshot);
		expect(snapshot.panelMode).toBe("terminal");
		expect(snapshot.taskId).toMatch(/^__home_agent__:workspace-1:claude$/);
		expect(startTaskSessionMutateMock).toHaveBeenCalledTimes(1);
		expect(startTaskSessionMutateMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				taskId: snapshot.taskId,
				prompt: "",
				baseRef: "main",
			}),
		);
	});

	it("reuses the same home chat session id after remounting the app", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig({
						selectedAgentId: "claude",
						effectiveCommand: "claude",
					})}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const firstTaskId = requireTaskId(requireSnapshot(latestSnapshot).taskId);

		await act(async () => {
			root.unmount();
		});
		root = createRoot(container);
		latestSnapshot = null;

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig({
						selectedAgentId: "claude",
						effectiveCommand: "claude",
					})}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const secondTaskId = requireTaskId(requireSnapshot(latestSnapshot).taskId);
		expect(secondTaskId).toMatch(/^__home_agent__:workspace-1:claude$/);
		expect(secondTaskId).toBe(firstTaskId);
		expect(stopTaskSessionMutateMock).not.toHaveBeenCalled();
	});

	it("keeps one home terminal session per project when switching workspaces", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const firstTaskId = requireTaskId(requireSnapshot(latestSnapshot).taskId);
		expect(firstTaskId).toMatch(/^__home_agent__:workspace-1:claude$/);

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-2"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const secondSnapshot = requireSnapshot(latestSnapshot);
		expect(secondSnapshot.taskId).toMatch(/^__home_agent__:workspace-2:claude$/);
		expect(secondSnapshot.taskId).not.toBe(firstTaskId);
		expect([...secondSnapshot.sessionKeys].sort()).toEqual([firstTaskId, secondSnapshot.taskId].sort());
		expect(startTaskSessionMutateMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				workspaceId: "workspace-2",
				taskId: secondSnapshot.taskId,
			}),
		);
		expect(stopTaskSessionMutateMock).not.toHaveBeenCalled();

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const returnedSnapshot = requireSnapshot(latestSnapshot);
		expect(returnedSnapshot.taskId).toBe(firstTaskId);
		expect([...returnedSnapshot.sessionKeys].sort()).toEqual([firstTaskId, secondSnapshot.taskId].sort());
		expect(startTaskSessionMutateMock).toHaveBeenCalledTimes(2);
	});

	it("reuses an in-flight project terminal start when switching away and back", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const firstWorkspaceStart = createDeferred<{
			ok: boolean;
			summary: RuntimeTaskSessionSummary;
		}>();
		const secondWorkspaceStart = createDeferred<{
			ok: boolean;
			summary: RuntimeTaskSessionSummary;
		}>();

		startTaskSessionMutateMock.mockReset();
		startTaskSessionMutateMock
			.mockImplementationOnce(async () => await firstWorkspaceStart.promise)
			.mockImplementationOnce(async () => await secondWorkspaceStart.promise);

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const workspaceOneTaskId = requireTaskId(requireSnapshot(latestSnapshot).taskId);

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-2"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		const workspaceTwoTaskId = requireTaskId(requireSnapshot(latestSnapshot).taskId);

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-1"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		expect(requireTaskId(requireSnapshot(latestSnapshot).taskId)).toBe(workspaceOneTaskId);
		expect(startTaskSessionMutateMock).toHaveBeenCalledTimes(2);

		await act(async () => {
			root.render(
				<HookHarness
					config={null}
					currentProjectId="workspace-2"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		await act(async () => {
			firstWorkspaceStart.resolve({
				ok: true,
				summary: createSummary(workspaceOneTaskId, "claude"),
			});
			await createFlushPromises();
			secondWorkspaceStart.resolve({
				ok: true,
				summary: createSummary(workspaceTwoTaskId, "claude"),
			});
			await createFlushPromises();
		});

		await act(async () => {
			root.render(
				<HookHarness
					config={createRuntimeConfig()}
					currentProjectId="workspace-2"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await createFlushPromises();
		});

		expect(requireTaskId(requireSnapshot(latestSnapshot).taskId)).toBe(workspaceTwoTaskId);
		expect([...requireSnapshot(latestSnapshot).sessionKeys].sort()).toEqual(
			[workspaceOneTaskId, workspaceTwoTaskId].sort(),
		);
		expect(startTaskSessionMutateMock).toHaveBeenCalledTimes(2);
		expect(stopTaskSessionMutateMock).not.toHaveBeenCalled();
	});
});
