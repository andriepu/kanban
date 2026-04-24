import { useCallback, useEffect, useRef, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { JiraBoard, JiraCard, JiraCardStatus, JiraSubtask } from "@/types/jira";
import { useUnmount } from "@/utils/react-use";

export interface UseJiraBoardResult {
	board: JiraBoard;
	subtasks: Record<string, JiraSubtask>;
	isLoading: boolean;
	importFromJira: () => Promise<{ imported: number; skipped: number }>;
	isImporting: boolean;
	moveCard: (jiraKey: string, newStatus: JiraCardStatus) => Promise<void>;
	refetch: () => void;
}

export function useJiraBoard(currentProjectId: string | null = null): UseJiraBoardResult {
	const trpc = getRuntimeTrpcClient(currentProjectId);

	const [board, setBoard] = useState<JiraBoard>({ cards: [] });
	const [subtasks, setSubtasks] = useState<Record<string, JiraSubtask>>({});
	const [isLoading, setIsLoading] = useState(false);
	const [isImporting, setIsImporting] = useState(false);
	const requestIdRef = useRef(0);
	const isMountedRef = useRef(true);

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

	const importFromJira = useCallback(async (): Promise<{ imported: number; skipped: number }> => {
		setIsImporting(true);
		try {
			const result = await trpc.jira.importFromJira.mutate({
				jql: `assignee = currentUser() AND status = "To Do"`,
			});
			if (isMountedRef.current) {
				setBoard(result.board);
			}
			return { imported: result.imported, skipped: result.skipped };
		} finally {
			if (isMountedRef.current) {
				setIsImporting(false);
			}
		}
	}, [trpc]);

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
		importFromJira,
		isImporting,
		moveCard,
		refetch,
	};
}
