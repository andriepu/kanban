import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// We'll override HOME so lockedFileSystem writes to a temp dir
let tempHome: string;
let originalHome: string;

beforeEach(async () => {
	tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-jira-test-"));
	originalHome = os.homedir();
	// Override HOME env var so homedir() returns our temp dir
	process.env.HOME = tempHome;
});

afterEach(async () => {
	process.env.HOME = originalHome;
	await fs.rm(tempHome, { recursive: true, force: true });
});

// Import AFTER setting up env (use dynamic imports in tests or import at top and rely on HOME env)
import {
	createJiraSubtask,
	deleteJiraSubtask,
	type JiraBoard,
	type JiraSubtask,
	loadJiraBoard,
	loadJiraSubtasks,
	saveJiraBoard,
} from "../../../src/jira/jira-board-state.js";

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
					subtaskIds: [],
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

describe("loadJiraSubtasks", () => {
	it("returns empty object when file does not exist", async () => {
		const subtasks = await loadJiraSubtasks();
		expect(Object.keys(subtasks)).toHaveLength(0);
	});
});

describe("createJiraSubtask", () => {
	it("creates subtask and adds to board subtaskIds", async () => {
		const board: JiraBoard = {
			cards: [{ jiraKey: "POL-1", summary: "Fix", status: "todo", subtaskIds: [], createdAt: 1, updatedAt: 1 }],
		};
		await saveJiraBoard(board);

		const input: Omit<JiraSubtask, "id" | "createdAt" | "updatedAt"> = {
			jiraKey: "POL-1",
			repoId: "my-repo",
			repoPath: "/repos/my-repo",
			prompt: "Fix the login bug",
			title: "Fix login",
			baseRef: "main",
			branchName: "POL-1-fix-login",
			worktreePath: "/worktrees/POL-1/my-repo__POL-1-fix-login",
			status: "backlog",
		};
		const subtask = await createJiraSubtask(input);

		expect(subtask.id).toBeTruthy();
		expect(subtask.jiraKey).toBe("POL-1");
		expect(subtask.createdAt).toBeGreaterThan(0);

		const subtasks = await loadJiraSubtasks();
		expect(subtasks[subtask.id]).toBeDefined();

		const updatedBoard = await loadJiraBoard();
		expect(updatedBoard.cards[0]?.subtaskIds).toContain(subtask.id);
	});
});

describe("deleteJiraSubtask", () => {
	it("removes subtask and updates board subtaskIds", async () => {
		// Seed a board with a known subtask ID
		const board: JiraBoard = {
			cards: [
				{ jiraKey: "POL-1", summary: "Fix", status: "todo", subtaskIds: ["sub-1"], createdAt: 1, updatedAt: 1 },
			],
		};
		await saveJiraBoard(board);

		// Seed the subtasks file directly
		const subtasksPath = path.join(tempHome, ".kanban", "kanban", "jira-subtasks.json");
		await fs.mkdir(path.dirname(subtasksPath), { recursive: true });
		const seededSubtask: JiraSubtask = {
			id: "sub-1",
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
		};
		await fs.writeFile(subtasksPath, JSON.stringify({ "sub-1": seededSubtask }));

		await deleteJiraSubtask("sub-1");

		const subtasks = await loadJiraSubtasks();
		expect(subtasks["sub-1"]).toBeUndefined();

		const updatedBoard = await loadJiraBoard();
		expect(updatedBoard.cards[0]?.subtaskIds).not.toContain("sub-1");
	});

	it("does not throw when subtask does not exist", async () => {
		await expect(deleteJiraSubtask("nonexistent-id")).resolves.not.toThrow();
	});
});
