import { describe, expect, it, vi } from "vitest";
import { type CreateJiraApiDependencies, createJiraApi } from "../../../src/trpc/jira-api";

function createMockDeps(): CreateJiraApiDependencies {
	return {
		loadJiraBoard: vi.fn().mockResolvedValue({ cards: [] }),
		saveJiraBoard: vi.fn().mockResolvedValue(undefined),
		loadJiraSubtasks: vi.fn().mockResolvedValue({}),
		createJiraSubtask: vi.fn().mockResolvedValue({
			id: "sub-1",
			jiraKey: "POL-1",
			repoId: "repo",
			repoPath: "/repo",
			prompt: "p",
			title: "t",
			baseRef: "main",
			branchName: "POL-1-t",
			worktreePath: "/w",
			status: "backlog",
			createdAt: 1,
			updatedAt: 1,
		}),
		deleteJiraSubtask: vi.fn().mockResolvedValue(undefined),
		searchJiraIssues: vi.fn().mockResolvedValue([]),
		fetchIssue: vi.fn().mockResolvedValue({ key: "POL-1", summary: "Summary", description: null }),
		transitionIssue: vi.fn().mockResolvedValue(undefined),
		setApiToken: vi.fn().mockResolvedValue(undefined),
		scanRepos: vi.fn().mockResolvedValue([{ id: "my-repo", path: "/repos/my-repo" }]),
		createSubtaskWorktree: vi.fn().mockResolvedValue(undefined),
		removeSubtaskWorktree: vi.fn().mockResolvedValue(undefined),
		startTaskSession: vi.fn().mockResolvedValue({ started: true }),
		stopTaskSession: vi.fn().mockResolvedValue({ stopped: true }),
		addWorkspace: vi.fn().mockResolvedValue(undefined),
		getWorktreesRoot: vi.fn().mockReturnValue("/work"),
		getReposRoot: vi.fn().mockReturnValue("/repos"),
		listOpenAuthoredGhPullRequests: vi.fn().mockResolvedValue([]),
		loadJiraPrLinks: vi.fn().mockResolvedValue({}),
		saveJiraPrLinks: vi.fn().mockResolvedValue(undefined),
		mergeScannedPrLinks: vi.fn().mockReturnValue({}),
		getJiraProjectKey: vi.fn().mockReturnValue("POL"),
	};
}

describe("jira-api", () => {
	it("loadBoard returns board and subtasks", async () => {
		const deps = createMockDeps();
		(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
			cards: [
				{
					jiraKey: "POL-1",
					summary: "Fix",
					status: "todo",
					subtaskIds: [],
					createdAt: 1,
					updatedAt: 1,
				},
			],
		});
		const api = createJiraApi(deps);
		const result = await api.loadBoard();
		expect(result.board.cards[0]?.jiraKey).toBe("POL-1");
		expect(result.prLinks).toBeDefined();
	});

	it("loadBoard includes prLinks", async () => {
		const deps = createMockDeps();
		const mockPrLinks = { "POL-1": [] };
		(deps.loadJiraPrLinks as ReturnType<typeof vi.fn>).mockResolvedValue(mockPrLinks);
		const api = createJiraApi(deps);
		const result = await api.loadBoard();
		expect(result.prLinks).toEqual(mockPrLinks);
		expect(deps.loadJiraPrLinks).toHaveBeenCalledOnce();
	});

	it("scanRepos returns repo list", async () => {
		const deps = createMockDeps();
		const api = createJiraApi(deps);
		const result = await api.scanRepos();
		expect(result.repos).toEqual([{ id: "my-repo", path: "/repos/my-repo" }]);
	});

	it("createSubtask derives worktreePath and creates worktree", async () => {
		const deps = createMockDeps();
		const api = createJiraApi(deps);
		await api.createSubtask({
			jiraKey: "POL-1",
			repoId: "my-repo",
			repoPath: "/repos/my-repo",
			prompt: "Fix login",
			title: "Fix Login Bug",
			baseRef: "main",
			branchName: "POL-1-fix-login-bug",
		});
		expect(deps.createSubtaskWorktree).toHaveBeenCalledWith(
			expect.objectContaining({ repoPath: "/repos/my-repo", branchName: "POL-1-fix-login-bug" }),
		);
		expect(deps.createJiraSubtask).toHaveBeenCalled();
	});

	it("importFromJira maps Todo status to todo column", async () => {
		const deps = createMockDeps();
		(deps.searchJiraIssues as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ key: "POL-1", summary: "Fix bug", status: "Todo" },
		]);
		const api = createJiraApi(deps);
		const result = await api.importFromJira(`assignee = currentUser() ORDER BY updated DESC`);
		expect(result.imported).toBe(1);
		expect(result.board.cards[0]?.status).toBe("todo");
	});

	it("importFromJira maps In-Progress status to in_progress column", async () => {
		const deps = createMockDeps();
		(deps.searchJiraIssues as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ key: "POL-2", summary: "In flight", status: "In-Progress" },
		]);
		const api = createJiraApi(deps);
		const result = await api.importFromJira(`assignee = currentUser() ORDER BY updated DESC`);
		expect(result.board.cards[0]?.status).toBe("in_progress");
	});

	it("importFromJira skips new issues whose Jira status maps to done (Ready to Deploy)", async () => {
		const deps = createMockDeps();
		(deps.searchJiraIssues as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ key: "POL-3", summary: "Ready", status: "Ready to Deploy" },
		]);
		const api = createJiraApi(deps);
		const result = await api.importFromJira(`assignee = currentUser() ORDER BY updated DESC`);
		expect(result.imported).toBe(0);
		expect(result.board.cards).toHaveLength(0);
	});

	it("importFromJira skips new issues with unmapped status", async () => {
		const deps = createMockDeps();
		(deps.searchJiraIssues as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ key: "POL-4", summary: "Closed issue", status: "Closed" },
		]);
		const api = createJiraApi(deps);
		const result = await api.importFromJira(`assignee = currentUser() ORDER BY updated DESC`);
		expect(result.imported).toBe(0);
		expect(result.board.cards).toHaveLength(0);
	});

	it("importFromJira updates status of existing card", async () => {
		const deps = createMockDeps();
		(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
			cards: [{ jiraKey: "POL-1", summary: "Fix bug", status: "todo", subtaskIds: [], createdAt: 1, updatedAt: 1 }],
		});
		(deps.searchJiraIssues as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ key: "POL-1", summary: "Fix bug", status: "In-Progress" },
		]);
		const api = createJiraApi(deps);
		const result = await api.importFromJira(`assignee = currentUser() ORDER BY updated DESC`);
		expect(result.board.cards[0]?.status).toBe("in_progress");
	});

	it("importFromJira removes existing card with unmapped status", async () => {
		const deps = createMockDeps();
		(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
			cards: [{ jiraKey: "POL-1", summary: "Fix bug", status: "todo", subtaskIds: [], createdAt: 1, updatedAt: 1 }],
		});
		(deps.searchJiraIssues as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ key: "POL-1", summary: "Fix bug", status: "Closed" },
		]);
		const api = createJiraApi(deps);
		const result = await api.importFromJira(`assignee = currentUser() ORDER BY updated DESC`);
		expect(result.board.cards).toHaveLength(0);
	});

	it("importFromJira leaves existing card untouched when not returned by Jira", async () => {
		const deps = createMockDeps();
		(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
			cards: [{ jiraKey: "POL-5", summary: "Old card", status: "done", subtaskIds: [], createdAt: 1, updatedAt: 1 }],
		});
		(deps.searchJiraIssues as ReturnType<typeof vi.fn>).mockResolvedValue([]);
		const api = createJiraApi(deps);
		const result = await api.importFromJira(`assignee = currentUser() ORDER BY updated DESC`);
		expect(result.board.cards).toHaveLength(1);
		expect(result.board.cards[0]?.jiraKey).toBe("POL-5");
	});

	it("importFromJira skips new issues whose Jira status maps to done", async () => {
		const deps = createMockDeps();
		(deps.searchJiraIssues as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ key: "POL-10", summary: "Finished", status: "Done" },
		]);
		const api = createJiraApi(deps);
		const result = await api.importFromJira(`assignee = currentUser() ORDER BY updated DESC`);
		expect(result.imported).toBe(0);
		expect(result.board.cards).toHaveLength(0);
	});

	it("importFromJira removes existing card whose Jira status syncs to done", async () => {
		const deps = createMockDeps();
		(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
			cards: [
				{
					jiraKey: "POL-11",
					summary: "Was active",
					status: "in_progress",
					subtaskIds: [],
					createdAt: 1,
					updatedAt: 1,
				},
			],
		});
		(deps.searchJiraIssues as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ key: "POL-11", summary: "Was active", status: "Done" },
		]);
		const api = createJiraApi(deps);
		const result = await api.importFromJira(`assignee = currentUser() ORDER BY updated DESC`);
		expect(result.board.cards).toHaveLength(0);
	});

	describe("scanAndAttachPRs", () => {
		it("throws when jiraProjectKey is not configured", async () => {
			const deps = createMockDeps();
			(deps.getJiraProjectKey as ReturnType<typeof vi.fn>).mockReturnValue(null);
			const api = createJiraApi(deps);
			await expect(api.scanAndAttachPRs()).rejects.toThrow(/project key not configured/i);
		});

		it("skips PRs with no matching jira key in title", async () => {
			const deps = createMockDeps();
			(deps.listOpenAuthoredGhPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 1,
					title: "Add dark mode",
					url: "https://github.com/a/b/pull/1",
					headRefName: "feature/dark-mode",
					repository: { nameWithOwner: "a/b" },
				},
			]);
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			expect(result.skipped).toBe(1);
			expect(result.attached).toBe(0);
		});

		it("skips PRs whose jira key is not on board", async () => {
			const deps = createMockDeps();
			(deps.listOpenAuthoredGhPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 2,
					title: "POL-999 fix something",
					url: "https://github.com/a/b/pull/2",
					headRefName: "POL-999-fix",
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({ cards: [] });
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			expect(result.skipped).toBe(1);
			expect(result.attached).toBe(0);
		});

		it("attaches matched PR and saves links", async () => {
			const deps = createMockDeps();
			(deps.listOpenAuthoredGhPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 3,
					title: "POL-1 fix login",
					url: "https://github.com/a/b/pull/3",
					headRefName: "POL-1-fix-login",
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [
					{ jiraKey: "POL-1", summary: "Fix login", status: "todo", subtaskIds: [], createdAt: 1, updatedAt: 1 },
				],
			});
			const mergedLinks = {
				"POL-1": [
					{
						id: "l-1",
						jiraKey: "POL-1",
						prUrl: "https://github.com/a/b/pull/3",
						prNumber: 3,
						title: "POL-1 fix login",
						repoName: "a/b",
						headRefName: "POL-1-fix-login",
						addedAt: 1,
					},
				],
			};
			(deps.mergeScannedPrLinks as ReturnType<typeof vi.fn>).mockReturnValue(mergedLinks);
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			expect(result.attached).toBe(1);
			expect(result.skipped).toBe(0);
			expect(deps.saveJiraPrLinks).toHaveBeenCalledWith(mergedLinks);
			expect(result.prLinks["POL-1"]).toHaveLength(1);
		});

		it("re-throws gh CLI error with context", async () => {
			const deps = createMockDeps();
			(deps.listOpenAuthoredGhPullRequests as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error("gh CLI not found. Install GitHub CLI (gh) to use PR scan."),
			);
			const api = createJiraApi(deps);
			await expect(api.scanAndAttachPRs()).rejects.toThrow(/Failed to fetch GitHub PRs/);
		});

		it("counts only newly attached PRs (excludes already-linked)", async () => {
			const deps = createMockDeps();
			const prUrl = "https://github.com/a/b/pull/5";
			(deps.listOpenAuthoredGhPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 5,
					title: "POL-1 something",
					url: prUrl,
					headRefName: "POL-1-something",
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [{ jiraKey: "POL-1", summary: "S", status: "todo", subtaskIds: [], createdAt: 1, updatedAt: 1 }],
			});
			// Simulate PR already in existing links
			(deps.loadJiraPrLinks as ReturnType<typeof vi.fn>).mockResolvedValue({
				"POL-1": [
					{
						id: "l-old",
						jiraKey: "POL-1",
						prUrl,
						prNumber: 5,
						title: "POL-1 something",
						repoName: "a/b",
						headRefName: "POL-1-something",
						addedAt: 1,
					},
				],
			});
			(deps.mergeScannedPrLinks as ReturnType<typeof vi.fn>).mockReturnValue({
				"POL-1": [
					{
						id: "l-old",
						jiraKey: "POL-1",
						prUrl,
						prNumber: 5,
						title: "POL-1 something",
						repoName: "a/b",
						headRefName: "POL-1-something",
						addedAt: 1,
					},
				],
			});
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			expect(result.attached).toBe(0); // already linked, not new
		});
	});
});
