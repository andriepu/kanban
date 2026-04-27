import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { JiraBoard, JiraCard, JiraCardStatus, JiraPullRequest } from "@/types/jira";
import { useInterval, useUnmount } from "@/utils/react-use";

export interface IssueData {
	jiraKey: string;
	summary: string;
	description: string | null;
}

export interface UseJiraBoardOptions {
	isActive: boolean;
	syncIntervalMs: number;
}

export interface UseJiraBoardResult {
	board: JiraBoard;
	pullRequests: Record<string, JiraPullRequest>;
	details: Record<string, IssueData>;
	isLoading: boolean;
	isImporting: boolean;
	moveCard: (jiraKey: string, newStatus: JiraCardStatus) => Promise<void>;
	deleteCard: (jiraKey: string) => void;
	refetch: () => void;
	importFromJira: () => Promise<void>;
	scanPRs: () => Promise<void>;
	prScanning: boolean;
	fetchDetail: (jiraKey: string) => void;
}

export function useJiraBoard(
	currentRepoId: string | null = null,
	options: UseJiraBoardOptions = { isActive: false, syncIntervalMs: 60 * 60 * 1000 },
): UseJiraBoardResult {
	const { isActive, syncIntervalMs } = options;
	const trpc = getRuntimeTrpcClient(currentRepoId);

	const [board, setBoard] = useState<JiraBoard>({ cards: [] });
	const [pullRequests, setPullRequests] = useState<Record<string, JiraPullRequest>>({});
	const [details, setDetails] = useState<Record<string, IssueData>>({});
	const [isLoading, setIsLoading] = useState(false);
	const [isImporting, setIsImporting] = useState(false);
	const [prScanning, setPrScanning] = useState(false);
	const requestIdRef = useRef(0);
	const isMountedRef = useRef(true);
	const isImportingRef = useRef(false);
	const prevIsActiveRef = useRef(false);
	const boardRef = useRef<JiraBoard>({ cards: [] });
	const deleteTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
	const prScannedOnceRef = useRef(false);
	const scanPRsRef = useRef<() => Promise<void>>(async () => {});
	const inFlightDetailsRef = useRef<Set<string>>(new Set());

	function applyBoard(b: JiraBoard): void {
		boardRef.current = b;
		setBoard(b);
	}

	useUnmount(() => {
		isMountedRef.current = false;
		for (const id of deleteTimersRef.current.values()) {
			clearTimeout(id);
		}
	});

	const fetchDetail = useCallback(
		(jiraKey: string): void => {
			if (inFlightDetailsRef.current.has(jiraKey)) return;
			inFlightDetailsRef.current.add(jiraKey);
			trpc.jira.fetchIssue
				.query({ jiraKey })
				.then((data) => {
					if (isMountedRef.current) {
						setDetails((prev) => ({ ...prev, [data.jiraKey]: data }));
					}
				})
				.catch(() => {
					// silently ignore background prefetch failures
				})
				.finally(() => {
					inFlightDetailsRef.current.delete(jiraKey);
				});
		},
		[trpc],
	);

	// Load persisted details once on mount
	useEffect(() => {
		trpc.jira.loadDetails
			.query()
			.then((result) => {
				if (isMountedRef.current) {
					setDetails((prev) => ({ ...result.details, ...prev }));
				}
			})
			.catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const fetchBoard = useCallback(async (): Promise<void> => {
		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		setIsLoading(true);
		try {
			const data = await trpc.jira.loadBoard.query();
			if (!isMountedRef.current || requestIdRef.current !== requestId) return;
			const doneOnLoad = data.board.cards.filter((c) => c.status === "done");
			const cleanBoard =
				doneOnLoad.length > 0 ? { cards: data.board.cards.filter((c) => c.status !== "done") } : data.board;
			applyBoard(cleanBoard);
			setPullRequests(data.pullRequests);
			if (doneOnLoad.length > 0) {
				void trpc.jira.saveBoard.mutate({ board: cleanBoard });
			}
		} finally {
			if (isMountedRef.current && requestIdRef.current === requestId) {
				setIsLoading(false);
				if (!prScannedOnceRef.current) {
					prScannedOnceRef.current = true;
					void scanPRsRef.current();
				}
				// Background-prefetch details for all visible cards
				for (const card of boardRef.current.cards) {
					fetchDetail(card.jiraKey);
				}
			}
		}
	}, [trpc, fetchDetail]);

	useEffect(() => {
		void fetchBoard();
	}, [fetchBoard]);

	const scheduleDelete = useCallback(
		(jiraKey: string): void => {
			const existing = deleteTimersRef.current.get(jiraKey);
			if (existing !== undefined) clearTimeout(existing);
			const id = setTimeout(() => {
				deleteTimersRef.current.delete(jiraKey);
				if (!isMountedRef.current) return;
				const cleaned = { cards: boardRef.current.cards.filter((c) => c.jiraKey !== jiraKey) };
				applyBoard(cleaned);
				void trpc.jira.saveBoard.mutate({ board: cleaned });
			}, 60_000);
			deleteTimersRef.current.set(jiraKey, id);
		},
		[trpc],
	);

	const deleteCard = useCallback(
		(jiraKey: string): void => {
			const timer = deleteTimersRef.current.get(jiraKey);
			if (timer !== undefined) {
				clearTimeout(timer);
				deleteTimersRef.current.delete(jiraKey);
			}
			const cleaned = { cards: boardRef.current.cards.filter((c) => c.jiraKey !== jiraKey) };
			applyBoard(cleaned);
			void trpc.jira.saveBoard.mutate({ board: cleaned });
		},
		[trpc],
	);

	const refetch = useCallback((): void => {
		void fetchBoard();
	}, [fetchBoard]);

	const scanPRs = useCallback(async (): Promise<void> => {
		if (prScanning) return;
		setPrScanning(true);
		try {
			const result = await trpc.jira.scanAndAttachPRs.mutate();
			if (isMountedRef.current) {
				setPullRequests(result.pullRequests);
				applyBoard(result.board);
				if (result.attached > 0) {
					toast.success(`Synced ${result.attached} PR${result.attached === 1 ? "" : "s"}`);
				}
			}
		} catch (error) {
			if (isMountedRef.current) {
				const message = error instanceof Error ? error.message : "Failed to sync PRs";
				toast.error(message);
			}
		} finally {
			if (isMountedRef.current) {
				setPrScanning(false);
			}
		}
	}, [trpc, prScanning]);

	useEffect(() => {
		scanPRsRef.current = scanPRs;
	}, [scanPRs]);

	const syncFromJira = useCallback(async (): Promise<void> => {
		if (isImportingRef.current) return;
		isImportingRef.current = true;
		setIsImporting(true);
		try {
			const result = await trpc.jira.importFromJira.mutate({
				jql: `assignee = currentUser() ORDER BY updated DESC`,
			});
			if (isMountedRef.current) {
				const doneOnSync = result.board.cards.filter((c) => c.status === "done");
				const cleanBoard =
					doneOnSync.length > 0 ? { cards: result.board.cards.filter((c) => c.status !== "done") } : result.board;
				applyBoard(cleanBoard);
				if (doneOnSync.length > 0) {
					void trpc.jira.saveBoard.mutate({ board: cleanBoard });
				}
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
			const existingTimer = deleteTimersRef.current.get(jiraKey);
			if (existingTimer !== undefined) {
				clearTimeout(existingTimer);
				deleteTimersRef.current.delete(jiraKey);
			}

			const previousBoard = board;
			const updatedCards: JiraCard[] = board.cards.map((c) =>
				c.jiraKey === jiraKey ? { ...c, status: newStatus, updatedAt: Date.now() } : c,
			);
			const updatedBoard: JiraBoard = { cards: updatedCards };

			try {
				await trpc.jira.saveBoard.mutate({ board: updatedBoard });
			} catch {
				if (isMountedRef.current) {
					applyBoard(previousBoard);
				}
				return;
			}
			if (isMountedRef.current) {
				applyBoard(updatedBoard);
			}

			if (newStatus === "done") {
				scheduleDelete(jiraKey);
			}

			if (newStatus === "in_progress") {
				try {
					await trpc.jira.transitionIssue.mutate({ jiraKey, targetStatus: "in_progress" });
				} catch {
					if (isMountedRef.current) {
						applyBoard(previousBoard);
						void fetchBoard();
					}
				}
			}
		},
		[board, trpc, fetchBoard, scheduleDelete],
	);

	return {
		board,
		pullRequests,
		details,
		isLoading,
		isImporting,
		moveCard,
		deleteCard,
		refetch,
		importFromJira: syncFromJira,
		scanPRs,
		prScanning,
		fetchDetail,
	};
}
