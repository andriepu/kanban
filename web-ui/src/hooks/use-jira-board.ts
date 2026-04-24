import { useCallback, useEffect, useRef, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { JiraBoard, JiraCard, JiraCardStatus, JiraSubtask } from "@/types/jira";
import { useInterval, useUnmount } from "@/utils/react-use";

export interface UseJiraBoardOptions {
	isActive: boolean;
	syncIntervalMs: number;
}

export interface UseJiraBoardResult {
	board: JiraBoard;
	subtasks: Record<string, JiraSubtask>;
	isLoading: boolean;
	isImporting: boolean;
	moveCard: (jiraKey: string, newStatus: JiraCardStatus) => Promise<void>;
	refetch: () => void;
}

export function useJiraBoard(
	currentProjectId: string | null = null,
	options: UseJiraBoardOptions = { isActive: false, syncIntervalMs: 60 * 60 * 1000 },
): UseJiraBoardResult {
	const { isActive, syncIntervalMs } = options;
	const trpc = getRuntimeTrpcClient(currentProjectId);

	const [board, setBoard] = useState<JiraBoard>({ cards: [] });
	const [subtasks, setSubtasks] = useState<Record<string, JiraSubtask>>({});
	const [isLoading, setIsLoading] = useState(false);
	const [isImporting, setIsImporting] = useState(false);
	const requestIdRef = useRef(0);
	const isMountedRef = useRef(true);
	const isImportingRef = useRef(false);
	const prevIsActiveRef = useRef(false);

	useUnmount(() => {
		isMountedRef.current = false;
	});

	const fetchBoard = useCallback(async (): Promise<void> => {
		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		setIsLoading(true);
		try {
			const data = await trpc.jira.loadBoard.query();
			if (!isMountedRef.current || requestIdRef.current !== requestId) return;
			setBoard(data.board);
			setSubtasks(data.subtasks);
		} finally {
			if (isMountedRef.current && requestIdRef.current === requestId) {
				setIsLoading(false);
			}
		}
	}, [trpc]);

	useEffect(() => {
		void fetchBoard();
	}, [fetchBoard]);

	const refetch = useCallback((): void => {
		void fetchBoard();
	}, [fetchBoard]);

	const syncFromJira = useCallback(async (): Promise<void> => {
		if (isImportingRef.current) return;
		isImportingRef.current = true;
		setIsImporting(true);
		try {
			const result = await trpc.jira.importFromJira.mutate({
				jql: `assignee = currentUser() ORDER BY updated DESC`,
			});
			if (isMountedRef.current) {
				setBoard(result.board);
			}
		} finally {
			isImportingRef.current = false;
			if (isMountedRef.current) {
				setIsImporting(false);
			}
		}
	}, [trpc]);

	useInterval(
		() => {
			void syncFromJira();
		},
		isActive ? syncIntervalMs : null,
	);

	useEffect(() => {
		if (!prevIsActiveRef.current && isActive) {
			void syncFromJira();
		}
		prevIsActiveRef.current = isActive;
	}, [isActive, syncFromJira]);

	const moveCard = useCallback(
		async (jiraKey: string, newStatus: JiraCardStatus): Promise<void> => {
			const previousBoard = board;
			const updatedCards: JiraCard[] = board.cards.map((c) =>
				c.jiraKey === jiraKey ? { ...c, status: newStatus, updatedAt: Date.now() } : c,
			);
			const updatedBoard: JiraBoard = { cards: updatedCards };

			try {
				await trpc.jira.saveBoard.mutate({ board: updatedBoard });
			} catch {
				if (isMountedRef.current) {
					setBoard(previousBoard);
				}
				return;
			}
			if (isMountedRef.current) {
				setBoard(updatedBoard);
			}

			if (newStatus === "in_progress") {
				try {
					await trpc.jira.transitionIssue.mutate({ jiraKey, targetStatus: "in_progress" });
				} catch {
					// Jira transition failed — revert local state and re-fetch
					if (isMountedRef.current) {
						setBoard(previousBoard);
						void fetchBoard();
					}
				}
			}
		},
		[board, trpc, fetchBoard],
	);

	return {
		board,
		subtasks,
		isLoading,
		isImporting,
		moveCard,
		refetch,
	};
}
