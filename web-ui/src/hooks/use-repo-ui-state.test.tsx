import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useRepoUiState } from "@/hooks/use-repo-ui-state";
import type { BoardData } from "@/types";

type RepoUiStateResult = ReturnType<typeof useRepoUiState>;

function createBoard(): BoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function HookHarness({ onResult }: { onResult: (result: ReturnType<typeof useRepoUiState>) => void }): null {
	const result = useRepoUiState({
		board: createBoard(),
		canPersistWorkspaceState: true,
		currentRepoId: "project-b",
		repos: [
			{
				id: "project-a",
				name: "project-a",
				path: "/tmp/project-a",
				taskCounts: { backlog: 1, in_progress: 0, review: 1, trash: 0 },
				pullRequestCount: 0,
			},
			{
				id: "project-b",
				name: "project-b",
				path: "/tmp/project-b",
				taskCounts: { backlog: 0, in_progress: 0, review: 0, trash: 0 },
				pullRequestCount: 0,
			},
		],
		navigationCurrentRepoId: "project-b",
		selectedTaskId: null,
		streamError: null,
		isRepoSwitching: false,
		isInitialRuntimeLoad: false,
		isAwaitingWorkspaceSnapshot: false,
		isWorkspaceMetadataPending: true,
		hasReceivedSnapshot: true,
	});

	onResult(result);
	return null;
}

describe("useRepoUiState", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
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

	it("keeps the repo loading state visible while workspace metadata is still syncing", async () => {
		let latestResult: RepoUiStateResult | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					onResult={(result) => {
						latestResult = result;
					}}
				/>,
			);
		});

		if (latestResult === null) {
			throw new Error("Expected a hook result.");
		}
		const result: RepoUiStateResult = latestResult;
		expect(result.shouldShowRepoLoadingState).toBe(true);
		expect(result.shouldUseNavigationPath).toBe(true);
	});
});
