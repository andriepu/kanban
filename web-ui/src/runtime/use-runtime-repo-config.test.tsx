import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeConfigResponse } from "@/runtime/types";
import { type UseRuntimeRepoConfigResult, useRuntimeRepoConfig } from "@/runtime/use-runtime-repo-config";

const fetchRuntimeConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/runtime-config-query", () => ({
	fetchRuntimeConfig: fetchRuntimeConfigMock,
}));

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, resolve, reject };
}

function createRuntimeConfigResponse(selectedAgentId: RuntimeConfigResponse["selectedAgentId"]): RuntimeConfigResponse {
	return {
		selectedAgentId,
		agentAutonomousModeEnabled: true,
		effectiveCommand: selectedAgentId,
		globalConfigPath: "/tmp/global-config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: [selectedAgentId],
		agents: [
			{
				id: "claude",
				label: "Claude Code",
				binary: "claude",
				command: "claude",
				defaultArgs: [],
				installed: true,
				configured: true,
			},
		],
		commitPromptTemplate: "",
		openPrPromptTemplate: "",
		commitPromptTemplateDefault: "",
		openPrPromptTemplateDefault: "",
		worktreesRoot: null,
		reposRoot: null,
		jiraProjectKey: null,
		jiraBaseUrl: null,
		jiraEmail: null,
		jiraSyncIntervalMs: 60 * 60 * 1000,
		jiraApiTokenConfigured: false,
	};
}

type HookSnapshot = UseRuntimeRepoConfigResult;

function findLatestLoadedSnapshot(snapshots: HookSnapshot[]): HookSnapshot | null {
	for (let index = snapshots.length - 1; index >= 0; index -= 1) {
		const snapshot = snapshots[index];
		if (snapshot && snapshot.config !== null) {
			return snapshot;
		}
	}
	return null;
}

function HookHarness({
	workspaceId,
	onSnapshot,
}: {
	workspaceId: string | null;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const snapshot = useRuntimeRepoConfig(workspaceId);

	useEffect(() => {
		onSnapshot(snapshot);
	}, [onSnapshot, snapshot]);

	return null;
}

describe("useRuntimeRepoConfig", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		fetchRuntimeConfigMock.mockReset();
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

	it("clears the previous repo config immediately when switching workspaces", async () => {
		const projectAConfig = createRuntimeConfigResponse("claude");
		const projectBDeferred = createDeferred<RuntimeConfigResponse>();
		fetchRuntimeConfigMock.mockResolvedValueOnce(projectAConfig);
		fetchRuntimeConfigMock.mockImplementationOnce(() => projectBDeferred.promise);

		let snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					workspaceId="project-a"
					onSnapshot={(snapshot) => {
						snapshots = [...snapshots, snapshot];
					}}
				/>,
			);
			await Promise.resolve();
		});

		const loadedProjectASnapshot = findLatestLoadedSnapshot(snapshots);
		expect(fetchRuntimeConfigMock).toHaveBeenCalledWith("project-a");
		expect(loadedProjectASnapshot?.config).not.toBeNull();

		await act(async () => {
			root.render(
				<HookHarness
					workspaceId="project-b"
					onSnapshot={(snapshot) => {
						snapshots = [...snapshots, snapshot];
					}}
				/>,
			);
		});

		expect(fetchRuntimeConfigMock).toHaveBeenCalledWith("project-b");
		expect(snapshots.at(-1)?.config).toBeNull();

		await act(async () => {
			projectBDeferred.resolve(createRuntimeConfigResponse("claude"));
			await projectBDeferred.promise;
		});

		expect(snapshots.at(-1)?.config?.selectedAgentId).toBe("claude");
	});

	it("loads runtime config without a selected repo", async () => {
		const startupConfig = createRuntimeConfigResponse("claude");
		fetchRuntimeConfigMock.mockResolvedValue(startupConfig);
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					workspaceId={null}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(fetchRuntimeConfigMock).toHaveBeenCalledWith(null);
		if (latestSnapshot === null) {
			throw new Error("Expected a runtime repo config snapshot.");
		}
		const snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.config?.selectedAgentId).toBe("claude");
		expect(snapshot.isLoading).toBe(false);
	});
});
