import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UseJiraBoardResult } from "@/hooks/use-jira-board";
import { JiraBoardView } from "./jira-board";

const mockJiraBoard: UseJiraBoardResult = {
	board: {
		cards: [
			{
				jiraKey: "POL-1",
				summary: "Fix login",
				status: "todo",
				pullRequestIds: ["s1"],
				createdAt: 1,
				updatedAt: 1,
			},
			{
				jiraKey: "POL-2",
				summary: "Add dashboard",
				status: "in_progress",
				pullRequestIds: [],
				createdAt: 2,
				updatedAt: 2,
			},
		],
	},
	pullRequests: {
		s1: {
			id: "s1",
			jiraKey: "POL-1",
			repoId: "r",
			repoPath: "/r",
			prompt: "p",
			title: "t",
			baseRef: "main",
			branchName: "b",
			worktreePath: "/w",
			status: "backlog",
			prUrl: "https://github.com/example/repo/pull/1",
			createdAt: 1,
			updatedAt: 1,
		},
	},
	isLoading: false,
	isImporting: false,
	moveCard: vi.fn(),
	deleteCard: vi.fn(),
	details: {},
	refetch: vi.fn(),
	importFromJira: vi.fn().mockResolvedValue(undefined),
	scanPRs: vi.fn().mockResolvedValue(undefined),
	prScanning: false,
	fetchDetail: vi.fn(),
};

describe("JiraBoardView", () => {
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

	it("renders three columns", async () => {
		await act(async () => {
			root.render(<JiraBoardView onCardClick={vi.fn()} selectedJiraKey={null} jiraBoard={mockJiraBoard} />);
		});
		expect(container.textContent).toContain("To-Do");
		expect(container.textContent).toContain("In-Progress");
		expect(container.textContent).toContain("Trash");
	});

	it("shows cards in correct columns", async () => {
		await act(async () => {
			root.render(<JiraBoardView onCardClick={vi.fn()} selectedJiraKey={null} jiraBoard={mockJiraBoard} />);
		});
		expect(container.textContent).toContain("Fix login");
		expect(container.textContent).toContain("Add dashboard");
	});

	it("calls onCardClick when card is clicked", async () => {
		const onCardClick = vi.fn();
		await act(async () => {
			root.render(<JiraBoardView onCardClick={onCardClick} selectedJiraKey={null} jiraBoard={mockJiraBoard} />);
		});

		const cardButton = Array.from(container.querySelectorAll("button")).find((btn) =>
			btn.textContent?.includes("Fix login"),
		);
		expect(cardButton).toBeDefined();

		await act(async () => {
			cardButton?.click();
		});

		expect(onCardClick).toHaveBeenCalledWith("POL-1");
	});

	it("shows syncing statusline when isImporting is true", async () => {
		const importingBoard: UseJiraBoardResult = { ...mockJiraBoard, isImporting: true };
		await act(async () => {
			root.render(<JiraBoardView onCardClick={vi.fn()} selectedJiraKey={null} jiraBoard={importingBoard} />);
		});
		expect(container.textContent).toContain("Syncing JIRA tasks");
	});

	it("shows pull request count chip on card", async () => {
		await act(async () => {
			root.render(<JiraBoardView onCardClick={vi.fn()} selectedJiraKey={null} jiraBoard={mockJiraBoard} />);
		});
		expect(container.textContent).toContain("1 pull request");
	});

	it("renders a column indicator SVG for each column header", async () => {
		await act(async () => {
			root.render(<JiraBoardView onCardClick={vi.fn()} selectedJiraKey={null} jiraBoard={mockJiraBoard} />);
		});
		// Three columns → three SVG indicators in headers
		const svgs = container.querySelectorAll("svg");
		expect(svgs.length).toBeGreaterThanOrEqual(3);
	});

	it("shows delete button on Done cards and calls deleteCard when clicked", async () => {
		const localDeleteCard = vi.fn();
		const doneBoard: UseJiraBoardResult = {
			...mockJiraBoard,
			deleteCard: localDeleteCard,
			board: {
				cards: [
					{
						jiraKey: "POL-9",
						summary: "Done issue",
						status: "done",
						pullRequestIds: [],
						createdAt: 1,
						updatedAt: 1,
					},
				],
			},
		};

		await act(async () => {
			root.render(<JiraBoardView onCardClick={vi.fn()} selectedJiraKey={null} jiraBoard={doneBoard} />);
		});

		const deleteBtn = container.querySelector('[aria-label="Delete card"]');
		expect(deleteBtn).not.toBeNull();

		await act(async () => {
			(deleteBtn as HTMLElement).click();
		});

		expect(localDeleteCard).toHaveBeenCalledWith("POL-9");
	});

	describe("PR pill aggregation color", () => {
		function makeBoardWithPrSubtasks(
			subtaskList: Array<{ id: string; prUrl?: string; prState?: "open" | "draft" | "merged" }>,
		): UseJiraBoardResult {
			const pullRequestIds = subtaskList.map((s) => s.id);
			const subtasksMap = Object.fromEntries(
				subtaskList.map((s) => [
					s.id,
					{
						id: s.id,
						jiraKey: "POL-1",
						repoId: "r",
						repoPath: "/r",
						prompt: "",
						title: "t",
						baseRef: "main",
						branchName: "b",
						worktreePath: "",
						status: "review" as const,
						prUrl: s.prUrl,
						prState: s.prState,
						createdAt: 1,
						updatedAt: 1,
					},
				]),
			);
			return {
				...mockJiraBoard,
				board: {
					cards: [
						{ jiraKey: "POL-1", summary: "Fix", status: "todo", pullRequestIds, createdAt: 1, updatedAt: 1 },
					],
				},
				pullRequests: subtasksMap,
			};
		}

		function getPillClass(): string | null | undefined {
			// The pill is a span whose text content includes "pull request"
			const pill = Array.from(container.querySelectorAll("span")).find((el) =>
				el.textContent?.includes("pull request"),
			);
			return pill?.getAttribute("class");
		}

		it("green pill when all pull requests are open", async () => {
			const board = makeBoardWithPrSubtasks([
				{ id: "s1", prUrl: "https://github.com/a/b/pull/1", prState: "open" },
				{ id: "s2", prUrl: "https://github.com/a/b/pull/2", prState: "open" },
			]);
			await act(async () => {
				root.render(<JiraBoardView onCardClick={vi.fn()} selectedJiraKey={null} jiraBoard={board} />);
			});
			expect(getPillClass()).toContain("text-status-green");
		});

		it("gray pill when all pull requests are draft", async () => {
			const board = makeBoardWithPrSubtasks([
				{ id: "s1", prUrl: "https://github.com/a/b/pull/1", prState: "draft" },
			]);
			await act(async () => {
				root.render(<JiraBoardView onCardClick={vi.fn()} selectedJiraKey={null} jiraBoard={board} />);
			});
			expect(getPillClass()).toContain("text-text-secondary");
		});

		it("purple pill when all pull requests are merged", async () => {
			const board = makeBoardWithPrSubtasks([
				{ id: "s1", prUrl: "https://github.com/a/b/pull/1", prState: "merged" },
				{ id: "s2", prUrl: "https://github.com/a/b/pull/2", prState: "merged" },
			]);
			await act(async () => {
				root.render(<JiraBoardView onCardClick={vi.fn()} selectedJiraKey={null} jiraBoard={board} />);
			});
			expect(getPillClass()).toContain("text-status-purple");
		});

		it("green pill when mixed open + merged (any open wins)", async () => {
			const board = makeBoardWithPrSubtasks([
				{ id: "s1", prUrl: "https://github.com/a/b/pull/1", prState: "merged" },
				{ id: "s2", prUrl: "https://github.com/a/b/pull/2", prState: "open" },
			]);
			await act(async () => {
				root.render(<JiraBoardView onCardClick={vi.fn()} selectedJiraKey={null} jiraBoard={board} />);
			});
			expect(getPillClass()).toContain("text-status-green");
		});

		it("gray pill when mixed draft + merged (no open)", async () => {
			const board = makeBoardWithPrSubtasks([
				{ id: "s1", prUrl: "https://github.com/a/b/pull/1", prState: "draft" },
				{ id: "s2", prUrl: "https://github.com/a/b/pull/2", prState: "merged" },
			]);
			await act(async () => {
				root.render(<JiraBoardView onCardClick={vi.fn()} selectedJiraKey={null} jiraBoard={board} />);
			});
			expect(getPillClass()).toContain("text-text-secondary");
		});

		it("green pill for legacy pull request with prUrl but no prState (defaults to open)", async () => {
			const board = makeBoardWithPrSubtasks([
				{ id: "s1", prUrl: "https://github.com/a/b/pull/1" }, // no prState
			]);
			await act(async () => {
				root.render(<JiraBoardView onCardClick={vi.fn()} selectedJiraKey={null} jiraBoard={board} />);
			});
			expect(getPillClass()).toContain("text-status-green");
		});
	});
});
