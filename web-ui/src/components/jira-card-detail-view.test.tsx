import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JiraBoard, JiraPullRequest } from "@/types/jira";
import { JiraCardDetailView } from "./jira-card-detail-view";

const mockScanPRs = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFetchDetail = vi.hoisted(() => vi.fn());

// PullRequestCreateDialog is not under test here
vi.mock("@/components/pull-request-create-dialog", () => ({
	PullRequestCreateDialog: () => null,
}));

describe("JiraCardDetailView", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
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
					pullRequestIds: ["sub-1"],
					createdAt: 1,
					updatedAt: 1,
				},
			],
		};
		const pullRequests: Record<string, JiraPullRequest> = {
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
				<JiraCardDetailView
					jiraKey="POL-1"
					board={board}
					pullRequests={pullRequests}
					details={{ "POL-1": { jiraKey: "POL-1", summary: "Fix login", description: null } }}
					prScanning={false}
					fetchDetail={mockFetchDetail}
					scanPRs={mockScanPRs}
					onPullRequestCreated={vi.fn()}
					onPullRequestClick={vi.fn()}
				/>,
			);
		});

		expect(container.textContent).toContain("feat: add login fix");
		// PR-backed pull request should show GitPullRequest icon (svg) instead of status text
		const pullRequestButtons = container.querySelectorAll('button[type="button"]');
		const pullRequestButton = Array.from(pullRequestButtons).find((btn) =>
			btn.textContent?.includes("feat: add login fix"),
		);
		expect(pullRequestButton).not.toBeNull();
		// The button should contain an svg (GitPullRequest icon) rather than the raw status text
		expect(pullRequestButton?.querySelector("svg")).not.toBeNull();
	});

	describe("PR icon color by prState", () => {
		function makeBoardAndPullRequest(prState?: "open" | "draft" | "merged"): {
			board: JiraBoard;
			pullRequests: Record<string, JiraPullRequest>;
		} {
			return {
				board: {
					cards: [
						{
							jiraKey: "POL-1",
							summary: "Fix",
							status: "todo",
							pullRequestIds: ["sub-pr"],
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				pullRequests: {
					"sub-pr": {
						id: "sub-pr",
						jiraKey: "POL-1",
						repoId: "repo",
						repoPath: "/repo",
						prompt: "",
						title: "PR subtask",
						baseRef: "main",
						branchName: "pr-branch",
						worktreePath: "",
						status: "review",
						prUrl: "https://github.com/a/b/pull/1",
						prNumber: 1,
						prState,
						createdAt: 1,
						updatedAt: 1,
					},
				},
			};
		}

		function getPrIcon(): Element | null {
			const pullRequestButton = Array.from(container.querySelectorAll('button[type="button"]')).find((btn) =>
				btn.textContent?.includes("PR subtask"),
			);
			return pullRequestButton?.querySelector("svg") ?? null;
		}

		it("applies green color for open PR", async () => {
			const { board, pullRequests } = makeBoardAndPullRequest("open");
			await act(async () => {
				root.render(
					<JiraCardDetailView
						jiraKey="POL-1"
						board={board}
						pullRequests={pullRequests}
						details={{ "POL-1": { jiraKey: "POL-1", summary: "Fix login", description: null } }}
						prScanning={false}
						fetchDetail={mockFetchDetail}
						scanPRs={mockScanPRs}
						onPullRequestCreated={vi.fn()}
						onPullRequestClick={vi.fn()}
					/>,
				);
			});
			const icon = getPrIcon();
			expect(icon).not.toBeNull();
			expect(icon?.getAttribute("class")).toContain("text-status-green");
		});

		it("applies gray color for draft PR", async () => {
			const { board, pullRequests } = makeBoardAndPullRequest("draft");
			await act(async () => {
				root.render(
					<JiraCardDetailView
						jiraKey="POL-1"
						board={board}
						pullRequests={pullRequests}
						details={{ "POL-1": { jiraKey: "POL-1", summary: "Fix login", description: null } }}
						prScanning={false}
						fetchDetail={mockFetchDetail}
						scanPRs={mockScanPRs}
						onPullRequestCreated={vi.fn()}
						onPullRequestClick={vi.fn()}
					/>,
				);
			});
			const icon = getPrIcon();
			expect(icon).not.toBeNull();
			expect(icon?.getAttribute("class")).toContain("text-text-secondary");
		});

		it("applies purple color for merged PR", async () => {
			const { board, pullRequests } = makeBoardAndPullRequest("merged");
			await act(async () => {
				root.render(
					<JiraCardDetailView
						jiraKey="POL-1"
						board={board}
						pullRequests={pullRequests}
						details={{ "POL-1": { jiraKey: "POL-1", summary: "Fix login", description: null } }}
						prScanning={false}
						fetchDetail={mockFetchDetail}
						scanPRs={mockScanPRs}
						onPullRequestCreated={vi.fn()}
						onPullRequestClick={vi.fn()}
					/>,
				);
			});
			const icon = getPrIcon();
			expect(icon).not.toBeNull();
			expect(icon?.getAttribute("class")).toContain("text-status-purple");
		});

		it("defaults to green for legacy pull request with prUrl but no prState (defaults to open)", async () => {
			const { board, pullRequests } = makeBoardAndPullRequest(undefined); // no prState
			await act(async () => {
				root.render(
					<JiraCardDetailView
						jiraKey="POL-1"
						board={board}
						pullRequests={pullRequests}
						details={{ "POL-1": { jiraKey: "POL-1", summary: "Fix login", description: null } }}
						prScanning={false}
						fetchDetail={mockFetchDetail}
						scanPRs={mockScanPRs}
						onPullRequestCreated={vi.fn()}
						onPullRequestClick={vi.fn()}
					/>,
				);
			});
			const icon = getPrIcon();
			expect(icon).not.toBeNull();
			expect(icon?.getAttribute("class")).toContain("text-status-green");
		});
	});

	it("renders PR title and branch name on separate lines (two-line layout)", async () => {
		const board: JiraBoard = {
			cards: [
				{
					jiraKey: "POL-1",
					summary: "Fix login",
					status: "todo",
					pullRequestIds: ["sub-twoline"],
					createdAt: 1,
					updatedAt: 1,
				},
			],
		};
		const pullRequests: Record<string, JiraPullRequest> = {
			"sub-twoline": {
				id: "sub-twoline",
				jiraKey: "POL-1",
				repoId: "org/repo",
				repoPath: "/repo",
				prompt: "",
				title: "feat: my pr title",
				baseRef: "main",
				branchName: "feature/my-branch",
				worktreePath: "",
				status: "review",
				prUrl: "https://github.com/org/repo/pull/99",
				prNumber: 99,
				prState: "open",
				createdAt: 1,
				updatedAt: 1,
			},
		};

		await act(async () => {
			root.render(
				<JiraCardDetailView
					jiraKey="POL-1"
					board={board}
					pullRequests={pullRequests}
					details={{ "POL-1": { jiraKey: "POL-1", summary: "Fix login", description: null } }}
					prScanning={false}
					fetchDetail={mockFetchDetail}
					scanPRs={mockScanPRs}
					onPullRequestCreated={vi.fn()}
					onPullRequestClick={vi.fn()}
				/>,
			);
		});

		// Find the pull request button and the flex-col div wrapping title + branch inside it
		const pullRequestButton = Array.from(container.querySelectorAll('button[type="button"]')).find((btn) =>
			btn.textContent?.includes("feat: my pr title"),
		);
		expect(pullRequestButton).not.toBeNull();
		const flexColDiv = pullRequestButton?.querySelector("div");
		expect(flexColDiv).not.toBeNull();
		const spans = flexColDiv?.querySelectorAll("span");
		expect(spans?.length).toBeGreaterThanOrEqual(2);
		expect(spans?.[0]?.textContent).toContain("feat: my pr title");
		expect(spans?.[1]?.textContent).toContain("feature/my-branch");
	});

	it("renders status text for subtasks without a prUrl", async () => {
		const board: JiraBoard = {
			cards: [
				{
					jiraKey: "POL-1",
					summary: "Fix login",
					status: "todo",
					pullRequestIds: ["sub-2"],
					createdAt: 1,
					updatedAt: 1,
				},
			],
		};
		const pullRequests: Record<string, JiraPullRequest> = {
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
				<JiraCardDetailView
					jiraKey="POL-1"
					board={board}
					pullRequests={pullRequests}
					details={{ "POL-1": { jiraKey: "POL-1", summary: "Fix login", description: null } }}
					prScanning={false}
					fetchDetail={mockFetchDetail}
					scanPRs={mockScanPRs}
					onPullRequestCreated={vi.fn()}
					onPullRequestClick={vi.fn()}
				/>,
			);
		});

		expect(container.textContent).toContain("fix: dashboard crash");
		// Non-PR pull request shows status text, not an icon
		expect(container.textContent).toContain("in_progress");
		const pullRequestButtons = container.querySelectorAll('button[type="button"]');
		const pullRequestButton = Array.from(pullRequestButtons).find((btn) =>
			btn.textContent?.includes("fix: dashboard crash"),
		);
		expect(pullRequestButton).not.toBeNull();
		// No svg icon — status text rendered instead
		expect(pullRequestButton?.querySelector("svg")).toBeNull();
	});
});
