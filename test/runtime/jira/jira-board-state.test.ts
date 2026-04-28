import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// We'll override HOME so lockedFileSystem writes to a temp dir
let tempHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(async () => {
	tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-jira-test-"));
	originalHome = process.env.HOME;
	originalUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
});

afterEach(async () => {
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	if (originalUserProfile === undefined) {
		delete process.env.USERPROFILE;
	} else {
		process.env.USERPROFILE = originalUserProfile;
	}
	await fs.rm(tempHome, { recursive: true, force: true });
});

// Path resolution calls homedir() lazily at invocation time, so the HOME override
// set in beforeEach is always in effect when any exported function runs.
import {
	createJiraPullRequest,
	deleteJiraCardCascade,
	deleteJiraDetail,
	deleteJiraPullRequest,
	type JiraBoard,
	type JiraDetail,
	type JiraPullRequest,
	loadJiraBoard,
	loadJiraDetails,
	loadJiraPullRequests,
	saveJiraBoard,
	saveJiraDetail,
} from "../../../src/jira/jira-board-state";

describe("loadJiraBoard", () => {
	it("returns empty board when file does not exist", async () => {
		const board = await loadJiraBoard();
		expect(board.cards).toEqual([]);
	});
});

describe("saveJiraBoard + loadJiraBoard", () => {
	it("round-trips board data", async () => {
		const board: JiraBoard = {
			cards: [
				{
					jiraKey: "POL-1",
					summary: "Fix login",
					status: "todo",
					pullRequestIds: [],
					createdAt: 1000,
					updatedAt: 1000,
				},
			],
		};
		await saveJiraBoard(board);
		const loaded = await loadJiraBoard();
		expect(loaded.cards).toHaveLength(1);
		expect(loaded.cards[0]?.jiraKey).toBe("POL-1");
	});
});

describe("loadJiraPullRequests", () => {
	it("returns empty object when file does not exist", async () => {
		const pullRequests = await loadJiraPullRequests();
		expect(Object.keys(pullRequests)).toHaveLength(0);
	});

	it("migrates from jira-subtasks.json: backfills prState='open' for entries that have prUrl but no prState", async () => {
		// Write to the OLD file path to simulate pre-migration disk data
		const subtasksPath = path.join(tempHome, ".kanban", "kanban", "jira-subtasks.json");
		await fs.mkdir(path.dirname(subtasksPath), { recursive: true });
		const legacyEntry = {
			id: "legacy-sub",
			jiraKey: "POL-1",
			repoId: "r",
			repoPath: "/r",
			prompt: "p",
			title: "t",
			baseRef: "main",
			branchName: "b",
			worktreePath: "/w",
			status: "review",
			prUrl: "https://github.com/a/b/pull/1",
			prNumber: 1,
			// prState intentionally absent — simulates pre-migration disk data
			createdAt: 1,
			updatedAt: 1,
		};
		const alreadyMerged: JiraPullRequest = {
			id: "merged-sub",
			jiraKey: "POL-1",
			repoId: "r",
			repoPath: "/r",
			prompt: "p",
			title: "t2",
			baseRef: "main",
			branchName: "b2",
			worktreePath: "/w2",
			prUrl: "https://github.com/a/b/pull/2",
			prNumber: 2,
			prState: "merged",
			createdAt: 1,
			updatedAt: 1,
		};
		await fs.writeFile(subtasksPath, JSON.stringify({ "legacy-sub": legacyEntry, "merged-sub": alreadyMerged }));

		const pullRequests = await loadJiraPullRequests();

		expect(pullRequests["legacy-sub"]?.prState).toBe("open");
		expect(pullRequests["merged-sub"]?.prState).toBe("merged"); // must not be overwritten
	});
});

describe("createJiraPullRequest", () => {
	it("creates pull request and adds to board pullRequestIds", async () => {
		const board: JiraBoard = {
			cards: [{ jiraKey: "POL-1", summary: "Fix", status: "todo", pullRequestIds: [], createdAt: 1, updatedAt: 1 }],
		};
		await saveJiraBoard(board);

		const input: Omit<JiraPullRequest, "id" | "createdAt" | "updatedAt"> = {
			jiraKey: "POL-1",
			repoId: "my-repo",
			repoPath: "/repos/my-repo",
			prompt: "Fix the login bug",
			title: "Fix login",
			baseRef: "main",
			branchName: "POL-1-fix-login",
			worktreePath: "/worktrees/POL-1/my-repo__POL-1-fix-login",
		};
		const pullRequest = await createJiraPullRequest(input);

		expect(pullRequest.id).toBeTruthy();
		expect(pullRequest.jiraKey).toBe("POL-1");
		expect(pullRequest.createdAt).toBeGreaterThan(0);

		const pullRequests = await loadJiraPullRequests();
		expect(pullRequests[pullRequest.id]).toBeDefined();

		const updatedBoard = await loadJiraBoard();
		expect(updatedBoard.cards[0]?.pullRequestIds).toContain(pullRequest.id);
	});
});

describe("deleteJiraPullRequest", () => {
	it("removes pull request and updates board pullRequestIds", async () => {
		// Seed a board with a known pull request ID
		const board: JiraBoard = {
			cards: [
				{ jiraKey: "POL-1", summary: "Fix", status: "todo", pullRequestIds: ["sub-1"], createdAt: 1, updatedAt: 1 },
			],
		};
		await saveJiraBoard(board);

		// Seed the pull requests file directly
		const pullRequestsPath = path.join(tempHome, ".kanban", "kanban", "jira-pull-requests.json");
		await fs.mkdir(path.dirname(pullRequestsPath), { recursive: true });
		const seededPullRequest: JiraPullRequest = {
			id: "sub-1",
			jiraKey: "POL-1",
			repoId: "r",
			repoPath: "/r",
			prompt: "p",
			title: "t",
			baseRef: "main",
			branchName: "b",
			worktreePath: "/w",
			createdAt: 1,
			updatedAt: 1,
		};
		await fs.writeFile(pullRequestsPath, JSON.stringify({ "sub-1": seededPullRequest }));

		await deleteJiraPullRequest("sub-1");

		const pullRequests = await loadJiraPullRequests();
		expect(pullRequests["sub-1"]).toBeUndefined();

		const updatedBoard = await loadJiraBoard();
		expect(updatedBoard.cards[0]?.pullRequestIds).not.toContain("sub-1");
	});

	it("does not throw when pull request does not exist", async () => {
		await expect(deleteJiraPullRequest("nonexistent-id")).resolves.not.toThrow();
	});
});

describe("createJiraPullRequest — error cases", () => {
	it("throws when parent jiraKey is not in board", async () => {
		// board is empty (no saveJiraBoard call)
		await expect(
			createJiraPullRequest({
				jiraKey: "POL-999",
				repoId: "r",
				repoPath: "/r",
				prompt: "p",
				title: "t",
				baseRef: "main",
				branchName: "POL-999-t",
				worktreePath: "/w",
			}),
		).rejects.toThrow(/POL-999/);
	});
});

describe("deleteJiraDetail", () => {
	it("removes the detail entry for the given jiraKey", async () => {
		const detail: JiraDetail = { jiraKey: "POL-1", summary: "Fix", description: null, fetchedAt: 1000 };
		const sibling: JiraDetail = { jiraKey: "POL-2", summary: "Other", description: null, fetchedAt: 2000 };
		await saveJiraDetail(detail);
		await saveJiraDetail(sibling);

		await deleteJiraDetail("POL-1");

		const remaining = await loadJiraDetails();
		expect(remaining["POL-1"]).toBeUndefined();
		expect(remaining["POL-2"]).toBeDefined();
	});

	it("is idempotent when key does not exist", async () => {
		await expect(deleteJiraDetail("POL-NONEXISTENT")).resolves.not.toThrow();
	});

	it("does not throw when details file does not exist", async () => {
		await expect(deleteJiraDetail("POL-1")).resolves.not.toThrow();
	});
});

describe("deleteJiraCardCascade", () => {
	it("removes card from board, PRs from map, detail entry, and returns removed PR ids", async () => {
		const board: JiraBoard = {
			cards: [
				{
					jiraKey: "POL-5",
					summary: "Card",
					status: "todo",
					pullRequestIds: ["pr-a"],
					createdAt: 1,
					updatedAt: 1,
				},
			],
		};
		await saveJiraBoard(board);

		const pullRequestsPath = path.join(tempHome, ".kanban", "kanban", "jira-pull-requests.json");
		await fs.mkdir(path.dirname(pullRequestsPath), { recursive: true });
		const pr: JiraPullRequest = {
			id: "pr-a",
			jiraKey: "POL-5",
			repoId: "r",
			repoPath: "/r",
			prompt: "p",
			title: "t",
			baseRef: "main",
			branchName: "b",
			worktreePath: "/w",
			createdAt: 1,
			updatedAt: 1,
		};
		await fs.writeFile(pullRequestsPath, JSON.stringify({ "pr-a": pr }));

		await saveJiraDetail({ jiraKey: "POL-5", summary: "Card", description: null, fetchedAt: 1 });

		const { removedPullRequestIds } = await deleteJiraCardCascade("POL-5");

		expect(removedPullRequestIds).toContain("pr-a");

		const updatedBoard = await loadJiraBoard();
		expect(updatedBoard.cards.find((c) => c.jiraKey === "POL-5")).toBeUndefined();

		const updatedPRs = await loadJiraPullRequests();
		expect(updatedPRs["pr-a"]).toBeUndefined();

		const updatedDetails = await loadJiraDetails();
		expect(updatedDetails["POL-5"]).toBeUndefined();
	});

	it("tolerates missing card (still cleans PRs and details)", async () => {
		const pullRequestsPath = path.join(tempHome, ".kanban", "kanban", "jira-pull-requests.json");
		await fs.mkdir(path.dirname(pullRequestsPath), { recursive: true });
		const pr: JiraPullRequest = {
			id: "pr-b",
			jiraKey: "POL-6",
			repoId: "r",
			repoPath: "/r",
			prompt: "p",
			title: "t",
			baseRef: "main",
			branchName: "b",
			worktreePath: "/w",
			createdAt: 1,
			updatedAt: 1,
		};
		await fs.writeFile(pullRequestsPath, JSON.stringify({ "pr-b": pr }));
		await saveJiraDetail({ jiraKey: "POL-6", summary: "X", description: null, fetchedAt: 1 });

		const { removedPullRequestIds } = await deleteJiraCardCascade("POL-6");

		expect(removedPullRequestIds).toContain("pr-b");
		const updatedPRs = await loadJiraPullRequests();
		expect(updatedPRs["pr-b"]).toBeUndefined();
		const updatedDetails = await loadJiraDetails();
		expect(updatedDetails["POL-6"]).toBeUndefined();
	});

	it("returns empty removedPullRequestIds when card has no PRs", async () => {
		const board: JiraBoard = {
			cards: [
				{
					jiraKey: "POL-7",
					summary: "No PRs",
					status: "todo",
					pullRequestIds: [],
					createdAt: 1,
					updatedAt: 1,
				},
			],
		};
		await saveJiraBoard(board);

		const { removedPullRequestIds } = await deleteJiraCardCascade("POL-7");
		expect(removedPullRequestIds).toHaveLength(0);

		const updatedBoard = await loadJiraBoard();
		expect(updatedBoard.cards.find((c) => c.jiraKey === "POL-7")).toBeUndefined();
	});
});
