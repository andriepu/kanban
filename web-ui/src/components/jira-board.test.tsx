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
				subtaskIds: ["s1"],
				createdAt: 1,
				updatedAt: 1,
			},
			{
				jiraKey: "POL-2",
				summary: "Add dashboard",
				status: "in_progress",
				subtaskIds: [],
				createdAt: 2,
				updatedAt: 2,
			},
		],
	},
	subtasks: {
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
			createdAt: 1,
			updatedAt: 1,
		},
	},
	isLoading: false,
	isImporting: false,
	importFromJira: vi.fn().mockResolvedValue({ imported: 0, skipped: 0 }),
	moveCard: vi.fn(),
	refetch: vi.fn(),
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
		expect(container.textContent).toContain("Done");
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

	it("shows Import To-Do button", async () => {
		await act(async () => {
			root.render(<JiraBoardView onCardClick={vi.fn()} selectedJiraKey={null} jiraBoard={mockJiraBoard} />);
		});
		const importButton = Array.from(container.querySelectorAll("button")).find((btn) =>
			/import to-do/i.test(btn.textContent ?? ""),
		);
		expect(importButton).toBeDefined();
	});

	it("shows subtask count chip on card", async () => {
		await act(async () => {
			root.render(<JiraBoardView onCardClick={vi.fn()} selectedJiraKey={null} jiraBoard={mockJiraBoard} />);
		});
		expect(container.textContent).toContain("1 subtask");
	});

	it("renders a column indicator SVG for each column header", async () => {
		await act(async () => {
			root.render(<JiraBoardView onCardClick={vi.fn()} selectedJiraKey={null} jiraBoard={mockJiraBoard} />);
		});
		// Three columns → three SVG indicators in headers
		const svgs = container.querySelectorAll("svg");
		expect(svgs.length).toBeGreaterThanOrEqual(3);
	});
});
