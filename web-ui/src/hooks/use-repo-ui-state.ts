import type { ComponentProps } from "react";
import { useMemo } from "react";
import type { RepoNavigationPanel } from "@/components/repo-navigation-panel";
import { countTasksByColumn } from "@/hooks/app-utils";
import type { BoardData } from "@/types";

type RepoSummaries = ComponentProps<typeof RepoNavigationPanel>["repos"];

interface UseRepoUiStateInput {
	board: BoardData;
	canPersistWorkspaceState: boolean;
	currentRepoId: string | null;
	repos: RepoSummaries;
	navigationCurrentRepoId: string | null;
	selectedTaskId: string | null;
	streamError: string | null;
	isRepoSwitching: boolean;
	isInitialRuntimeLoad: boolean;
	isAwaitingWorkspaceSnapshot: boolean;
	isWorkspaceMetadataPending: boolean;
	hasReceivedSnapshot: boolean;
}

interface UseRepoUiStateResult {
	displayedRepos: RepoSummaries;
	navigationRepoPath: string | null;
	shouldShowRepoLoadingState: boolean;
	isRepoListLoading: boolean;
	shouldUseNavigationPath: boolean;
}

export function useRepoUiState({
	board,
	canPersistWorkspaceState,
	currentRepoId,
	repos,
	navigationCurrentRepoId,
	selectedTaskId,
	streamError,
	isRepoSwitching,
	isInitialRuntimeLoad,
	isAwaitingWorkspaceSnapshot,
	isWorkspaceMetadataPending,
	hasReceivedSnapshot,
}: UseRepoUiStateInput): UseRepoUiStateResult {
	const displayedRepos = useMemo(() => {
		if (!canPersistWorkspaceState || !currentRepoId) {
			return repos;
		}
		const localCounts = countTasksByColumn(board);
		return repos.map((repo) =>
			repo.id === currentRepoId
				? {
						...repo,
						taskCounts: localCounts,
					}
				: repo,
		);
	}, [board, canPersistWorkspaceState, currentRepoId, repos]);

	const navigationRepoPath = useMemo(() => {
		if (!navigationCurrentRepoId) {
			return null;
		}
		return repos.find((repo) => repo.id === navigationCurrentRepoId)?.path ?? null;
	}, [navigationCurrentRepoId, repos]);

	const shouldShowRepoLoadingState =
		selectedTaskId === null &&
		!streamError &&
		(isRepoSwitching || isInitialRuntimeLoad || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending);
	const isRepoListLoading = !hasReceivedSnapshot && !streamError;
	const shouldUseNavigationPath = isRepoSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending;

	return {
		displayedRepos,
		navigationRepoPath,
		shouldShowRepoLoadingState,
		isRepoListLoading,
		shouldUseNavigationPath,
	};
}
