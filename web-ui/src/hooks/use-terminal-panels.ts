import { useCallback, useEffect, useRef, useState } from "react";

import { notifyError } from "@/components/app-toaster";
import {
	clampAtLeast,
	readOptionalPersistedResizeNumber,
	writePersistedResizeNumber,
} from "@/resize/resize-persistence";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeGitRepositoryInfo, RuntimeTaskSessionSummary } from "@/runtime/types";
import { LocalStorageKey, removeLocalStorageItem } from "@/storage/local-storage-store";
import { startShellTerminalSession } from "@/terminal/shell-session-flow";
import { getTerminalGeometry, prepareWaitForTerminalGeometry } from "@/terminal/terminal-geometry-registry";
import type { SendTerminalInputOptions } from "@/terminal/terminal-input";
import type { BoardCard, CardSelection } from "@/types";

const HOME_TERMINAL_TASK_PREFIX = "__home_terminal__";

function getHomeTerminalTaskId(jiraKey: string | null): string {
	return jiraKey ? `${HOME_TERMINAL_TASK_PREFIX}:${jiraKey}` : HOME_TERMINAL_TASK_PREFIX;
}
const HOME_TERMINAL_ROWS = 16;
const DETAIL_TERMINAL_TASK_PREFIX = "__detail_terminal__:";
const APPROX_TERMINAL_CELL_WIDTH_PX = 8;
const MIN_TERMINAL_COLS = 40;
const MIN_BOTTOM_TERMINAL_PANE_HEIGHT = 200;

function estimateShellTerminalCols(): number {
	if (typeof window === "undefined") {
		return 120;
	}
	return Math.max(MIN_TERMINAL_COLS, Math.floor(Math.max(0, window.innerWidth - 96) / APPROX_TERMINAL_CELL_WIDTH_PX));
}

function loadBottomTerminalPaneHeight(): number | undefined {
	return readOptionalPersistedResizeNumber({
		key: LocalStorageKey.BottomTerminalPaneHeight,
		normalize: (value) => clampAtLeast(value, MIN_BOTTOM_TERMINAL_PANE_HEIGHT),
	});
}

export function getDetailTerminalTaskId(taskId: string): string {
	return `${DETAIL_TERMINAL_TASK_PREFIX}${taskId}`;
}

async function resolveShellTerminalGeometry(taskId: string): Promise<{ cols: number; rows: number }> {
	const existingGeometry = getTerminalGeometry(taskId);
	if (existingGeometry) {
		return existingGeometry;
	}
	await prepareWaitForTerminalGeometry(taskId)();
	return (
		getTerminalGeometry(taskId) ?? {
			cols: estimateShellTerminalCols(),
			rows: HOME_TERMINAL_ROWS,
		}
	);
}

interface StartDetailTerminalOptions {
	showLoading?: boolean;
}

interface UseTerminalPanelsInput {
	currentRepoId: string | null;
	selectedCard: CardSelection | null;
	workspaceGit: RuntimeGitRepositoryInfo | null;
	agentCommand: string | null;
	upsertSession: (summary: RuntimeTaskSessionSummary) => void;
	sendTaskSessionInput: (
		taskId: string,
		text: string,
		options?: SendTerminalInputOptions,
	) => Promise<{ ok: boolean; message?: string }>;
	selectedJiraKey: string | null;
	worktreesRoot: string | null;
}

interface DetailTerminalPanelState {
	isOpen: boolean;
}

const DEFAULT_DETAIL_TERMINAL_PANEL_STATE: DetailTerminalPanelState = {
	isOpen: false,
};

export interface UseTerminalPanelsResult {
	homeTerminalTaskId: string;
	isHomeTerminalOpen: boolean;
	isHomeTerminalStarting: boolean;
	homeTerminalShellBinary: string | null;
	homeTerminalPaneHeight: number | undefined;
	isDetailTerminalOpen: boolean;
	detailTerminalTaskId: string | null;
	isDetailTerminalStarting: boolean;
	detailTerminalPaneHeight: number | undefined;
	setHomeTerminalPaneHeight: (height: number | undefined) => void;
	setDetailTerminalPaneHeight: (height: number | undefined) => void;
	openHomeTerminal: () => void;
	handleToggleHomeTerminal: () => void;
	handleToggleDetailTerminal: () => void;
	handleSendAgentCommandToHomeTerminal: () => void;
	handleSendAgentCommandToDetailTerminal: () => void;
	resetBottomTerminalLayoutCustomizations: () => void;
	collapseHomeTerminal: () => void;
	collapseDetailTerminal: () => void;
	closeHomeTerminal: () => void;
	closeDetailTerminal: () => void;
	resetTerminalPanelsState: () => void;
}

export function useTerminalPanels({
	currentRepoId,
	selectedCard,
	workspaceGit,
	agentCommand,
	upsertSession,
	sendTaskSessionInput,
	selectedJiraKey,
	worktreesRoot,
}: UseTerminalPanelsInput): UseTerminalPanelsResult {
	const homeTerminalKeyRef = useRef<string | null>(null);
	// Always-current refs so callbacks don't need these in their dep arrays.
	const selectedJiraKeyRef = useRef(selectedJiraKey);
	selectedJiraKeyRef.current = selectedJiraKey;
	const worktreesRootRef = useRef(worktreesRoot);
	worktreesRootRef.current = worktreesRoot;
	const isHomeTerminalOpenRef = useRef(false);
	const detailTerminalSelectionKeyRef = useRef<string | null>(null);
	const [isHomeTerminalOpen, setIsHomeTerminalOpen] = useState(false);
	isHomeTerminalOpenRef.current = isHomeTerminalOpen;
	const [isHomeTerminalStarting, setIsHomeTerminalStarting] = useState(false);
	const [homeTerminalShellBinary, setHomeTerminalShellBinary] = useState<string | null>(null);
	const [lastBottomTerminalPaneHeight, setLastBottomTerminalPaneHeight] = useState<number | undefined>(
		loadBottomTerminalPaneHeight,
	);
	const [detailTerminalPanelStateByTaskId, setDetailTerminalPanelStateByTaskId] = useState<
		Record<string, DetailTerminalPanelState>
	>({});
	const [isDetailTerminalStarting, setIsDetailTerminalStarting] = useState(false);
	const homeTerminalTaskId = getHomeTerminalTaskId(selectedJiraKey);
	const detailTerminalTaskId = selectedCard ? getDetailTerminalTaskId(selectedCard.card.id) : null;
	const currentDetailTerminalPanelState = detailTerminalTaskId
		? (detailTerminalPanelStateByTaskId[detailTerminalTaskId] ?? DEFAULT_DETAIL_TERMINAL_PANEL_STATE)
		: DEFAULT_DETAIL_TERMINAL_PANEL_STATE;
	const isDetailTerminalOpen = currentDetailTerminalPanelState.isOpen;
	const homeTerminalPaneHeight = lastBottomTerminalPaneHeight;
	const detailTerminalPaneHeight = lastBottomTerminalPaneHeight;

	const updateDetailTerminalPanelState = useCallback(
		(taskId: string, updater: (previous: DetailTerminalPanelState) => DetailTerminalPanelState) => {
			setDetailTerminalPanelStateByTaskId((previous) => ({
				...previous,
				[taskId]: updater(previous[taskId] ?? DEFAULT_DETAIL_TERMINAL_PANEL_STATE),
			}));
		},
		[],
	);

	const persistBottomTerminalPaneHeight = useCallback((height: number | undefined) => {
		if (typeof height !== "number" || !Number.isFinite(height)) {
			return;
		}
		const normalizedHeight = writePersistedResizeNumber({
			key: LocalStorageKey.BottomTerminalPaneHeight,
			value: height,
			normalize: (value) => clampAtLeast(value, MIN_BOTTOM_TERMINAL_PANE_HEIGHT),
		});
		setLastBottomTerminalPaneHeight(normalizedHeight);
	}, []);

	const resetBottomTerminalPaneHeight = useCallback(() => {
		setLastBottomTerminalPaneHeight(undefined);
		removeLocalStorageItem(LocalStorageKey.BottomTerminalPaneHeight);
	}, []);

	const resetBottomTerminalLayoutCustomizations = useCallback(() => {
		resetBottomTerminalPaneHeight();
	}, [resetBottomTerminalPaneHeight]);

	const closeHomeTerminal = useCallback(() => {
		setIsHomeTerminalOpen(false);
		homeTerminalKeyRef.current = null;
	}, []);

	const closeDetailTerminal = useCallback(() => {
		if (detailTerminalTaskId) {
			updateDetailTerminalPanelState(detailTerminalTaskId, () => DEFAULT_DETAIL_TERMINAL_PANEL_STATE);
		}
		detailTerminalSelectionKeyRef.current = null;
	}, [detailTerminalTaskId, updateDetailTerminalPanelState]);

	const collapseHomeTerminal = useCallback(() => {
		resetBottomTerminalPaneHeight();
		closeHomeTerminal();
	}, [closeHomeTerminal, resetBottomTerminalPaneHeight]);

	const collapseDetailTerminal = useCallback(() => {
		resetBottomTerminalPaneHeight();
		closeDetailTerminal();
	}, [closeDetailTerminal, resetBottomTerminalPaneHeight]);

	const setHomeTerminalPaneHeight = useCallback(
		(height: number | undefined) => {
			persistBottomTerminalPaneHeight(height);
		},
		[persistBottomTerminalPaneHeight],
	);

	const setDetailTerminalPaneHeight = useCallback(
		(height: number | undefined) => {
			persistBottomTerminalPaneHeight(height);
		},
		[persistBottomTerminalPaneHeight],
	);

	const startHomeTerminalSession = useCallback(async (): Promise<boolean> => {
		if (!currentRepoId) {
			return false;
		}
		setIsHomeTerminalStarting(true);
		try {
			const jiraKey = selectedJiraKeyRef.current;
			const taskId = getHomeTerminalTaskId(jiraKey);

			let customCwd: string | undefined;
			if (jiraKey && worktreesRootRef.current) {
				const trpcClient = getRuntimeTrpcClient(currentRepoId);
				const result = await trpcClient.runtime.ensureJiraCardWorktreeParent.mutate({ jiraKey });
				if (result.ok && result.parentPath) {
					customCwd = result.parentPath;
				}
			}

			const geometry = await resolveShellTerminalGeometry(taskId);
			const payload = await startShellTerminalSession({
				workspaceId: currentRepoId,
				taskId,
				cols: geometry.cols,
				rows: geometry.rows,
				baseRef: workspaceGit?.currentBranch ?? workspaceGit?.defaultBranch ?? "HEAD",
				customCwd,
			});
			if (!payload.ok || !payload.summary) {
				throw new Error(payload.error ?? "Could not start terminal session.");
			}
			upsertSession(payload.summary);
			setHomeTerminalShellBinary(
				typeof payload.shellBinary === "string" && payload.shellBinary.trim() ? payload.shellBinary : null,
			);
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			notifyError(message);
			return false;
		} finally {
			setIsHomeTerminalStarting(false);
		}
	}, [currentRepoId, upsertSession, workspaceGit?.currentBranch, workspaceGit?.defaultBranch]);

	const openHomeTerminal = useCallback(() => {
		if (!currentRepoId) {
			return;
		}
		const key = `${currentRepoId}:${selectedJiraKeyRef.current ?? ""}:${worktreesRootRef.current ?? ""}`;
		if (isHomeTerminalOpenRef.current && homeTerminalKeyRef.current === key) {
			return;
		}
		homeTerminalKeyRef.current = key;
		setIsHomeTerminalOpen(true);
		void startHomeTerminalSession();
	}, [currentRepoId, startHomeTerminalSession]);

	const handleToggleHomeTerminal = useCallback(() => {
		if (isHomeTerminalOpen) {
			closeHomeTerminal();
			return;
		}
		openHomeTerminal();
	}, [closeHomeTerminal, isHomeTerminalOpen, openHomeTerminal]);

	const startDetailTerminalForCard = useCallback(
		async (card: BoardCard, options?: StartDetailTerminalOptions): Promise<boolean> => {
			if (!currentRepoId) {
				return false;
			}
			const showLoading = options?.showLoading ?? false;
			if (showLoading) {
				setIsDetailTerminalStarting(true);
			}
			try {
				const targetTaskId = getDetailTerminalTaskId(card.id);
				const geometry = await resolveShellTerminalGeometry(targetTaskId);
				const payload = await startShellTerminalSession({
					workspaceId: currentRepoId,
					taskId: targetTaskId,
					cols: geometry.cols,
					rows: geometry.rows,
					workspaceTaskId: card.id,
					baseRef: card.baseRef,
				});
				if (!payload.ok || !payload.summary) {
					throw new Error(payload.error ?? "Could not start detail terminal session.");
				}
				upsertSession(payload.summary);
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				notifyError(message);
				return false;
			} finally {
				if (showLoading) {
					setIsDetailTerminalStarting(false);
				}
			}
		},
		[currentRepoId, upsertSession],
	);

	const handleToggleDetailTerminal = useCallback(() => {
		if (!selectedCard) {
			return;
		}
		const targetTaskId = getDetailTerminalTaskId(selectedCard.card.id);
		if (isDetailTerminalOpen) {
			closeDetailTerminal();
			return;
		}
		updateDetailTerminalPanelState(targetTaskId, (previous) => ({
			...previous,
			isOpen: true,
		}));
		void (async () => {
			const selectionKey = `${selectedCard.card.id}:${selectedCard.card.baseRef}`;
			detailTerminalSelectionKeyRef.current = selectionKey;
			const started = await startDetailTerminalForCard(selectedCard.card, { showLoading: true });
			if (!started && detailTerminalSelectionKeyRef.current === selectionKey) {
				detailTerminalSelectionKeyRef.current = null;
			}
		})();
	}, [
		closeDetailTerminal,
		isDetailTerminalOpen,
		selectedCard,
		startDetailTerminalForCard,
		updateDetailTerminalPanelState,
	]);

	useEffect(() => {
		if (!isDetailTerminalOpen || !selectedCard) {
			detailTerminalSelectionKeyRef.current = null;
			return;
		}
		const selectionKey = `${selectedCard.card.id}:${selectedCard.card.baseRef}`;
		if (detailTerminalSelectionKeyRef.current === selectionKey) {
			return;
		}
		detailTerminalSelectionKeyRef.current = selectionKey;
		void startDetailTerminalForCard(selectedCard.card);
	}, [isDetailTerminalOpen, selectedCard?.card.baseRef, selectedCard?.card.id, startDetailTerminalForCard]);

	useEffect(() => {
		if (!isHomeTerminalOpen) {
			homeTerminalKeyRef.current = null;
			return;
		}
		const key = `${currentRepoId ?? ""}:${selectedJiraKeyRef.current ?? ""}:${worktreesRoot ?? ""}`;
		if (!currentRepoId || homeTerminalKeyRef.current === key) {
			return;
		}
		homeTerminalKeyRef.current = key;
		void (async () => {
			const started = await startHomeTerminalSession();
			if (!started) {
				closeHomeTerminal();
			}
		})();
	}, [closeHomeTerminal, currentRepoId, isHomeTerminalOpen, startHomeTerminalSession, worktreesRoot]);

	useEffect(() => {
		if (!selectedJiraKey || !currentRepoId) {
			return;
		}
		openHomeTerminal();
	}, [selectedJiraKey, currentRepoId, openHomeTerminal]);

	const handleSendAgentCommandToHomeTerminal = useCallback(() => {
		if (!agentCommand) {
			return;
		}
		void sendTaskSessionInput(homeTerminalTaskId, agentCommand, { appendNewline: true });
	}, [agentCommand, homeTerminalTaskId, sendTaskSessionInput]);

	const handleSendAgentCommandToDetailTerminal = useCallback(() => {
		if (!agentCommand || !selectedCard) {
			return;
		}
		const terminalTaskId = getDetailTerminalTaskId(selectedCard.card.id);
		void sendTaskSessionInput(terminalTaskId, agentCommand, { appendNewline: true });
	}, [agentCommand, selectedCard, sendTaskSessionInput]);

	const resetTerminalPanelsState = useCallback(() => {
		closeHomeTerminal();
		setIsHomeTerminalStarting(false);
		setHomeTerminalShellBinary(null);
		setDetailTerminalPanelStateByTaskId({});
		detailTerminalSelectionKeyRef.current = null;
		setIsDetailTerminalStarting(false);
	}, [closeHomeTerminal]);

	return {
		homeTerminalTaskId,
		isHomeTerminalOpen,
		isHomeTerminalStarting,
		homeTerminalShellBinary,
		homeTerminalPaneHeight,
		isDetailTerminalOpen,
		detailTerminalTaskId,
		isDetailTerminalStarting,
		detailTerminalPaneHeight,
		setHomeTerminalPaneHeight,
		setDetailTerminalPaneHeight,
		openHomeTerminal,
		handleToggleHomeTerminal,
		handleToggleDetailTerminal,
		handleSendAgentCommandToHomeTerminal,
		handleSendAgentCommandToDetailTerminal,
		resetBottomTerminalLayoutCustomizations,
		collapseHomeTerminal,
		collapseDetailTerminal,
		closeHomeTerminal,
		closeDetailTerminal,
		resetTerminalPanelsState,
	};
}
