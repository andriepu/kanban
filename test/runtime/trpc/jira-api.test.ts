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
		callJiraMcp: vi.fn().mockResolvedValue({}),
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
});
