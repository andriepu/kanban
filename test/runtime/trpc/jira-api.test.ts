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
});
