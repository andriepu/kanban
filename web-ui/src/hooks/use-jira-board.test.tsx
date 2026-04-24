import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type UseJiraBoardResult, useJiraBoard } from "./use-jira-board";

const mockLoadBoard = vi.hoisted(() => vi.fn());
const mockSaveBoard = vi.hoisted(() => vi.fn());
const mockImportFromJira = vi.hoisted(() => vi.fn());
const mockTransitionIssue = vi.hoisted(() => vi.fn());

// Return the same client object on every call to avoid reference churn —
// a new object per call would change `trpc` on every render, which changes
// `fetchBoard` (via useCallback([trpc])), which re-fires the useEffect endlessly.
const mockTrpcClient = {
	jira: {
		loadBoard: { query: mockLoadBoard },
		saveBoard: { mutate: mockSaveBoard },
		importFromJira: { mutate: mockImportFromJira },
		transitionIssue: { mutate: mockTransitionIssue },
	},
};

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
		mockLoadBoard.mockResolvedValue({ board: { cards: [] }, subtasks: {} });
		mockSaveBoard.mockResolvedValue({ board: { cards: [] } });
		mockImportFromJira.mockResolvedValue({ imported: 2, skipped: 0, board: { cards: [] } });
		mockTransitionIssue.mockResolvedValue({ ok: true });

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
			subtaskIds: [],
			createdAt: 1000,
			updatedAt: 1000,
		};

		// Override default mock to return a real card
		mockLoadBoard.mockResolvedValue({ board: { cards: [testCard] }, subtasks: {} });

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

	it("strips Done cards from board on load and calls saveBoard to clean up", async () => {
		const doneCard = {
			jiraKey: "POL-99",
			summary: "Already done",
			status: "done" as const,
			subtaskIds: [],
			createdAt: 1,
			updatedAt: 1,
		};
		mockLoadBoard.mockResolvedValue({ board: { cards: [doneCard] }, subtasks: {} });

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
		expect(result.board.cards).toHaveLength(0);
		expect(mockSaveBoard).toHaveBeenCalledWith(
			expect.objectContaining({ board: expect.objectContaining({ cards: [] }) }),
		);
	});

	it("schedules 60 s delete timer when card moved to Done", async () => {
		vi.useFakeTimers();
		const testCard = {
			jiraKey: "POL-1",
			summary: "Test issue",
			status: "todo" as const,
			subtaskIds: [],
			createdAt: 1000,
			updatedAt: 1000,
		};
		mockLoadBoard.mockResolvedValue({ board: { cards: [testCard] }, subtasks: {} });
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
		mockSaveBoard.mockClear();

		// Move to done
		await act(async () => {
			await result.moveCard("POL-1", "done");
		});

		// Card still in state (timer pending)
		if (snapshot === null) throw new Error("Expected snapshot after moveCard");
		const snapAfterMove: UseJiraBoardResult = snapshot;
		expect(snapAfterMove.board.cards).toHaveLength(1);
		expect(snapAfterMove.board.cards[0]?.status).toBe("done");
		expect(mockSaveBoard).not.toHaveBeenCalledWith(
			expect.objectContaining({ board: expect.objectContaining({ cards: [] }) }),
		);

		// Advance 60 s
		await act(async () => {
			vi.advanceTimersByTime(60_000);
		});

		if (snapshot === null) throw new Error("Expected snapshot after timer");
		const snapAfterTimer: UseJiraBoardResult = snapshot;
		expect(snapAfterTimer.board.cards).toHaveLength(0);
		expect(mockSaveBoard).toHaveBeenCalledWith(
			expect.objectContaining({ board: expect.objectContaining({ cards: [] }) }),
		);

		vi.useRealTimers();
	});

	it("deleteCard removes card immediately and cancels pending timer", async () => {
		vi.useFakeTimers();
		const testCard = {
			jiraKey: "POL-2",
			summary: "Another issue",
			status: "todo" as const,
			subtaskIds: [],
			createdAt: 1000,
			updatedAt: 1000,
		};
		mockLoadBoard.mockResolvedValue({ board: { cards: [testCard] }, subtasks: {} });
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
		mockSaveBoard.mockClear();

		await act(async () => {
			await result.moveCard("POL-2", "done");
		});

		// Manually delete before timer fires
		await act(async () => {
			result.deleteCard("POL-2");
		});

		if (snapshot === null) throw new Error("Expected snapshot after deleteCard");
		const snapAfterDelete: UseJiraBoardResult = snapshot;
		expect(snapAfterDelete.board.cards).toHaveLength(0);
		expect(mockSaveBoard).toHaveBeenCalled();
		mockSaveBoard.mockClear();

		// Timer should have been cancelled — advancing shouldn't call saveBoard again
		await act(async () => {
			vi.advanceTimersByTime(60_000);
		});

		expect(mockSaveBoard).not.toHaveBeenCalled();

		vi.useRealTimers();
	});

	it("calls saveBoard with correct payload when moveCard is invoked", async () => {
		const testCard = {
			jiraKey: "POL-1",
			summary: "Test issue",
			status: "todo" as const,
			subtaskIds: [],
			createdAt: 1000,
			updatedAt: 1000,
		};

		mockLoadBoard.mockResolvedValue({ board: { cards: [testCard] }, subtasks: {} });
		mockSaveBoard.mockResolvedValue({ board: { cards: [] } });
		mockTransitionIssue.mockResolvedValue({ ok: true });

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
});
