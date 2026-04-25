import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JiraBoard, JiraSubtask } from "@/types/jira";
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

const _baseBoard: JiraBoard = {
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

const _baseSubtasks: Record<string, JiraSubtask> = {};

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

	it("renders subtask title when subtask has a prUrl (PR-backed)", async () => {
		const board: JiraBoard = {
			cards: [
				{
					jiraKey: "POL-1",
					summary: "Fix login",
					status: "todo",
					subtaskIds: ["sub-1"],
					createdAt: 1,
					updatedAt: 1,
				},
			],
		};
		const subtasks: Record<string, JiraSubtask> = {
			"sub-1": {
				id: "sub-1",
				jiraKey: "POL-1",
				repoId: "org/repo",
				repoPath: "/path/to/repo",
				prompt: "Fix login",
				title: "feat: add login fix",
				baseRef: "main",
				branchName: "feature/login-fix",
				worktreePath: "/worktrees/sub-1",
				status: "review",
				prUrl: "https://github.com/org/repo/pull/42",
				prNumber: 42,
				createdAt: 1,
				updatedAt: 1,
			},
		};

		await act(async () => {
			root.render(
				<JiraCardDetailView jiraKey="POL-1" board={board} subtasks={subtasks} onSubtaskCreated={vi.fn()} />,
			);
		});

		expect(container.textContent).toContain("feat: add login fix");
		// PR-backed subtask should show GitPullRequest icon (svg) instead of status text
		const subtaskButtons = container.querySelectorAll('button[type="button"]');
		const subtaskButton = Array.from(subtaskButtons).find((btn) => btn.textContent?.includes("feat: add login fix"));
		expect(subtaskButton).not.toBeNull();
		// The button should contain an svg (GitPullRequest icon) rather than the raw status text
		expect(subtaskButton?.querySelector("svg")).not.toBeNull();
	});

	it("renders status text for subtasks without a prUrl", async () => {
		const board: JiraBoard = {
			cards: [
				{
					jiraKey: "POL-1",
					summary: "Fix login",
					status: "todo",
					subtaskIds: ["sub-2"],
					createdAt: 1,
					updatedAt: 1,
				},
			],
		};
		const subtasks: Record<string, JiraSubtask> = {
			"sub-2": {
				id: "sub-2",
				jiraKey: "POL-1",
				repoId: "org/repo",
				repoPath: "/path/to/repo",
				prompt: "Fix dashboard",
				title: "fix: dashboard crash",
				baseRef: "main",
				branchName: "fix/dashboard",
				worktreePath: "/worktrees/sub-2",
				status: "in_progress",
				createdAt: 1,
				updatedAt: 1,
			},
		};

		await act(async () => {
			root.render(
				<JiraCardDetailView jiraKey="POL-1" board={board} subtasks={subtasks} onSubtaskCreated={vi.fn()} />,
			);
		});

		expect(container.textContent).toContain("fix: dashboard crash");
		// Non-PR subtask shows status text, not an icon
		expect(container.textContent).toContain("in_progress");
		const subtaskButtons = container.querySelectorAll('button[type="button"]');
		const subtaskButton = Array.from(subtaskButtons).find((btn) => btn.textContent?.includes("fix: dashboard crash"));
		expect(subtaskButton).not.toBeNull();
		// No svg icon — status text rendered instead
		expect(subtaskButton?.querySelector("svg")).toBeNull();
	});
});
