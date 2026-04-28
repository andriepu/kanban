import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type UseJiraBoardResult, useJiraBoard } from "./use-jira-board";

const mockLoadBoard = vi.hoisted(() => vi.fn());
const mockSaveBoard = vi.hoisted(() => vi.fn());
const mockImportFromJira = vi.hoisted(() => vi.fn());
const mockTransitionIssue = vi.hoisted(() => vi.fn());
const mockScanAndAttachPRs = vi.hoisted(() => vi.fn());
const mockFetchIssue = vi.hoisted(() => vi.fn());
const mockLoadDetails = vi.hoisted(() => vi.fn());
const mockDeleteCard = vi.hoisted(() => vi.fn());

// Return the same client object on every call to avoid reference churn —
// a new object per call would change `trpc` on every render, which changes
// `fetchBoard` (via useCallback([trpc])), which re-fires the useEffect endlessly.
const mockTrpcClient = {
	jira: {
		loadBoard: { query: mockLoadBoard },
		saveBoard: { mutate: mockSaveBoard },
		importFromJira: { mutate: mockImportFromJira },
		transitionIssue: { mutate: mockTransitionIssue },
		scanAndAttachPRs: { mutate: mockScanAndAttachPRs },
		fetchIssue: { query: mockFetchIssue },
		loadDetails: { query: mockLoadDetails },
		deleteCard: { mutate: mockDeleteCard },
	},
};

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => mockTrpcClient,
}));

function HookHarness({ onSnapshot }: { onSnapshot: (snapshot: UseJiraBoardResult) => void }): null {
	const result = useJiraBoard(null);
	onSnapshot(result);
	return null;
}

/**
 * Flush multiple microtask queue levels so that async effects (like fetchBoard)
 * can complete within a single `await act(async () => { ... })` block.
 * Based on the pattern used in use-git-history-data.test.tsx.
 */
async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe("useJiraBoard", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
		// Default: empty board resolves immediately so no pending async work is left after each test
		mockLoadBoard.mockResolvedValue({ board: { cards: [] }, pullRequests: {} });
		mockSaveBoard.mockResolvedValue({ board: { cards: [] } });
		mockImportFromJira.mockResolvedValue({ imported: 2, skipped: 0, board: { cards: [] } });
		mockTransitionIssue.mockResolvedValue({ ok: true });
		mockScanAndAttachPRs.mockResolvedValue({ attached: 0, skipped: 0, pullRequests: {}, board: { cards: [] } });
		mockFetchIssue.mockResolvedValue({ jiraKey: "POL-1", summary: "Fix", description: null });
		mockLoadDetails.mockResolvedValue({ details: {} });
		mockDeleteCard.mockResolvedValue({ deleted: true, removedPullRequestIds: [] });

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

	it("returns empty board initially", async () => {
		let snapshot: UseJiraBoardResult | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					onSnapshot={(s) => {
						snapshot = s;
					}}
				/>,
			);
			// Capture the initial snapshot before async effects complete
			// snapshot is set synchronously on first render via useEffect
		});

		if (snapshot === null) throw new Error("Expected a hook snapshot");
		// Even after load, the default mock returns empty cards
		const result: UseJiraBoardResult = snapshot;
		expect(result.board.cards).toEqual([]);
	});

	it("exposes moveCard function", async () => {
		let snapshot: UseJiraBoardResult | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					onSnapshot={(s) => {
						snapshot = s;
					}}
				/>,
			);
			await flushPromises();
		});

		if (snapshot === null) throw new Error("Expected a hook snapshot");
		const result: UseJiraBoardResult = snapshot;
		expect(typeof result.moveCard).toBe("function");
	});

	it("populates board state when loadBoard resolves", async () => {
		const testCard = {
			jiraKey: "POL-1",
			summary: "Test issue",
			status: "todo" as const,
			pullRequestIds: [],
			createdAt: 1000,
			updatedAt: 1000,
		};

		// Override default mock to return a real card
		mockLoadBoard.mockResolvedValue({ board: { cards: [testCard] }, pullRequests: {} });
		mockScanAndAttachPRs.mockResolvedValue({
			attached: 0,
			skipped: 0,
			pullRequests: {},
			board: { cards: [testCard] },
		});

		let snapshot: UseJiraBoardResult | null = null;

		// Render and flush all promise microtasks so fetchBoard completes and state is updated
		await act(async () => {
			root.render(
				<HookHarness
					onSnapshot={(s) => {
						snapshot = s;
					}}
				/>,
			);
			await flushPromises();
		});

		if (snapshot === null) throw new Error("Expected a hook snapshot");
		const result: UseJiraBoardResult = snapshot;
		expect(result.board.cards).toContainEqual(expect.objectContaining({ jiraKey: "POL-1", summary: "Test issue" }));
	});

	it("strips Done cards from board on load and cascade-deletes them", async () => {
		const doneCard = {
			jiraKey: "POL-99",
			summary: "Already done",
			status: "done" as const,
			pullRequestIds: [],
			createdAt: 1,
			updatedAt: 1,
		};
		mockLoadBoard.mockResolvedValue({ board: { cards: [doneCard] }, pullRequests: {} });

		let snapshot: UseJiraBoardResult | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					onSnapshot={(s) => {
						snapshot = s;
					}}
				/>,
			);
			await flushPromises();
		});

		if (snapshot === null) throw new Error("Expected a hook snapshot");
		expect(mockDeleteCard).toHaveBeenCalledWith({ jiraKey: "POL-99" });
		expect((snapshot as UseJiraBoardResult).board.cards).toHaveLength(0);
	});

	it("schedules 60 s delete timer when card moved to Done", async () => {
		vi.useFakeTimers();
		const testCard = {
			jiraKey: "POL-1",
			summary: "Test issue",
			status: "todo" as const,
			pullRequestIds: [],
			createdAt: 1000,
			updatedAt: 1000,
		};
		mockLoadBoard.mockResolvedValue({ board: { cards: [testCard] }, pullRequests: {} });
		mockSaveBoard.mockResolvedValue({ board: { cards: [] } });
		mockScanAndAttachPRs.mockResolvedValue({
			attached: 0,
			skipped: 0,
			pullRequests: {},
			board: { cards: [testCard] },
		});

		let snapshot: UseJiraBoardResult | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					onSnapshot={(s) => {
						snapshot = s;
					}}
				/>,
			);
			await flushPromises();
		});

		if (snapshot === null) throw new Error("Expected a hook snapshot");
		const result: UseJiraBoardResult = snapshot;
		mockDeleteCard.mockClear();

		// Move to done
		await act(async () => {
			await result.moveCard("POL-1", "done");
		});

		// Card still in state (timer pending)
		if (snapshot === null) throw new Error("Expected snapshot after moveCard");
		const snapAfterMove: UseJiraBoardResult = snapshot;
		expect(snapAfterMove.board.cards).toHaveLength(1);
		expect(snapAfterMove.board.cards[0]?.status).toBe("done");
		expect(mockDeleteCard).not.toHaveBeenCalled();

		// Advance 60 s and flush the async cascade
		await act(async () => {
			vi.advanceTimersByTime(60_000);
			await flushPromises();
		});

		if (snapshot === null) throw new Error("Expected snapshot after timer");
		const snapAfterTimer: UseJiraBoardResult = snapshot;
		expect(snapAfterTimer.board.cards).toHaveLength(0);
		expect(mockDeleteCard).toHaveBeenCalledWith({ jiraKey: "POL-1" });

		vi.useRealTimers();
	});

	it("deleteCard removes card immediately and cancels pending timer", async () => {
		vi.useFakeTimers();
		const testCard = {
			jiraKey: "POL-2",
			summary: "Another issue",
			status: "todo" as const,
			pullRequestIds: [],
			createdAt: 1000,
			updatedAt: 1000,
		};
		mockLoadBoard.mockResolvedValue({ board: { cards: [testCard] }, pullRequests: {} });
		mockSaveBoard.mockResolvedValue({ board: { cards: [] } });

		let snapshot: UseJiraBoardResult | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					onSnapshot={(s) => {
						snapshot = s;
					}}
				/>,
			);
			await flushPromises();
		});

		if (snapshot === null) throw new Error("Expected a hook snapshot");
		const result: UseJiraBoardResult = snapshot;
		mockDeleteCard.mockClear();

		await act(async () => {
			await result.moveCard("POL-2", "done");
		});

		// Manually delete before timer fires
		await act(async () => {
			result.deleteCard("POL-2");
			await flushPromises();
		});

		if (snapshot === null) throw new Error("Expected snapshot after deleteCard");
		const snapAfterDelete: UseJiraBoardResult = snapshot;
		expect(snapAfterDelete.board.cards).toHaveLength(0);
		expect(mockDeleteCard).toHaveBeenCalledWith({ jiraKey: "POL-2" });
		mockDeleteCard.mockClear();

		// Timer should have been cancelled — advancing shouldn't call deleteCard again
		await act(async () => {
			vi.advanceTimersByTime(60_000);
			await flushPromises();
		});

		expect(mockDeleteCard).not.toHaveBeenCalled();

		vi.useRealTimers();
	});

	it("calls saveBoard with correct payload when moveCard is invoked", async () => {
		const testCard = {
			jiraKey: "POL-1",
			summary: "Test issue",
			status: "todo" as const,
			pullRequestIds: [],
			createdAt: 1000,
			updatedAt: 1000,
		};

		mockLoadBoard.mockResolvedValue({ board: { cards: [testCard] }, pullRequests: {} });
		mockSaveBoard.mockResolvedValue({ board: { cards: [] } });
		mockTransitionIssue.mockResolvedValue({ ok: true });
		mockScanAndAttachPRs.mockResolvedValue({
			attached: 0,
			skipped: 0,
			pullRequests: {},
			board: { cards: [testCard] },
		});

		let snapshot: UseJiraBoardResult | null = null;

		// Render and flush so board state is populated with the test card
		await act(async () => {
			root.render(
				<HookHarness
					onSnapshot={(s) => {
						snapshot = s;
					}}
				/>,
			);
			await flushPromises();
		});

		if (snapshot === null) throw new Error("Expected a hook snapshot");

		await act(async () => {
			await (snapshot as UseJiraBoardResult).moveCard("POL-1", "in_progress");
		});

		expect(mockSaveBoard).toHaveBeenCalledWith(
			expect.objectContaining({
				board: expect.objectContaining({
					cards: expect.arrayContaining([expect.objectContaining({ jiraKey: "POL-1", status: "in_progress" })]),
				}),
			}),
		);
	});

	it("auto-triggers scanPRs once after initial board load", async () => {
		let snapshot: UseJiraBoardResult | undefined;
		await act(async () => {
			root.render(
				React.createElement(HookHarness, {
					onSnapshot: (s) => {
						snapshot = s;
					},
				}),
			);
			await flushPromises();
		});
		expect(mockScanAndAttachPRs).toHaveBeenCalledOnce();
		expect(snapshot?.prScanning).toBe(false); // settled after auto-scan
	});

	it("does not auto-trigger scanPRs more than once across renders", async () => {
		let snapshot: UseJiraBoardResult | undefined;
		// First render + load
		await act(async () => {
			root.render(
				React.createElement(HookHarness, {
					onSnapshot: (s) => {
						snapshot = s;
					},
				}),
			);
			await flushPromises();
		});
		// Trigger a refetch (second board load)
		await act(async () => {
			snapshot?.refetch();
			await flushPromises();
		});
		expect(mockScanAndAttachPRs).toHaveBeenCalledOnce(); // still only once
	});

	it("scanPRs updates pullRequests and clears prScanning", async () => {
		const mergedSubtasks = {
			"sub-1": {
				id: "sub-1",
				jiraKey: "POL-2",
				repoId: "repo-1",
				repoPath: "/repos/a",
				prompt: "fix",
				title: "Fix POL-2",
				baseRef: "main",
				branchName: "POL-2",
				worktreePath: "/wt/POL-2",
				status: "in_progress" as const,
				prUrl: "https://github.com/a/b/pull/2",
				prNumber: 2,
				createdAt: 1,
				updatedAt: 2,
			},
		};
		const scannedBoard = {
			cards: [
				{
					jiraKey: "POL-2",
					summary: "Fix",
					status: "in_progress" as const,
					pullRequestIds: ["sub-1"],
					createdAt: 1,
					updatedAt: 2,
				},
			],
		};
		mockScanAndAttachPRs.mockResolvedValue({
			attached: 1,
			skipped: 0,
			pullRequests: mergedSubtasks,
			board: scannedBoard,
		});
		let snapshot: UseJiraBoardResult | undefined;
		await act(async () => {
			root.render(
				React.createElement(HookHarness, {
					onSnapshot: (s) => {
						snapshot = s;
					},
				}),
			);
			await flushPromises();
		});
		await act(async () => {
			await snapshot?.scanPRs();
			await flushPromises();
		});
		expect(snapshot?.pullRequests).toEqual(mergedSubtasks);
		expect(snapshot?.board).toEqual(scannedBoard);
		expect(snapshot?.prScanning).toBe(false);
	});

	it("scanPRs calls toast.error on failure", async () => {
		const toastErrorSpy = vi.spyOn(toast, "error").mockReturnValue("toast-id" as ReturnType<typeof toast.error>);

		// Auto-scan on mount succeeds; the explicit scanPRs call will fail
		mockScanAndAttachPRs
			.mockResolvedValueOnce({ attached: 0, skipped: 0, pullRequests: {}, board: { cards: [] } }) // auto-scan
			.mockRejectedValueOnce(new Error("scan failed")); // manual scan

		let snapshot: UseJiraBoardResult | undefined;
		await act(async () => {
			root.render(
				React.createElement(HookHarness, {
					onSnapshot: (s) => {
						snapshot = s;
					},
				}),
			);
			await flushPromises();
		});

		await act(async () => {
			await snapshot?.scanPRs();
			await flushPromises();
		});

		expect(toastErrorSpy).toHaveBeenCalledWith("scan failed");
	});
});
