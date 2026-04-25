import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JiraBoard, JiraPrLink, JiraSubtask } from "@/types/jira";
import { JiraCardDetailView } from "./jira-card-detail-view";

const mockFetchIssue = vi.hoisted(() => vi.fn());
const mockStartSubtaskSession = vi.hoisted(() => vi.fn());

const mockTrpcClient = {
	jira: {
		fetchIssue: { query: mockFetchIssue },
		startSubtaskSession: { mutate: mockStartSubtaskSession },
	},
};

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => mockTrpcClient,
}));

// AgentTerminalPanel requires heavy terminal setup — stub it out
vi.mock("@/components/detail-panels/agent-terminal-panel", () => ({
	AgentTerminalPanel: () => null,
}));

// SubtaskCreateDialog is not under test here
vi.mock("@/components/subtask-create-dialog", () => ({
	SubtaskCreateDialog: () => null,
}));

const baseBoard: JiraBoard = {
	cards: [
		{
			jiraKey: "POL-1",
			summary: "Fix login",
			status: "todo",
			subtaskIds: [],
			createdAt: 1,
			updatedAt: 1,
		},
	],
};

const baseSubtasks: Record<string, JiraSubtask> = {};

describe("JiraCardDetailView", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
		// Prevent unhandled promise rejections — fetchIssue resolves immediately
		mockFetchIssue.mockResolvedValue({ jiraKey: "POL-1", summary: "Fix login", description: null });

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

	it("renders PR list when prLinks has entries for the card key", async () => {
		const prLinks: Record<string, JiraPrLink[]> = {
			"POL-1": [
				{
					id: "pr-1",
					jiraKey: "POL-1",
					prUrl: "https://github.com/org/repo/pull/42",
					prNumber: 42,
					title: "feat: add login fix",
					repoName: "org/repo",
					headRefName: "feature/login-fix",
					addedAt: 1,
				},
			],
		};

		await act(async () => {
			root.render(
				<JiraCardDetailView
					jiraKey="POL-1"
					board={baseBoard}
					subtasks={baseSubtasks}
					prLinks={prLinks}
					onSubtaskCreated={vi.fn()}
				/>,
			);
		});

		expect(container.textContent).toContain("feat: add login fix");
		const prButton = container.querySelector('[aria-label="Open PR: feat: add login fix"]');
		expect(prButton).not.toBeNull();
	});

	it("clicking a PR row opens the URL in a new tab", async () => {
		const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

		const prLinks: Record<string, JiraPrLink[]> = {
			"POL-1": [
				{
					id: "pr-2",
					jiraKey: "POL-1",
					prUrl: "https://github.com/org/repo/pull/99",
					prNumber: 99,
					title: "fix: dashboard crash",
					repoName: "org/repo",
					headRefName: "fix/dashboard",
					addedAt: 1,
				},
			],
		};

		await act(async () => {
			root.render(
				<JiraCardDetailView
					jiraKey="POL-1"
					board={baseBoard}
					subtasks={baseSubtasks}
					prLinks={prLinks}
					onSubtaskCreated={vi.fn()}
				/>,
			);
		});

		const prButton = container.querySelector('[aria-label="Open PR: fix: dashboard crash"]') as HTMLElement | null;
		expect(prButton).not.toBeNull();

		await act(async () => {
			prButton?.click();
		});

		expect(openSpy).toHaveBeenCalledWith("https://github.com/org/repo/pull/99", "_blank", "noopener,noreferrer");

		openSpy.mockRestore();
	});
});
