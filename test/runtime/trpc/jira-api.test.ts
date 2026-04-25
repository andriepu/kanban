import { describe, expect, it, vi } from "vitest";
import { type CreateJiraApiDependencies, createJiraApi } from "../../../src/trpc/jira-api";

const fsMocks = vi.hoisted(() => ({
	access: vi.fn(),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, access: fsMocks.access };
});

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
			prompt: "",
			title: "t",
			baseRef: "main",
			branchName: "POL-1-t",
			worktreePath: "",
			status: "review",
			prUrl: "https://github.com/a/b/pull/1",
			prNumber: 1,
			isDraft: false,
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
		addWorkspace: vi.fn().mockResolvedValue("ws-id"),
		getWorktreesRoot: vi.fn().mockReturnValue("/work"),
		getReposRoot: vi.fn().mockReturnValue("/repos"),
		listOpenAuthoredGhPullRequests: vi.fn().mockResolvedValue([]),
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
		expect(result.subtasks).toBeDefined();
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
					isDraft: false,
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
					isDraft: false,
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({ cards: [] });
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			expect(result.skipped).toBe(1);
			expect(result.attached).toBe(0);
		});

		it("creates new subtask for matched PR that is not yet imported", async () => {
			const deps = createMockDeps();
			(deps.listOpenAuthoredGhPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 3,
					title: "POL-1 fix login",
					url: "https://github.com/a/b/pull/3",
					headRefName: "POL-1-fix-login",
					isDraft: false,
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [
					{ jiraKey: "POL-1", summary: "Fix login", status: "todo", subtaskIds: [], createdAt: 1, updatedAt: 1 },
				],
			});
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			expect(result.attached).toBe(1);
			expect(result.skipped).toBe(0);
			expect(deps.saveJiraBoard).toHaveBeenCalled();
			const savedBoard = (deps.saveJiraBoard as ReturnType<typeof vi.fn>).mock.calls[0][0];
			expect(savedBoard.cards[0].subtaskIds).toHaveLength(1);
		});

		it("sets status to review for non-draft PR", async () => {
			const deps = createMockDeps();
			(deps.listOpenAuthoredGhPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 4,
					title: "POL-1 fix login",
					url: "https://github.com/a/b/pull/4",
					headRefName: "POL-1-fix",
					isDraft: false,
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [{ jiraKey: "POL-1", summary: "Fix", status: "todo", subtaskIds: [], createdAt: 1, updatedAt: 1 }],
			});
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			const newSubtask = Object.values(result.subtasks)[0];
			expect(newSubtask?.status).toBe("review");
			expect(newSubtask?.isDraft).toBe(false);
		});

		it("sets status to in_progress for draft PR", async () => {
			const deps = createMockDeps();
			(deps.listOpenAuthoredGhPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 5,
					title: "POL-1 wip",
					url: "https://github.com/a/b/pull/5",
					headRefName: "POL-1-wip",
					isDraft: true,
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [{ jiraKey: "POL-1", summary: "Fix", status: "todo", subtaskIds: [], createdAt: 1, updatedAt: 1 }],
			});
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			const newSubtask = Object.values(result.subtasks)[0];
			expect(newSubtask?.status).toBe("in_progress");
			expect(newSubtask?.isDraft).toBe(true);
		});

		it("updates draft status of existing PR-backed subtask (draft → ready bumps to review)", async () => {
			const existingSubtask = {
				id: "existing-sub",
				jiraKey: "POL-1",
				repoId: "b",
				repoPath: "",
				prompt: "",
				title: "POL-1 wip",
				baseRef: "main",
				branchName: "POL-1-wip",
				worktreePath: "",
				status: "in_progress" as const,
				prUrl: "https://github.com/a/b/pull/5",
				prNumber: 5,
				isDraft: true,
				createdAt: 1,
				updatedAt: 1,
			};
			const deps = createMockDeps();
			(deps.loadJiraSubtasks as ReturnType<typeof vi.fn>).mockResolvedValue({ "existing-sub": existingSubtask });
			(deps.listOpenAuthoredGhPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 5,
					title: "POL-1 wip",
					url: "https://github.com/a/b/pull/5",
					headRefName: "POL-1-wip",
					isDraft: false,
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [
					{
						jiraKey: "POL-1",
						summary: "Fix",
						status: "todo",
						subtaskIds: ["existing-sub"],
						createdAt: 1,
						updatedAt: 1,
					},
				],
			});
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			expect(result.subtasks["existing-sub"]?.status).toBe("review");
			expect(result.subtasks["existing-sub"]?.isDraft).toBe(false);
			expect(result.attached).toBe(0);
		});

		it("does not update status of done subtask on rescan", async () => {
			const existingSubtask = {
				id: "done-sub",
				jiraKey: "POL-1",
				repoId: "b",
				repoPath: "",
				prompt: "",
				title: "POL-1 done",
				baseRef: "main",
				branchName: "POL-1-done",
				worktreePath: "",
				status: "done" as const,
				prUrl: "https://github.com/a/b/pull/6",
				prNumber: 6,
				isDraft: false,
				createdAt: 1,
				updatedAt: 1,
			};
			const deps = createMockDeps();
			(deps.loadJiraSubtasks as ReturnType<typeof vi.fn>).mockResolvedValue({ "done-sub": existingSubtask });
			(deps.listOpenAuthoredGhPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 6,
					title: "POL-1 done",
					url: "https://github.com/a/b/pull/6",
					headRefName: "POL-1-done",
					isDraft: true,
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [
					{
						jiraKey: "POL-1",
						summary: "Fix",
						status: "todo",
						subtaskIds: ["done-sub"],
						createdAt: 1,
						updatedAt: 1,
					},
				],
			});
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			expect(result.subtasks["done-sub"]?.status).toBe("done");
		});

		it("re-throws gh CLI error with context", async () => {
			const deps = createMockDeps();
			(deps.listOpenAuthoredGhPullRequests as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error("gh CLI not found. Install GitHub CLI (gh) to use PR scan."),
			);
			const api = createJiraApi(deps);
			await expect(api.scanAndAttachPRs()).rejects.toThrow(/Failed to fetch GitHub PRs/i);
		});
	});

	describe("startSubtaskSession", () => {
		it("starts agent session when worktreePath exists on disk", async () => {
			const deps = createMockDeps();
			const subtask = {
				id: "sub-with-tree",
				jiraKey: "POL-1",
				repoId: "repo",
				repoPath: "/repos/repo",
				prompt: "Fix it",
				title: "t",
				baseRef: "main",
				branchName: "POL-1-fix",
				worktreePath: "/worktrees/POL-1-fix",
				status: "in_progress" as const,
				createdAt: 1,
				updatedAt: 1,
			};
			(deps.loadJiraSubtasks as ReturnType<typeof vi.fn>).mockResolvedValue({ "sub-with-tree": subtask });
			(deps.addWorkspace as ReturnType<typeof vi.fn>).mockResolvedValue("ws-id-1");
			(deps.startTaskSession as ReturnType<typeof vi.fn>).mockResolvedValue({ started: true });
			fsMocks.access.mockResolvedValueOnce(undefined);
			const api = createJiraApi(deps);
			const result = await api.startSubtaskSession("sub-with-tree");
			expect(result.started).toBe(true);
			expect(result.workspaceId).toBe("ws-id-1");
			expect(result.openUrl).toBeUndefined();
		});

		it("returns openUrl when subtask has prUrl and no accessible worktreePath", async () => {
			const deps = createMockDeps();
			const subtask = {
				id: "pr-sub",
				jiraKey: "POL-1",
				repoId: "repo",
				repoPath: "",
				prompt: "",
				title: "t",
				baseRef: "main",
				branchName: "POL-1-fix",
				worktreePath: "",
				status: "review" as const,
				prUrl: "https://github.com/a/b/pull/42",
				prNumber: 42,
				isDraft: false,
				createdAt: 1,
				updatedAt: 1,
			};
			(deps.loadJiraSubtasks as ReturnType<typeof vi.fn>).mockResolvedValue({ "pr-sub": subtask });
			const api = createJiraApi(deps);
			const result = await api.startSubtaskSession("pr-sub");
			expect(result.openUrl).toBe("https://github.com/a/b/pull/42");
			expect(result.started).toBe(false);
			expect(result.workspaceId).toBe("");
			expect(deps.startTaskSession).not.toHaveBeenCalled();
		});

		it("throws when subtask has no worktreePath and no prUrl", async () => {
			const deps = createMockDeps();
			const subtask = {
				id: "no-tree-no-pr",
				jiraKey: "POL-1",
				repoId: "repo",
				repoPath: "",
				prompt: "",
				title: "t",
				baseRef: "main",
				branchName: "POL-1-fix",
				worktreePath: "",
				status: "backlog" as const,
				createdAt: 1,
				updatedAt: 1,
			};
			(deps.loadJiraSubtasks as ReturnType<typeof vi.fn>).mockResolvedValue({ "no-tree-no-pr": subtask });
			const api = createJiraApi(deps);
			await expect(api.startSubtaskSession("no-tree-no-pr")).rejects.toThrow(/no worktree path and no PR URL/i);
		});
	});
});
