import { describe, expect, it, vi } from "vitest";
import { jiraPullRequestSchema } from "../../../src/core/api-contract";
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
		loadJiraPullRequests: vi.fn().mockResolvedValue({}),
		loadJiraDetails: vi.fn().mockResolvedValue({}),
		saveJiraDetail: vi.fn().mockResolvedValue(undefined),
		createJiraPullRequest: vi.fn().mockResolvedValue({
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
			prState: "open",
			createdAt: 1,
			updatedAt: 1,
		}),
		deleteJiraPullRequest: vi.fn().mockResolvedValue(undefined),
		searchJiraIssues: vi.fn().mockResolvedValue([]),
		fetchIssue: vi.fn().mockResolvedValue({ key: "POL-1", summary: "Summary", description: null }),
		transitionIssue: vi.fn().mockResolvedValue(undefined),
		setApiToken: vi.fn().mockResolvedValue(undefined),
		scanRepos: vi.fn().mockResolvedValue([{ id: "my-repo", path: "/repos/my-repo" }]),
		createPullRequestWorktree: vi.fn().mockResolvedValue(undefined),
		removePullRequestWorktree: vi.fn().mockResolvedValue(undefined),
		startTaskSession: vi.fn().mockResolvedValue({ started: true }),
		stopTaskSession: vi.fn().mockResolvedValue({ stopped: true }),
		addWorkspace: vi.fn().mockResolvedValue("ws-id"),
		getWorktreesRoot: vi.fn().mockReturnValue("/work"),
		getReposRoot: vi.fn().mockReturnValue("/repos"),
		listAuthoredGhPullRequestsForProject: vi.fn().mockResolvedValue([]),
		fetchGhPullRequestDetail: vi.fn().mockResolvedValue({ body: "", reviewThreads: [] }),
		getJiraProjectKey: vi.fn().mockReturnValue("POL"),
		broadcastRuntimeReposUpdated: vi.fn(),
	};
}

describe("jira-api", () => {
	it("loadBoard returns board and pullRequests", async () => {
		const deps = createMockDeps();
		(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
			cards: [
				{
					jiraKey: "POL-1",
					summary: "Fix",
					status: "todo",
					pullRequestIds: [],
					createdAt: 1,
					updatedAt: 1,
				},
			],
		});
		const api = createJiraApi(deps);
		const result = await api.loadBoard();
		expect(result.board.cards[0]?.jiraKey).toBe("POL-1");
		expect(result.pullRequests).toBeDefined();
	});

	it("scanRepos returns repo list", async () => {
		const deps = createMockDeps();
		const api = createJiraApi(deps);
		const result = await api.scanRepos();
		expect(result.repos).toEqual([{ id: "my-repo", path: "/repos/my-repo" }]);
	});

	it("createPullRequest derives worktreePath and creates worktree", async () => {
		const deps = createMockDeps();
		const api = createJiraApi(deps);
		await api.createPullRequest({
			jiraKey: "POL-1",
			repoId: "my-repo",
			repoPath: "/repos/my-repo",
			prompt: "Fix login",
			title: "Fix Login Bug",
			baseRef: "main",
			branchName: "POL-1-fix-login-bug",
		});
		expect(deps.createPullRequestWorktree).toHaveBeenCalledWith(
			expect.objectContaining({ repoPath: "/repos/my-repo", branchName: "POL-1-fix-login-bug" }),
		);
		expect(deps.createJiraPullRequest).toHaveBeenCalled();
	});

	it("createPullRequest broadcasts runtime repos updated", async () => {
		const deps = createMockDeps();
		const api = createJiraApi(deps);
		await api.createPullRequest({
			jiraKey: "POL-1",
			repoId: "my-repo",
			repoPath: "/repos/my-repo",
			prompt: "Fix login",
			title: "Fix Login Bug",
			baseRef: "main",
			branchName: "POL-1-fix-login-bug",
		});
		expect(deps.broadcastRuntimeReposUpdated).toHaveBeenCalledTimes(1);
	});

	it("deletePullRequest broadcasts runtime repos updated", async () => {
		const deps = createMockDeps();
		(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({
			"sub-1": {
				id: "sub-1",
				jiraKey: "POL-1",
				repoId: "my-repo",
				repoPath: "/repos/my-repo",
				worktreePath: "/work/POL-1",
				status: "backlog",
				prompt: "",
				title: "t",
				baseRef: "main",
				branchName: "POL-1-t",
				createdAt: 1,
				updatedAt: 1,
			},
		});
		const api = createJiraApi(deps);
		await api.deletePullRequest("sub-1");
		expect(deps.broadcastRuntimeReposUpdated).toHaveBeenCalledTimes(1);
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
			cards: [
				{ jiraKey: "POL-1", summary: "Fix bug", status: "todo", pullRequestIds: [], createdAt: 1, updatedAt: 1 },
			],
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
			cards: [
				{ jiraKey: "POL-1", summary: "Fix bug", status: "todo", pullRequestIds: [], createdAt: 1, updatedAt: 1 },
			],
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
			cards: [
				{ jiraKey: "POL-5", summary: "Old card", status: "done", pullRequestIds: [], createdAt: 1, updatedAt: 1 },
			],
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
					pullRequestIds: [],
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
			(deps.listAuthoredGhPullRequestsForProject as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 1,
					title: "Add dark mode",
					url: "https://github.com/a/b/pull/1",
					headRefName: "feature/dark-mode",
					isDraft: false,
					state: "OPEN" as const,
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
			(deps.listAuthoredGhPullRequestsForProject as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 2,
					title: "POL-999 fix something",
					url: "https://github.com/a/b/pull/2",
					headRefName: "POL-999-fix",
					isDraft: false,
					state: "OPEN" as const,
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({ cards: [] });
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			expect(result.skipped).toBe(1);
			expect(result.attached).toBe(0);
		});

		it("creates new pullRequest for matched PR that is not yet imported", async () => {
			const deps = createMockDeps();
			(deps.listAuthoredGhPullRequestsForProject as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 3,
					title: "POL-1 fix login",
					url: "https://github.com/a/b/pull/3",
					headRefName: "POL-1-fix-login",
					isDraft: false,
					state: "OPEN" as const,
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [
					{
						jiraKey: "POL-1",
						summary: "Fix login",
						status: "todo",
						pullRequestIds: [],
						createdAt: 1,
						updatedAt: 1,
					},
				],
			});
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			expect(result.attached).toBe(1);
			expect(result.skipped).toBe(0);
			expect(deps.saveJiraBoard).toHaveBeenCalled();
			const savedBoard = (deps.saveJiraBoard as ReturnType<typeof vi.fn>).mock.calls[0][0];
			expect(savedBoard.cards[0].pullRequestIds).toHaveLength(1);
			expect(result.board.cards[0]?.pullRequestIds).toHaveLength(1);
		});

		it("sets status to review for non-draft PR", async () => {
			const deps = createMockDeps();
			(deps.listAuthoredGhPullRequestsForProject as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 4,
					title: "POL-1 fix login",
					url: "https://github.com/a/b/pull/4",
					headRefName: "POL-1-fix",
					isDraft: false,
					state: "OPEN" as const,
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [
					{ jiraKey: "POL-1", summary: "Fix", status: "todo", pullRequestIds: [], createdAt: 1, updatedAt: 1 },
				],
			});
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			const newPullRequest = Object.values(result.pullRequests)[0];
			expect(newPullRequest?.status).toBe("review");
			expect(newPullRequest?.prState).toBe("open");
		});

		it("sets status to in_progress for draft PR", async () => {
			const deps = createMockDeps();
			(deps.listAuthoredGhPullRequestsForProject as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 5,
					title: "POL-1 wip",
					url: "https://github.com/a/b/pull/5",
					headRefName: "POL-1-wip",
					isDraft: true,
					state: "OPEN" as const,
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [
					{ jiraKey: "POL-1", summary: "Fix", status: "todo", pullRequestIds: [], createdAt: 1, updatedAt: 1 },
				],
			});
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			const newPullRequest = Object.values(result.pullRequests)[0];
			expect(newPullRequest?.status).toBe("in_progress");
			expect(newPullRequest?.prState).toBe("draft");
		});

		it("updates draft status of existing PR-backed pullRequest (draft → ready bumps to review)", async () => {
			const existingPullRequest = {
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
				prState: "draft" as const,
				createdAt: 1,
				updatedAt: 1,
			};
			const deps = createMockDeps();
			(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({
				"existing-sub": existingPullRequest,
			});
			(deps.listAuthoredGhPullRequestsForProject as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 5,
					title: "POL-1 wip",
					url: "https://github.com/a/b/pull/5",
					headRefName: "POL-1-wip",
					isDraft: false,
					state: "OPEN" as const,
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [
					{
						jiraKey: "POL-1",
						summary: "Fix",
						status: "todo",
						pullRequestIds: ["existing-sub"],
						createdAt: 1,
						updatedAt: 1,
					},
				],
			});
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			expect(result.pullRequests["existing-sub"]?.status).toBe("review");
			expect(result.pullRequests["existing-sub"]?.prState).toBe("open");
			expect(result.attached).toBe(0);
		});

		it("does not update status of done pullRequest on rescan", async () => {
			const existingPullRequest = {
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
				prState: "open" as const,
				createdAt: 1,
				updatedAt: 1,
			};
			const deps = createMockDeps();
			(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({ "done-sub": existingPullRequest });
			(deps.listAuthoredGhPullRequestsForProject as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 6,
					title: "POL-1 done",
					url: "https://github.com/a/b/pull/6",
					headRefName: "POL-1-done",
					isDraft: true,
					state: "OPEN" as const,
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [
					{
						jiraKey: "POL-1",
						summary: "Fix",
						status: "todo",
						pullRequestIds: ["done-sub"],
						createdAt: 1,
						updatedAt: 1,
					},
				],
			});
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			expect(result.pullRequests["done-sub"]?.status).toBe("done");
		});

		it("sets prState to merged when PR state is MERGED", async () => {
			const deps = createMockDeps();
			(deps.listAuthoredGhPullRequestsForProject as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 10,
					title: "POL-1 merged feature",
					url: "https://github.com/a/b/pull/10",
					headRefName: "POL-1-feature",
					isDraft: false,
					state: "MERGED" as const,
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [
					{ jiraKey: "POL-1", summary: "Fix", status: "todo", pullRequestIds: [], createdAt: 1, updatedAt: 1 },
				],
			});
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			const newPullRequest = Object.values(result.pullRequests)[0];
			expect(newPullRequest?.prState).toBe("merged");
		});

		it("updates prState to merged on rescan when existing PR transitions to merged", async () => {
			const existingPullRequest = {
				id: "merging-sub",
				jiraKey: "POL-1",
				repoId: "b",
				repoPath: "",
				prompt: "",
				title: "POL-1 feature",
				baseRef: "main",
				branchName: "POL-1-feature",
				worktreePath: "",
				status: "review" as const,
				prUrl: "https://github.com/a/b/pull/11",
				prNumber: 11,
				prState: "open" as const,
				createdAt: 1,
				updatedAt: 1,
			};
			const deps = createMockDeps();
			(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({
				"merging-sub": existingPullRequest,
			});
			(deps.listAuthoredGhPullRequestsForProject as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 11,
					title: "POL-1 feature",
					url: "https://github.com/a/b/pull/11",
					headRefName: "POL-1-feature",
					isDraft: false,
					state: "MERGED" as const,
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [
					{
						jiraKey: "POL-1",
						summary: "Fix",
						status: "todo",
						pullRequestIds: ["merging-sub"],
						createdAt: 1,
						updatedAt: 1,
					},
				],
			});
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			expect(result.pullRequests["merging-sub"]?.prState).toBe("merged");
		});

		it("preserves merged prState when gh returns stale non-MERGED state", async () => {
			const existingPullRequest = {
				id: "stale-merged-sub",
				jiraKey: "POL-1",
				repoId: "b",
				repoPath: "",
				prompt: "",
				title: "POL-1 feature",
				baseRef: "main",
				branchName: "POL-1-feature",
				worktreePath: "",
				status: "review" as const,
				prUrl: "https://github.com/a/b/pull/20",
				prNumber: 20,
				prState: "merged" as const,
				createdAt: 1,
				updatedAt: 1,
			};
			const deps = createMockDeps();
			(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({
				"stale-merged-sub": existingPullRequest,
			});
			(deps.listAuthoredGhPullRequestsForProject as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					number: 20,
					title: "POL-1 feature",
					url: "https://github.com/a/b/pull/20",
					headRefName: "POL-1-feature",
					isDraft: false,
					state: "OPEN" as const, // stale gh search index — PR was merged but is:open still returns it
					repository: { nameWithOwner: "a/b" },
				},
			]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [
					{
						jiraKey: "POL-1",
						summary: "Fix",
						status: "todo",
						pullRequestIds: ["stale-merged-sub"],
						createdAt: 1,
						updatedAt: 1,
					},
				],
			});
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			expect(result.pullRequests["stale-merged-sub"]?.prState).toBe("merged");
		});

		it("backfills prState='open' for orphan pullRequest with prUrl but no prState not returned by scan", async () => {
			const orphanPullRequest = {
				id: "orphan-sub",
				jiraKey: "POL-1",
				repoId: "b",
				repoPath: "",
				prompt: "",
				title: "Orphan PR",
				baseRef: "main",
				branchName: "POL-1-orphan",
				worktreePath: "",
				status: "review" as const,
				prUrl: "https://github.com/a/b/pull/99",
				prNumber: 99,
				// prState intentionally absent
				createdAt: 1,
				updatedAt: 1,
			};
			const deps = createMockDeps();
			(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({ "orphan-sub": orphanPullRequest });
			(deps.listAuthoredGhPullRequestsForProject as ReturnType<typeof vi.fn>).mockResolvedValue([]);
			(deps.loadJiraBoard as ReturnType<typeof vi.fn>).mockResolvedValue({
				cards: [
					{
						jiraKey: "POL-1",
						summary: "Fix",
						status: "todo",
						pullRequestIds: ["orphan-sub"],
						createdAt: 1,
						updatedAt: 1,
					},
				],
			});
			const api = createJiraApi(deps);
			const result = await api.scanAndAttachPRs();
			expect(result.pullRequests["orphan-sub"]?.prState).toBe("open");
		});

		it("re-throws gh CLI error with context", async () => {
			const deps = createMockDeps();
			(deps.listAuthoredGhPullRequestsForProject as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error("gh CLI not found. Install GitHub CLI (gh) to use PR scan."),
			);
			const api = createJiraApi(deps);
			await expect(api.scanAndAttachPRs()).rejects.toThrow(/Failed to fetch GitHub PRs/i);
		});
	});

	describe("jiraPullRequestSchema", () => {
		it("preserves prState through zod validation (guards against schema-strip regression)", () => {
			const pullRequest = {
				id: "x",
				jiraKey: "POL-1",
				repoId: "r",
				repoPath: "",
				prompt: "",
				title: "t",
				baseRef: "main",
				branchName: "b",
				worktreePath: "",
				status: "review" as const,
				prUrl: "https://github.com/a/b/pull/1",
				prNumber: 1,
				prState: "merged" as const,
				createdAt: 1,
				updatedAt: 1,
			};
			const parsed = jiraPullRequestSchema.parse(pullRequest);
			expect(parsed.prState).toBe("merged");
		});
	});

	describe("startPullRequestSession", () => {
		it("starts agent session when worktreePath exists on disk", async () => {
			const deps = createMockDeps();
			const pullRequest = {
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
			(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({ "sub-with-tree": pullRequest });
			(deps.addWorkspace as ReturnType<typeof vi.fn>).mockResolvedValue("ws-id-1");
			(deps.startTaskSession as ReturnType<typeof vi.fn>).mockResolvedValue({ started: true });
			fsMocks.access.mockResolvedValueOnce(undefined);
			const api = createJiraApi(deps);
			const result = await api.startPullRequestSession("sub-with-tree");
			expect(result.started).toBe(true);
			expect(result.workspaceId).toBe("ws-id-1");
			expect(result.openUrl).toBeUndefined();
		});

		it("returns openUrl when pullRequest has prUrl and no worktreePath set", async () => {
			const deps = createMockDeps();
			const pullRequest = {
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
				prState: "open" as const,
				createdAt: 1,
				updatedAt: 1,
			};
			(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({ "pr-sub": pullRequest });
			const api = createJiraApi(deps);
			const result = await api.startPullRequestSession("pr-sub");
			expect(result.openUrl).toBe("https://github.com/a/b/pull/42");
			expect(result.started).toBe(false);
			expect(result.workspaceId).toBe("");
			expect(deps.startTaskSession).not.toHaveBeenCalled();
		});

		it("returns openUrl when worktreePath is set but inaccessible and prUrl is present", async () => {
			const deps = createMockDeps();
			const pullRequest = {
				id: "stale-tree-sub",
				jiraKey: "POL-1",
				repoId: "repo",
				repoPath: "",
				prompt: "",
				title: "t",
				baseRef: "main",
				branchName: "POL-1-fix",
				worktreePath: "/worktrees/stale-path",
				status: "review" as const,
				prUrl: "https://github.com/a/b/pull/55",
				prNumber: 55,
				prState: "open" as const,
				createdAt: 1,
				updatedAt: 1,
			};
			(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({ "stale-tree-sub": pullRequest });
			fsMocks.access.mockRejectedValueOnce(new Error("ENOENT: no such file or directory"));
			const api = createJiraApi(deps);
			const result = await api.startPullRequestSession("stale-tree-sub");
			expect(result.openUrl).toBe("https://github.com/a/b/pull/55");
			expect(result.started).toBe(false);
			expect(deps.startTaskSession).not.toHaveBeenCalled();
		});

		it("throws when pullRequest has no worktreePath and no prUrl", async () => {
			const deps = createMockDeps();
			const pullRequest = {
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
			(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({ "no-tree-no-pr": pullRequest });
			const api = createJiraApi(deps);
			await expect(api.startPullRequestSession("no-tree-no-pr")).rejects.toThrow(/no worktree path and no PR URL/i);
		});
	});

	describe("fetchPullRequestDetail", () => {
		it("returns body and only unresolved threads for PR-backed pull request", async () => {
			const deps = createMockDeps();
			const pullRequest = {
				id: "sub-pr",
				jiraKey: "POL-1",
				repoId: "repo",
				repoPath: "/repos/repo",
				prompt: "",
				title: "Fix login",
				baseRef: "main",
				branchName: "POL-1-fix",
				worktreePath: "",
				status: "review" as const,
				prUrl: "https://github.com/myorg/myrepo/pull/42",
				prNumber: 42,
				createdAt: 1,
				updatedAt: 1,
			};
			(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({ "sub-pr": pullRequest });
			(deps.fetchGhPullRequestDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
				body: "PR description",
				reviewThreads: [
					{
						isResolved: false,
						isOutdated: false,
						path: "src/login.ts",
						comments: [
							{
								author: { login: "alice" },
								body: "Fix this",
								createdAt: "2024-01-01T00:00:00Z",
								url: "https://github.com/myorg/myrepo/pull/42#comment-1",
							},
						],
					},
					{
						isResolved: true,
						isOutdated: false,
						path: "src/old.ts",
						comments: [
							{
								author: { login: "bob" },
								body: "Already done",
								createdAt: "2024-01-02T00:00:00Z",
								url: "https://github.com/myorg/myrepo/pull/42#comment-2",
							},
						],
					},
				],
			});
			const api = createJiraApi(deps);
			const result = await api.fetchPullRequestDetail("sub-pr");
			expect(result.body).toBe("PR description");
			expect(result.threads).toHaveLength(1);
			expect(result.threads[0]?.path).toBe("src/login.ts");
			expect(result.threads[0]?.isResolved).toBe(false);
			expect(deps.fetchGhPullRequestDetail).toHaveBeenCalledWith("myorg", "myrepo", 42);
		});

		it("throws when pull request is not found", async () => {
			const deps = createMockDeps();
			const api = createJiraApi(deps);
			await expect(api.fetchPullRequestDetail("nonexistent")).rejects.toThrow(/not found/i);
		});

		it("throws when pull request has no prNumber", async () => {
			const deps = createMockDeps();
			const pullRequest = {
				id: "sub-no-pr",
				jiraKey: "POL-1",
				repoId: "repo",
				repoPath: "/repos/repo",
				prompt: "",
				title: "t",
				baseRef: "main",
				branchName: "POL-1-fix",
				worktreePath: "/worktrees/POL-1-fix",
				status: "in_progress" as const,
				createdAt: 1,
				updatedAt: 1,
			};
			(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({ "sub-no-pr": pullRequest });
			const api = createJiraApi(deps);
			await expect(api.fetchPullRequestDetail("sub-no-pr")).rejects.toThrow(/no PR number/i);
		});

		it("returns empty threads when all threads are resolved", async () => {
			const deps = createMockDeps();
			const pullRequest = {
				id: "sub-resolved",
				jiraKey: "POL-1",
				repoId: "repo",
				repoPath: "/repos/repo",
				prompt: "",
				title: "t",
				baseRef: "main",
				branchName: "POL-1-fix",
				worktreePath: "",
				status: "review" as const,
				prUrl: "https://github.com/myorg/myrepo/pull/10",
				prNumber: 10,
				createdAt: 1,
				updatedAt: 1,
			};
			(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({ "sub-resolved": pullRequest });
			(deps.fetchGhPullRequestDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
				body: "All good",
				reviewThreads: [
					{ isResolved: true, isOutdated: false, path: "src/a.ts", comments: [] },
					{ isResolved: true, isOutdated: true, path: "src/b.ts", comments: [] },
				],
			});
			const api = createJiraApi(deps);
			const result = await api.fetchPullRequestDetail("sub-resolved");
			expect(result.threads).toHaveLength(0);
			expect(result.body).toBe("All good");
		});
	});

	describe("startPullRequestSession — auto-create worktree", () => {
		it("auto-creates worktree and starts session when branchName+repoPath set and worktreesRoot available", async () => {
			const deps = createMockDeps();
			const pullRequest = {
				id: "auto-sub",
				jiraKey: "POL-2",
				repoId: "myrepo",
				repoPath: "/repos/myrepo",
				prompt: "Work on it",
				title: "POL-2 feature",
				baseRef: "main",
				branchName: "POL-2-feature",
				worktreePath: "",
				status: "review" as const,
				prUrl: "https://github.com/org/myrepo/pull/7",
				prNumber: 7,
				createdAt: 1,
				updatedAt: 1,
			};
			(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({ "auto-sub": pullRequest });
			(deps.getWorktreesRoot as ReturnType<typeof vi.fn>).mockReturnValue("/work");
			(deps.createPullRequestWorktree as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
			(deps.addWorkspace as ReturnType<typeof vi.fn>).mockResolvedValue("ws-auto");
			(deps.startTaskSession as ReturnType<typeof vi.fn>).mockResolvedValue({ started: true });
			fsMocks.access.mockRejectedValueOnce(new Error("ENOENT"));
			const api = createJiraApi(deps);
			const result = await api.startPullRequestSession("auto-sub");
			expect(deps.createPullRequestWorktree).toHaveBeenCalledWith(
				expect.objectContaining({ repoPath: "/repos/myrepo", branchName: "POL-2-feature" }),
			);
			expect(result.started).toBe(true);
			expect(result.openUrl).toBeUndefined();
		});

		it("falls back to openUrl when repoPath is empty (no local repo)", async () => {
			const deps = createMockDeps();
			const pullRequest = {
				id: "no-repo-sub",
				jiraKey: "POL-3",
				repoId: "myrepo",
				repoPath: "",
				prompt: "",
				title: "t",
				baseRef: "main",
				branchName: "POL-3-fix",
				worktreePath: "",
				status: "review" as const,
				prUrl: "https://github.com/org/myrepo/pull/8",
				prNumber: 8,
				createdAt: 1,
				updatedAt: 1,
			};
			(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({ "no-repo-sub": pullRequest });
			(deps.getWorktreesRoot as ReturnType<typeof vi.fn>).mockReturnValue("/work");
			const api = createJiraApi(deps);
			const result = await api.startPullRequestSession("no-repo-sub");
			expect(deps.createPullRequestWorktree).not.toHaveBeenCalled();
			expect(result.openUrl).toBe("https://github.com/org/myrepo/pull/8");
			expect(result.started).toBe(false);
		});

		it("falls back to openUrl when getWorktreesRoot returns null", async () => {
			const deps = createMockDeps();
			const pullRequest = {
				id: "no-root-sub",
				jiraKey: "POL-4",
				repoId: "myrepo",
				repoPath: "/repos/myrepo",
				prompt: "",
				title: "t",
				baseRef: "main",
				branchName: "POL-4-fix",
				worktreePath: "",
				status: "review" as const,
				prUrl: "https://github.com/org/myrepo/pull/9",
				prNumber: 9,
				createdAt: 1,
				updatedAt: 1,
			};
			(deps.loadJiraPullRequests as ReturnType<typeof vi.fn>).mockResolvedValue({ "no-root-sub": pullRequest });
			(deps.getWorktreesRoot as ReturnType<typeof vi.fn>).mockReturnValue(null);
			const api = createJiraApi(deps);
			const result = await api.startPullRequestSession("no-root-sub");
			expect(deps.createPullRequestWorktree).not.toHaveBeenCalled();
			expect(result.openUrl).toBe("https://github.com/org/myrepo/pull/9");
			expect(result.started).toBe(false);
		});
	});
});
