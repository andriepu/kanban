// Main React composition root for the browser app.
// Keep this file focused on wiring top-level hooks and surfaces together, and
// push runtime-specific orchestration down into hooks and service modules.
import { FolderOpen } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AddRepoDialog } from "@/components/add-repo-dialog";
import { notifyError, showAppToast } from "@/components/app-toaster";
import { CardDetailView } from "@/components/card-detail-view";
import { ClearTrashDialog } from "@/components/clear-trash-dialog";
import { DebugDialog } from "@/components/debug-dialog";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { GitHistoryView } from "@/components/git-history-view";
import { JiraBoardView } from "@/components/jira-board";
import { JiraCardDetailView } from "@/components/jira-card-detail-view";
import { JiraPullRequestBoard } from "@/components/jira-pull-request-board";
import { JiraPullRequestDetailView } from "@/components/jira-pull-request-detail-view";
import { RepoNavigationPanel } from "@/components/repo-navigation-panel";
import { RuntimeSettingsDialog, type RuntimeSettingsSection } from "@/components/runtime-settings-dialog";
import { StartupOnboardingDialog } from "@/components/startup-onboarding-dialog";
import { TaskCreateDialog } from "@/components/task-create-dialog";
import { TaskInlineCreateCard } from "@/components/task-inline-create-card";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { createInitialBoardData } from "@/data/board-data";
import { createIdleTaskSession } from "@/hooks/app-utils";
import { KanbanAccessBlockedFallback } from "@/hooks/kanban-access-blocked-fallback";
import { RuntimeDisconnectedFallback } from "@/hooks/runtime-disconnected-fallback";
import { useAppHotkeys } from "@/hooks/use-app-hotkeys";
import { useBoardInteractions } from "@/hooks/use-board-interactions";
import { useDebugTools } from "@/hooks/use-debug-tools";
import { useDetailTaskNavigation } from "@/hooks/use-detail-task-navigation";
import { useDocumentVisibility } from "@/hooks/use-document-visibility";
import { useGitActions } from "@/hooks/use-git-actions";
import { useJiraBoard } from "@/hooks/use-jira-board";
import { useKanbanAccessGate } from "@/hooks/use-kanban-access-gate";
import { useOpenWorkspace } from "@/hooks/use-open-workspace";
import { parseRemovedRepoPathFromStreamError, useRepoNavigation } from "@/hooks/use-repo-navigation";
import { useRepoUiState } from "@/hooks/use-repo-ui-state";
import { useReviewReadyNotifications } from "@/hooks/use-review-ready-notifications";
import { useShortcutActions } from "@/hooks/use-shortcut-actions";
import { useTaskBranchOptions } from "@/hooks/use-task-branch-options";
import { useTaskEditor } from "@/hooks/use-task-editor";
import { useTaskSessions } from "@/hooks/use-task-sessions";
import { useTaskStartActions } from "@/hooks/use-task-start-actions";
import { useTerminalPanels } from "@/hooks/use-terminal-panels";
import { useWorkspaceSync } from "@/hooks/use-workspace-sync";
import { LayoutCustomizationsProvider } from "@/resize/layout-customizations";
import { ResizableBottomPane } from "@/resize/resizable-bottom-pane";
import { useRepoNavigationLayout } from "@/resize/use-repo-navigation-layout";
import { getTaskAgentNavbarHint } from "@/runtime/native-agent";
import { shouldShowStartupOnboardingDialog } from "@/runtime/onboarding";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { useRuntimeConfig } from "@/runtime/use-runtime-config";
import { useRuntimeRepoConfig } from "@/runtime/use-runtime-repo-config";
import { useTerminalConnectionReady } from "@/runtime/use-terminal-connection-ready";
import { useWorkspacePersistence } from "@/runtime/use-workspace-persistence";
import { saveWorkspaceState } from "@/runtime/workspace-state-query";
import { findCardSelection } from "@/state/board-state";
import {
	getTaskWorkspaceInfo,
	getTaskWorkspaceSnapshot,
	replaceWorkspaceMetadata,
	resetWorkspaceMetadataStore,
} from "@/stores/workspace-metadata-store";
import { useTerminalThemeColors } from "@/terminal/theme-colors";
import type { BoardData } from "@/types";
import type { JiraPullRequest } from "@/types/jira";

export default function App(): ReactElement {
	const terminalThemeColors = useTerminalThemeColors();
	const [board, setBoard] = useState<BoardData>(() => createInitialBoardData());
	const [sessions, setSessions] = useState<Record<string, RuntimeTaskSessionSummary>>({});
	const [canPersistWorkspaceState, setCanPersistWorkspaceState] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [settingsInitialSection, setSettingsInitialSection] = useState<RuntimeSettingsSection | null>(null);
	const [selectedJiraKey, setSelectedJiraKey] = useState<string | null>(null);
	const [isClearTrashDialogOpen, setIsClearTrashDialogOpen] = useState(false);
	const [isGitHistoryOpen, setIsGitHistoryOpen] = useState(false);
	const [pendingTaskStartAfterEditId, setPendingTaskStartAfterEditId] = useState<string | null>(null);
	const taskEditorResetRef = useRef<() => void>(() => {});
	const lastStreamErrorRef = useRef<string | null>(null);
	const [selectedPullRequestModal, setSelectedPullRequestModal] = useState<JiraPullRequest | null>(null);
	const handleRepoSwitchStart = useCallback(() => {
		setCanPersistWorkspaceState(false);
		setIsGitHistoryOpen(false);
		setPendingTaskStartAfterEditId(null);
		taskEditorResetRef.current();
	}, []);
	const {
		currentRepoId,
		repos,
		workspaceState: streamedWorkspaceState,
		workspaceMetadata,
		latestTaskReadyForReview,
		streamError,
		isRuntimeDisconnected,
		hasReceivedSnapshot,
		navigationCurrentRepoId,
		removingRepoId,
		hasNoRepos,
		isRepoSwitching,
		handleSelectRepo,
		handleAddRepo,
		handleAddRepoSuccess,
		handleRemoveRepo,
		isAddRepoDialogOpen,
		setIsAddRepoDialogOpen,
		pendingNativeGitInitPath,
		resetRepoNavigationState,
		repoFilter,
		setRepoFilter,
		sidebarTab,
		setSidebarTab,
	} = useRepoNavigation({
		onRepoSwitchStart: handleRepoSwitchStart,
	});
	const activeNotificationWorkspaceId = navigationCurrentRepoId;
	const isDocumentVisible = useDocumentVisibility();
	const isInitialRuntimeLoad = !hasReceivedSnapshot && currentRepoId === null && repos.length === 0 && !streamError;
	const isAwaitingWorkspaceSnapshot = currentRepoId !== null && streamedWorkspaceState === null;
	const {
		config: runtimeRepoConfig,
		isLoading: isRuntimeRepoConfigLoading,
		refresh: refreshRuntimeRepoConfig,
	} = useRuntimeRepoConfig(currentRepoId);
	const { isBlocked: isKanbanAccessBlocked } = useKanbanAccessGate({
		workspaceId: currentRepoId,
	});
	const settingsWorkspaceId = navigationCurrentRepoId ?? currentRepoId;
	const { config: settingsRuntimeRepoConfig, refresh: refreshSettingsRuntimeRepoConfig } =
		useRuntimeRepoConfig(settingsWorkspaceId);
	const {
		debugModeEnabled,
		isDebugDialogOpen,
		isResetAllStatePending,
		handleOpenDebugDialog,
		handleDebugDialogOpenChange,
		handleResetAllState,
	} = useDebugTools({
		runtimeRepoConfig,
		settingsRuntimeRepoConfig,
	});
	const {
		markConnectionReady: markTerminalConnectionReady,
		prepareWaitForConnection: prepareWaitForTerminalConnectionReady,
	} = useTerminalConnectionReady();
	const readyForReviewNotificationsEnabled = runtimeRepoConfig?.readyForReviewNotificationsEnabled ?? true;
	const shortcuts = runtimeRepoConfig?.shortcuts ?? [];
	const selectedShortcutLabel = useMemo(() => {
		if (shortcuts.length === 0) {
			return null;
		}
		const configured = runtimeRepoConfig?.selectedShortcutLabel ?? null;
		if (configured && shortcuts.some((shortcut) => shortcut.label === configured)) {
			return configured;
		}
		return shortcuts[0]?.label ?? null;
	}, [runtimeRepoConfig?.selectedShortcutLabel, shortcuts]);
	const {
		upsertSession,
		ensureTaskWorkspace,
		startTaskSession,
		stopTaskSession,
		sendTaskSessionInput,
		cleanupTaskWorkspace,
		fetchTaskWorkspaceInfo,
	} = useTaskSessions({
		currentRepoId,
		setSessions,
	});

	const {
		workspacePath,
		workspaceGit,
		workspaceRevision,
		setWorkspaceRevision,
		workspaceHydrationNonce,
		isWorkspaceStateRefreshing,
		isWorkspaceMetadataPending,
		refreshWorkspaceState,
		resetWorkspaceSyncState,
	} = useWorkspaceSync({
		currentRepoId,
		streamedWorkspaceState,
		hasNoRepos,
		hasReceivedSnapshot,
		isDocumentVisible,
		setBoard,
		setSessions,
		setCanPersistWorkspaceState,
	});
	const { selectedTaskId, selectedCard, setSelectedTaskId, handleBack } = useDetailTaskNavigation({
		board,
		currentRepoId,
		isAwaitingWorkspaceSnapshot,
		isInitialRuntimeLoad,
		isRepoSwitching,
		isWorkspaceMetadataPending,
		onDetailClosed: () => {
			setIsGitHistoryOpen(false);
		},
	});

	useEffect(() => {
		replaceWorkspaceMetadata(workspaceMetadata);
	}, [workspaceMetadata]);

	useEffect(() => {
		if (!isRepoSwitching) {
			return;
		}
		resetWorkspaceMetadataStore();
	}, [isRepoSwitching]);

	const {
		displayedRepos,
		navigationRepoPath,
		shouldShowRepoLoadingState,
		isRepoListLoading,
		shouldUseNavigationPath,
	} = useRepoUiState({
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
	});

	useReviewReadyNotifications({
		activeWorkspaceId: activeNotificationWorkspaceId,
		board,
		isDocumentVisible,
		latestTaskReadyForReview,
		taskSessions: sessions,
		readyForReviewNotificationsEnabled,
		workspacePath,
	});

	const { createTaskBranchOptions, defaultTaskBranchRef } = useTaskBranchOptions({ workspaceGit });
	const queueTaskStartAfterEdit = useCallback((taskId: string) => {
		setPendingTaskStartAfterEditId(taskId);
	}, []);

	const {
		isInlineTaskCreateOpen,
		newTaskPrompt,
		setNewTaskPrompt,
		newTaskImages,
		setNewTaskImages,
		newTaskStartInPlanMode,
		setNewTaskStartInPlanMode,
		newTaskAutoReviewEnabled,
		setNewTaskAutoReviewEnabled,
		newTaskAutoReviewMode,
		setNewTaskAutoReviewMode,
		isNewTaskStartInPlanModeDisabled,
		newTaskBranchRef,
		setNewTaskBranchRef,
		newTaskAgentId,
		setNewTaskAgentId,
		editingTaskId,
		editTaskPrompt,
		setEditTaskPrompt,
		editTaskImages,
		setEditTaskImages,
		editTaskStartInPlanMode,
		setEditTaskStartInPlanMode,
		editTaskAutoReviewEnabled,
		setEditTaskAutoReviewEnabled,
		editTaskAutoReviewMode,
		setEditTaskAutoReviewMode,
		isEditTaskStartInPlanModeDisabled,
		editTaskBranchRef,
		setEditTaskBranchRef,
		handleOpenCreateTask,
		handleCancelCreateTask,
		handleOpenEditTask,
		handleCancelEditTask,
		handleSaveEditedTask,
		handleSaveAndStartEditedTask,
		handleSaveTaskTitle,
		handleCreateTask,
		handleCreateTasks,
		resetTaskEditorState,
	} = useTaskEditor({
		board,
		setBoard,
		currentRepoId,
		createTaskBranchOptions,
		defaultTaskBranchRef,
		setSelectedTaskId,
		queueTaskStartAfterEdit,
	});

	useEffect(() => {
		taskEditorResetRef.current = resetTaskEditorState;
	}, [resetTaskEditorState]);

	useEffect(() => {
		if (!isRepoSwitching) {
			return;
		}
		resetWorkspaceSyncState();
	}, [isRepoSwitching, resetWorkspaceSyncState]);

	useEffect(() => {
		if (!isRepoSwitching) {
			return;
		}
		resetTaskEditorState();
	}, [isRepoSwitching, resetTaskEditorState]);

	const {
		runningGitAction,
		taskGitActionLoadingByTaskId,
		commitTaskLoadingById,
		openPrTaskLoadingById,
		agentCommitTaskLoadingById,
		agentOpenPrTaskLoadingById,
		isDiscardingHomeWorkingChanges,
		gitActionError,
		gitActionErrorTitle,
		clearGitActionError,
		gitHistory,
		runGitAction,
		switchHomeBranch,
		discardHomeWorkingChanges,
		handleCommitTask,
		handleOpenPrTask,
		handleAgentCommitTask,
		handleAgentOpenPrTask,
		runAutoReviewGitAction,
		resetGitActionState,
	} = useGitActions({
		currentRepoId,
		board,
		selectedCard,
		runtimeRepoConfig,
		sendTaskSessionInput,
		fetchTaskWorkspaceInfo,
		isGitHistoryOpen,
		refreshWorkspaceState,
	});
	const agentCommand = runtimeRepoConfig?.effectiveCommand ?? null;
	const {
		homeTerminalTaskId,
		isHomeTerminalOpen,
		isHomeTerminalStarting,
		homeTerminalPaneHeight,
		isDetailTerminalOpen,
		detailTerminalTaskId,
		isDetailTerminalStarting,
		detailTerminalPaneHeight,
		isHomeTerminalExpanded,
		isDetailTerminalExpanded,
		setHomeTerminalPaneHeight,
		setDetailTerminalPaneHeight,
		handleToggleExpandHomeTerminal,
		handleToggleExpandDetailTerminal,
		handleToggleHomeTerminal,
		handleToggleDetailTerminal,
		handleSendAgentCommandToHomeTerminal,
		handleSendAgentCommandToDetailTerminal,
		prepareTerminalForShortcut,
		resetBottomTerminalLayoutCustomizations,
		collapseHomeTerminal,
		collapseDetailTerminal,
		closeHomeTerminal,
		closeDetailTerminal,
		resetTerminalPanelsState,
	} = useTerminalPanels({
		currentRepoId,
		selectedCard,
		workspaceGit,
		agentCommand,
		upsertSession,
		sendTaskSessionInput,
	});
	const homeTerminalSummary = sessions[homeTerminalTaskId] ?? null;
	const { runningShortcutLabel, handleSelectShortcutLabel, handleRunShortcut, handleCreateShortcut } =
		useShortcutActions({
			currentRepoId,
			selectedShortcutLabel: runtimeRepoConfig?.selectedShortcutLabel,
			shortcuts,
			refreshRuntimeRepoConfig,
			prepareTerminalForShortcut,
			prepareWaitForTerminalConnectionReady,
			sendTaskSessionInput,
		});

	const jiraSyncIntervalMs = runtimeRepoConfig?.jiraSyncIntervalMs ?? 60 * 60 * 1000;
	const isJiraBoardActive = !isGitHistoryOpen && sidebarTab !== "pr";
	const jiraBoard = useJiraBoard(currentRepoId, {
		isActive: isJiraBoardActive,
		syncIntervalMs: jiraSyncIntervalMs,
	});

	const persistWorkspaceStateAsync = useCallback(
		async (input: { workspaceId: string; payload: Parameters<typeof saveWorkspaceState>[1] }) =>
			await saveWorkspaceState(input.workspaceId, input.payload),
		[],
	);
	const handleWorkspaceStateConflict = useCallback(() => {
		showAppToast(
			{
				intent: "warning",
				icon: "warning-sign",
				message: "Workspace changed elsewhere. Synced latest state. Retry your last edit if needed.",
				timeout: 5000,
			},
			"workspace-state-conflict",
		);
	}, []);

	useWorkspacePersistence({
		board,
		sessions,
		currentRepoId,
		workspaceRevision,
		hydrationNonce: workspaceHydrationNonce,
		canPersistWorkspaceState,
		isDocumentVisible,
		isWorkspaceStateRefreshing,
		persistWorkspaceState: persistWorkspaceStateAsync,
		refetchWorkspaceState: refreshWorkspaceState,
		onWorkspaceRevisionChange: setWorkspaceRevision,
		onWorkspaceStateConflict: handleWorkspaceStateConflict,
	});

	useEffect(() => {
		if (!streamError) {
			lastStreamErrorRef.current = null;
			return;
		}
		const removedPath = parseRemovedRepoPathFromStreamError(streamError);
		if (removedPath !== null) {
			showAppToast(
				{
					intent: "danger",
					icon: "warning-sign",
					message: removedPath
						? `Repo no longer exists and was removed: ${removedPath}`
						: "Repo no longer exists and was removed.",
					timeout: 6000,
				},
				`repo-removed-${removedPath || "unknown"}`,
			);
			lastStreamErrorRef.current = null;
			return;
		}
		if (isRuntimeDisconnected) {
			lastStreamErrorRef.current = streamError;
			return;
		}
		if (lastStreamErrorRef.current !== streamError) {
			notifyError(streamError, { key: `error:${streamError}` });
		}
		lastStreamErrorRef.current = streamError;
	}, [isRuntimeDisconnected, streamError]);

	useEffect(() => {
		resetTaskEditorState();
		setIsClearTrashDialogOpen(false);
		resetGitActionState();
		resetRepoNavigationState();
		resetTerminalPanelsState();
		setSelectedJiraKey(null);
	}, [currentRepoId, resetGitActionState, resetRepoNavigationState, resetTaskEditorState, resetTerminalPanelsState]);

	useEffect(() => {
		if (selectedCard) {
			return;
		}
		if (hasNoRepos || !currentRepoId) {
			if (isHomeTerminalOpen) {
				closeHomeTerminal();
			}
			return;
		}
	}, [closeHomeTerminal, currentRepoId, hasNoRepos, isHomeTerminalOpen, selectedCard]);
	const showHomeBottomTerminal = !selectedCard && !hasNoRepos && isHomeTerminalOpen;
	const homeTerminalSubtitle = useMemo(
		() => workspacePath ?? navigationRepoPath ?? null,
		[navigationRepoPath, workspacePath],
	);

	const handleOpenSettings = useCallback((section?: RuntimeSettingsSection) => {
		setSettingsInitialSection(section ?? null);
		setIsSettingsOpen(true);
	}, []);
	const handleToggleGitHistory = useCallback(() => {
		if (hasNoRepos) {
			return;
		}
		setIsGitHistoryOpen((current) => !current);
	}, [hasNoRepos]);
	const handleCloseGitHistory = useCallback(() => {
		setIsGitHistoryOpen(false);
	}, []);

	const {
		handleStartTask,
		handleStartAllBacklogTasks,
		handleDetailTaskDragEnd,
		handleCardSelect,
		handleMoveToTrash,
		handleMoveReviewCardToTrash,
		handleRestoreTaskFromTrash,
		handleCancelAutomaticTaskAction,
		handleOpenClearTrash,
		handleConfirmClearTrash,
		handleAddReviewComments,
		handleSendReviewComments,
		moveToTrashLoadingById,
		trashTaskCount,
	} = useBoardInteractions({
		board,
		setBoard,
		sessions,
		setSessions,
		selectedCard,
		selectedTaskId,
		currentRepoId,
		setSelectedTaskId,
		setIsClearTrashDialogOpen,
		setIsGitHistoryOpen,
		stopTaskSession,
		cleanupTaskWorkspace,
		ensureTaskWorkspace,
		startTaskSession,
		fetchTaskWorkspaceInfo,
		sendTaskSessionInput,
		readyForReviewNotificationsEnabled,
		taskGitActionLoadingByTaskId,
		runAutoReviewGitAction,
	});

	const handlePullRequestClick = useCallback((pullRequest: JiraPullRequest) => {
		setSelectedPullRequestModal(pullRequest);
	}, []);

	const {
		handleCreateAndStartTask,
		handleCreateAndStartTasks,
		handleCreateStartAndOpenTask,
		handleStartTaskFromBoard,
		handleStartAllBacklogTasksFromBoard,
	} = useTaskStartActions({
		board,
		handleCreateTask,
		handleCreateTasks,
		handleStartTask,
		handleStartAllBacklogTasks,
		setSelectedTaskId,
	});

	useAppHotkeys({
		selectedCard,
		isDetailTerminalOpen,
		isHomeTerminalOpen: showHomeBottomTerminal,
		isHomeGitHistoryOpen: !selectedCard && isGitHistoryOpen,
		canUseCreateTaskShortcut: !hasNoRepos && currentRepoId !== null,
		handleToggleDetailTerminal,
		handleToggleHomeTerminal,
		handleToggleExpandDetailTerminal,
		handleToggleExpandHomeTerminal: handleToggleExpandHomeTerminal,
		handleOpenCreateTask,
		handleOpenSettings,
		handleToggleGitHistory,
		handleCloseGitHistory,
		onStartAllTasks: handleStartAllBacklogTasksFromBoard,
	});

	useEffect(() => {
		if (!pendingTaskStartAfterEditId) {
			return;
		}
		const selection = findCardSelection(board, pendingTaskStartAfterEditId);
		if (!selection || selection.column.id !== "backlog") {
			return;
		}
		handleStartTaskFromBoard(pendingTaskStartAfterEditId);
		setPendingTaskStartAfterEditId(null);
	}, [board, handleStartTaskFromBoard, pendingTaskStartAfterEditId]);

	const detailSession = selectedCard
		? (sessions[selectedCard.card.id] ?? createIdleTaskSession(selectedCard.card.id))
		: null;
	const detailTerminalSummary = detailTerminalTaskId ? (sessions[detailTerminalTaskId] ?? null) : null;
	const detailTerminalSubtitle = useMemo(() => {
		if (!selectedCard) {
			return null;
		}
		return (
			getTaskWorkspaceInfo(selectedCard.card.id, selectedCard.card.baseRef)?.path ??
			getTaskWorkspaceSnapshot(selectedCard.card.id)?.path ??
			null
		);
	}, [selectedCard]);

	const runtimeHint = useMemo(() => {
		return getTaskAgentNavbarHint(runtimeRepoConfig, {
			shouldUseNavigationPath,
		});
	}, [runtimeRepoConfig, shouldUseNavigationPath]);

	const activeWorkspacePath = selectedCard
		? (getTaskWorkspaceInfo(selectedCard.card.id, selectedCard.card.baseRef)?.path ??
			getTaskWorkspaceSnapshot(selectedCard.card.id)?.path ??
			workspacePath ??
			undefined)
		: shouldUseNavigationPath
			? (navigationRepoPath ?? undefined)
			: (workspacePath ?? undefined);

	const activeWorkspaceHint = useMemo(() => {
		if (!selectedCard) {
			return undefined;
		}
		const activeSelectedTaskWorkspaceInfo = getTaskWorkspaceInfo(selectedCard.card.id, selectedCard.card.baseRef);
		if (!activeSelectedTaskWorkspaceInfo) {
			return undefined;
		}
		if (!activeSelectedTaskWorkspaceInfo.exists) {
			return selectedCard.column.id === "trash" ? "Task worktree deleted" : "Task worktree not created yet";
		}
		return undefined;
	}, [selectedCard]);

	const sidebarLayout = useRepoNavigationLayout();
	const handleToggleSidebar = useCallback(() => {
		sidebarLayout.setSidebarCollapsed(!sidebarLayout.isCollapsed);
	}, [sidebarLayout]);

	const navbarWorkspacePath = hasNoRepos ? undefined : activeWorkspacePath;
	const navbarWorkspaceHint = hasNoRepos ? undefined : activeWorkspaceHint;
	const navbarRuntimeHint = hasNoRepos ? undefined : runtimeHint;
	const shouldHideRepoDependentTopBarActions =
		!selectedCard && (isRepoSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending);
	const isHomeWithoutSelectedRepo =
		!selectedCard && (sidebarTab === "task" || (sidebarTab === "pr" && repoFilter === null));
	const panelHighlightRepoId = sidebarTab === "pr" && repoFilter === null ? null : navigationCurrentRepoId;

	const {
		openTargetOptions,
		selectedOpenTargetId,
		onSelectOpenTarget,
		onOpenWorkspace,
		canOpenWorkspace,
		isOpeningWorkspace,
	} = useOpenWorkspace({
		currentRepoId,
		workspacePath: activeWorkspacePath,
	});
	const globalRuntimeConfig = useRuntimeConfig(true, null, null);

	const showingOnboarding = shouldShowStartupOnboardingDialog(globalRuntimeConfig.config);
	const prevShowingOnboardingRef = useRef(showingOnboarding);
	useEffect(() => {
		if (prevShowingOnboardingRef.current && !showingOnboarding) {
			void jiraBoard.importFromJira();
		}
		prevShowingOnboardingRef.current = showingOnboarding;
	}, [showingOnboarding, jiraBoard.importFromJira]);

	const handleCreateDialogOpenChange = useCallback(
		(open: boolean) => {
			if (!open) {
				handleCancelCreateTask();
			}
		},
		[handleCancelCreateTask],
	);

	const inlineTaskEditor = editingTaskId ? (
		<TaskInlineCreateCard
			prompt={editTaskPrompt}
			onPromptChange={setEditTaskPrompt}
			images={editTaskImages}
			onImagesChange={setEditTaskImages}
			onCreate={handleSaveEditedTask}
			onCreateAndStart={handleSaveAndStartEditedTask}
			onCancel={handleCancelEditTask}
			startInPlanMode={editTaskStartInPlanMode}
			onStartInPlanModeChange={setEditTaskStartInPlanMode}
			startInPlanModeDisabled={isEditTaskStartInPlanModeDisabled}
			autoReviewEnabled={editTaskAutoReviewEnabled}
			onAutoReviewEnabledChange={setEditTaskAutoReviewEnabled}
			autoReviewMode={editTaskAutoReviewMode}
			onAutoReviewModeChange={setEditTaskAutoReviewMode}
			workspaceId={currentRepoId}
			branchRef={editTaskBranchRef}
			branchOptions={createTaskBranchOptions}
			onBranchRefChange={setEditTaskBranchRef}
			mode="edit"
			idPrefix={`inline-edit-task-${editingTaskId}`}
		/>
	) : undefined;

	const jiraDetailContent =
		sidebarTab === "task" && selectedJiraKey != null ? (
			<JiraCardDetailView
				jiraKey={selectedJiraKey}
				board={jiraBoard.board}
				pullRequests={jiraBoard.pullRequests}
				details={jiraBoard.details}
				prScanning={jiraBoard.prScanning}
				fetchDetail={jiraBoard.fetchDetail}
				scanPRs={jiraBoard.scanPRs}
				onPullRequestCreated={jiraBoard.refetch}
			/>
		) : undefined;

	useEffect(() => {
		if (selectedJiraKey == null) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") setSelectedJiraKey(null);
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [selectedJiraKey]);

	if (isRuntimeDisconnected) {
		return <RuntimeDisconnectedFallback />;
	}
	if (isKanbanAccessBlocked) {
		return <KanbanAccessBlockedFallback />;
	}

	return (
		<LayoutCustomizationsProvider onResetBottomTerminalLayoutCustomizations={resetBottomTerminalLayoutCustomizations}>
			<div className="flex h-[100svh] min-w-0 overflow-hidden">
				{!selectedCard ? (
					<RepoNavigationPanel
						repos={displayedRepos}
						isLoadingRepos={isRepoListLoading}
						currentRepoId={panelHighlightRepoId}
						removingRepoId={removingRepoId}
						jiraDetailContent={jiraDetailContent}
						onSelectRepo={(repoId) => {
							void handleSelectRepo(repoId);
						}}
						onRemoveRepo={handleRemoveRepo}
						onAddRepo={() => {
							void handleAddRepo();
						}}
						sidebarWidth={sidebarLayout.sidebarWidth}
						setExpandedSidebarWidth={sidebarLayout.setExpandedSidebarWidth}
						isCollapsed={sidebarLayout.isCollapsed}
						setSidebarCollapsed={sidebarLayout.setSidebarCollapsed}
						sidebarTab={sidebarTab}
						onSidebarTabChange={setSidebarTab}
						hasJiraConfig={
							isRuntimeRepoConfigLoading ||
							Boolean(runtimeRepoConfig?.worktreesRoot && runtimeRepoConfig?.reposRoot)
						}
						repoFilter={repoFilter}
						onFilterRepo={setRepoFilter}
					/>
				) : null}
				<div className="flex flex-col flex-1 min-w-0 overflow-hidden">
					<TopBar
						onToggleSidebar={!selectedCard ? handleToggleSidebar : undefined}
						onBack={selectedCard ? handleBack : undefined}
						workspacePath={isHomeWithoutSelectedRepo ? undefined : navbarWorkspacePath}
						isWorkspacePathLoading={shouldShowRepoLoadingState}
						workspaceHint={isHomeWithoutSelectedRepo ? undefined : navbarWorkspaceHint}
						runtimeHint={isHomeWithoutSelectedRepo ? undefined : navbarRuntimeHint}
						selectedTaskId={selectedCard?.card.id ?? null}
						selectedTaskBaseRef={selectedCard?.card.baseRef ?? null}
						showHomeGitSummary={!hasNoRepos && !selectedCard && !isHomeWithoutSelectedRepo}
						runningGitAction={selectedCard || hasNoRepos || isHomeWithoutSelectedRepo ? null : runningGitAction}
						onGitFetch={
							selectedCard
								? undefined
								: () => {
										void runGitAction("fetch");
									}
						}
						onGitPull={
							selectedCard
								? undefined
								: () => {
										void runGitAction("pull");
									}
						}
						onGitPush={
							selectedCard
								? undefined
								: () => {
										void runGitAction("push");
									}
						}
						onToggleTerminal={
							hasNoRepos || isHomeWithoutSelectedRepo
								? undefined
								: selectedCard
									? handleToggleDetailTerminal
									: handleToggleHomeTerminal
						}
						isTerminalOpen={selectedCard ? isDetailTerminalOpen : showHomeBottomTerminal}
						isTerminalLoading={selectedCard ? isDetailTerminalStarting : isHomeTerminalStarting}
						onOpenSettings={handleOpenSettings}
						showDebugButton={debugModeEnabled}
						onOpenDebugDialog={debugModeEnabled ? handleOpenDebugDialog : undefined}
						shortcuts={shortcuts}
						selectedShortcutLabel={selectedShortcutLabel}
						onSelectShortcutLabel={handleSelectShortcutLabel}
						runningShortcutLabel={runningShortcutLabel}
						onRunShortcut={handleRunShortcut}
						onCreateFirstShortcut={currentRepoId ? handleCreateShortcut : undefined}
						openTargetOptions={openTargetOptions}
						selectedOpenTargetId={selectedOpenTargetId}
						onSelectOpenTarget={onSelectOpenTarget}
						onOpenWorkspace={onOpenWorkspace}
						canOpenWorkspace={canOpenWorkspace}
						isOpeningWorkspace={isOpeningWorkspace}
						onToggleGitHistory={hasNoRepos || isHomeWithoutSelectedRepo ? undefined : handleToggleGitHistory}
						isGitHistoryOpen={isGitHistoryOpen}
						hideRepoDependentActions={shouldHideRepoDependentTopBarActions || isHomeWithoutSelectedRepo}
					/>
					<div className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden">
						<div
							className="kb-home-layout"
							aria-hidden={selectedCard ? true : undefined}
							style={selectedCard ? { visibility: "hidden" } : undefined}
						>
							{shouldShowRepoLoadingState ? (
								<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0">
									<Spinner size={30} />
								</div>
							) : hasNoRepos ? (
								<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0 p-6">
									<div className="flex flex-col items-center justify-center gap-3 text-text-tertiary">
										<FolderOpen size={48} strokeWidth={1} />
										<h3 className="text-sm font-semibold text-text-primary">No repos yet</h3>
										<p className="text-[13px] text-text-secondary">
											Add a git repository to start using Kanban.
										</p>
										<Button
											variant="primary"
											onClick={() => {
												void handleAddRepo();
											}}
										>
											Add Repo
										</Button>
									</div>
								</div>
							) : (
								<div className="flex flex-1 flex-col min-h-0 min-w-0">
									<div className="flex flex-1 min-h-0 min-w-0">
										{isGitHistoryOpen ? (
											<GitHistoryView
												workspaceId={currentRepoId}
												gitHistory={gitHistory}
												onCheckoutBranch={(branch) => {
													void switchHomeBranch(branch);
												}}
												onDiscardWorkingChanges={() => {
													void discardHomeWorkingChanges();
												}}
												isDiscardWorkingChangesPending={isDiscardingHomeWorkingChanges}
											/>
										) : sidebarTab === "pr" ? (
											<JiraPullRequestBoard
												pullRequests={Object.values(jiraBoard.pullRequests)}
												repoFilter={repoFilter}
												sessions={sessions}
												onPullRequestClick={handlePullRequestClick}
											/>
										) : (
											<div className="flex flex-1 min-h-0 min-w-0">
												<JiraBoardView
													onCardClick={setSelectedJiraKey}
													selectedJiraKey={selectedJiraKey}
													jiraBoard={jiraBoard}
												/>
											</div>
										)}
									</div>
									{showHomeBottomTerminal ? (
										<ResizableBottomPane
											minHeight={200}
											initialHeight={homeTerminalPaneHeight}
											onHeightChange={setHomeTerminalPaneHeight}
											onCollapse={collapseHomeTerminal}
											isExpanded={isHomeTerminalExpanded}
										>
											<div
												style={{
													display: "flex",
													flex: "1 1 0",
													minWidth: 0,
													paddingLeft: 12,
													paddingRight: 12,
												}}
											>
												<AgentTerminalPanel
													key={`home-shell-${homeTerminalTaskId}`}
													taskId={homeTerminalTaskId}
													workspaceId={currentRepoId}
													summary={homeTerminalSummary}
													onSummary={upsertSession}
													showSessionToolbar={false}
													autoFocus
													onClose={closeHomeTerminal}
													minimalHeaderTitle="Terminal"
													minimalHeaderSubtitle={homeTerminalSubtitle}
													panelBackgroundColor="var(--color-surface-1)"
													terminalBackgroundColor={terminalThemeColors.surfaceRaised}
													cursorColor={terminalThemeColors.textPrimary}
													onConnectionReady={markTerminalConnectionReady}
													agentCommand={agentCommand}
													onSendAgentCommand={handleSendAgentCommandToHomeTerminal}
													isExpanded={isHomeTerminalExpanded}
													onToggleExpand={handleToggleExpandHomeTerminal}
												/>
											</div>
										</ResizableBottomPane>
									) : null}
								</div>
							)}
						</div>
						{selectedCard && detailSession ? (
							<div className="absolute inset-0 flex min-h-0 min-w-0">
								<CardDetailView
									selection={selectedCard}
									currentRepoId={currentRepoId}
									workspacePath={workspacePath}
									selectedAgentId={runtimeRepoConfig?.selectedAgentId ?? null}
									runtimeConfig={runtimeRepoConfig ?? null}
									sessionSummary={detailSession}
									taskSessions={sessions}
									onSessionSummary={upsertSession}
									onCardSelect={handleCardSelect}
									onTaskDragEnd={handleDetailTaskDragEnd}
									onStartTask={handleStartTaskFromBoard}
									onStartAllTasks={handleStartAllBacklogTasksFromBoard}
									onClearTrash={handleOpenClearTrash}
									editingTaskId={editingTaskId}
									inlineTaskEditor={inlineTaskEditor}
									onEditTask={(task) => {
										handleOpenEditTask(task, { preserveDetailSelection: true });
									}}
									onSaveTaskTitle={handleSaveTaskTitle}
									onCommitTask={handleCommitTask}
									onOpenPrTask={handleOpenPrTask}
									onAgentCommitTask={handleAgentCommitTask}
									onAgentOpenPrTask={handleAgentOpenPrTask}
									commitTaskLoadingById={commitTaskLoadingById}
									openPrTaskLoadingById={openPrTaskLoadingById}
									agentCommitTaskLoadingById={agentCommitTaskLoadingById}
									agentOpenPrTaskLoadingById={agentOpenPrTaskLoadingById}
									moveToTrashLoadingById={moveToTrashLoadingById}
									onMoveReviewCardToTrash={handleMoveReviewCardToTrash}
									onRestoreTaskFromTrash={handleRestoreTaskFromTrash}
									onCancelAutomaticTaskAction={handleCancelAutomaticTaskAction}
									onAddReviewComments={(taskId: string, text: string) => {
										void handleAddReviewComments(taskId, text);
									}}
									onSendReviewComments={(taskId: string, text: string) => {
										void handleSendReviewComments(taskId, text);
									}}
									onMoveToTrash={handleMoveToTrash}
									isMoveToTrashLoading={moveToTrashLoadingById[selectedCard.card.id] ?? false}
									gitHistoryPanel={
										isGitHistoryOpen ? (
											<GitHistoryView workspaceId={currentRepoId} gitHistory={gitHistory} />
										) : undefined
									}
									onCloseGitHistory={handleCloseGitHistory}
									bottomTerminalOpen={isDetailTerminalOpen}
									bottomTerminalTaskId={detailTerminalTaskId}
									bottomTerminalSummary={detailTerminalSummary}
									bottomTerminalSubtitle={detailTerminalSubtitle}
									onBottomTerminalClose={closeDetailTerminal}
									onBottomTerminalCollapse={collapseDetailTerminal}
									bottomTerminalPaneHeight={detailTerminalPaneHeight}
									onBottomTerminalPaneHeightChange={setDetailTerminalPaneHeight}
									onBottomTerminalConnectionReady={markTerminalConnectionReady}
									bottomTerminalAgentCommand={agentCommand}
									onBottomTerminalSendAgentCommand={handleSendAgentCommandToDetailTerminal}
									isBottomTerminalExpanded={isDetailTerminalExpanded}
									onBottomTerminalToggleExpand={handleToggleExpandDetailTerminal}
									isDocumentVisible={isDocumentVisible}
								/>
							</div>
						) : null}
						{selectedPullRequestModal ? (
							<JiraPullRequestDetailView
								pullRequest={selectedPullRequestModal}
								onClose={() => setSelectedPullRequestModal(null)}
							/>
						) : null}
					</div>
				</div>
				<RuntimeSettingsDialog
					open={isSettingsOpen}
					workspaceId={settingsWorkspaceId}
					initialConfig={settingsRuntimeRepoConfig}
					initialSection={settingsInitialSection}
					onOpenChange={(nextOpen) => {
						setIsSettingsOpen(nextOpen);
						if (!nextOpen) {
							setSettingsInitialSection(null);
						}
					}}
					onSaved={() => {
						refreshRuntimeRepoConfig();
						refreshSettingsRuntimeRepoConfig();
					}}
				/>
				<StartupOnboardingDialog
					open={shouldShowStartupOnboardingDialog(globalRuntimeConfig.config)}
					config={globalRuntimeConfig.config}
					isSaving={globalRuntimeConfig.isSaving}
					onSave={async (patch) => {
						await globalRuntimeConfig.save(patch);
					}}
					onRefreshConfig={globalRuntimeConfig.refresh}
				/>
				<DebugDialog
					open={isDebugDialogOpen}
					onOpenChange={handleDebugDialogOpenChange}
					isResetAllStatePending={isResetAllStatePending}
					onResetAllState={handleResetAllState}
				/>
				<TaskCreateDialog
					open={isInlineTaskCreateOpen}
					onOpenChange={handleCreateDialogOpenChange}
					prompt={newTaskPrompt}
					onPromptChange={setNewTaskPrompt}
					images={newTaskImages}
					onImagesChange={setNewTaskImages}
					onCreate={handleCreateTask}
					onCreateAndStart={handleCreateAndStartTask}
					onCreateStartAndOpen={handleCreateStartAndOpenTask}
					onCreateMultiple={handleCreateTasks}
					onCreateAndStartMultiple={handleCreateAndStartTasks}
					startInPlanMode={newTaskStartInPlanMode}
					onStartInPlanModeChange={setNewTaskStartInPlanMode}
					startInPlanModeDisabled={isNewTaskStartInPlanModeDisabled}
					autoReviewEnabled={newTaskAutoReviewEnabled}
					onAutoReviewEnabledChange={setNewTaskAutoReviewEnabled}
					autoReviewMode={newTaskAutoReviewMode}
					onAutoReviewModeChange={setNewTaskAutoReviewMode}
					workspaceId={currentRepoId}
					branchRef={newTaskBranchRef}
					branchOptions={createTaskBranchOptions}
					onBranchRefChange={setNewTaskBranchRef}
					agentId={newTaskAgentId}
					onAgentIdChange={setNewTaskAgentId}
					defaultAgentId={runtimeRepoConfig?.selectedAgentId ?? null}
				/>
				<ClearTrashDialog
					open={isClearTrashDialogOpen}
					taskCount={trashTaskCount}
					onCancel={() => setIsClearTrashDialogOpen(false)}
					onConfirm={handleConfirmClearTrash}
				/>

				<AddRepoDialog
					open={isAddRepoDialogOpen}
					onOpenChange={setIsAddRepoDialogOpen}
					onRepoAdded={handleAddRepoSuccess}
					currentRepoId={currentRepoId}
					initialGitInitPath={pendingNativeGitInitPath}
				/>

				<AlertDialog
					open={gitActionError !== null}
					onOpenChange={(open) => {
						if (!open) {
							clearGitActionError();
						}
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>{gitActionErrorTitle}</AlertDialogTitle>
					</AlertDialogHeader>
					<AlertDialogBody>
						<p>{gitActionError?.message}</p>
						{gitActionError?.output ? (
							<pre className="max-h-[220px] overflow-auto rounded-md bg-surface-0 p-3 font-mono text-xs text-text-secondary whitespace-pre-wrap">
								{gitActionError.output}
							</pre>
						) : null}
					</AlertDialogBody>
					<AlertDialogFooter className="justify-end">
						<AlertDialogAction asChild>
							<Button variant="default" onClick={clearGitActionError}>
								Close
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialog>
			</div>
		</LayoutCustomizationsProvider>
	);
}
