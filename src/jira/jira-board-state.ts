import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type LockRequest, lockedFileSystem } from "../fs/locked-file-system.js";

export interface JiraCard {
	jiraKey: string; // e.g. "POL-1234"
	summary: string; // fetched from Jira
	status: "todo" | "in_progress" | "done";
	subtaskIds: string[]; // ordered list of subtask IDs
	createdAt: number;
	updatedAt: number;
}

export interface JiraBoard {
	cards: JiraCard[];
}

export interface JiraSubtask {
	id: string;
	jiraKey: string; // parent card key
	repoId: string; // repo directory name
	repoPath: string; // absolute path to repo
	prompt: string; // agent instruction
	title: string;
	baseRef: string; // branch to branch from (default "main")
	branchName: string; // e.g. "POL-1234-fix-auth-flow"
	worktreePath: string; // absolute path to worktree
	status: "backlog" | "in_progress" | "review" | "done";
	createdAt: number;
	updatedAt: number;
}

function getKanbanDataDir(): string {
	return join(homedir(), ".kanban", "kanban");
}

function getBoardFilePath(): string {
	return join(getKanbanDataDir(), "jira-board.json");
}

function getSubtasksFilePath(): string {
	return join(getKanbanDataDir(), "jira-subtasks.json");
}

function getBoardLockRequest(): LockRequest {
	return { path: getBoardFilePath(), type: "file" };
}

function getSubtasksLockRequest(): LockRequest {
	return { path: getSubtasksFilePath(), type: "file" };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
	try {
		const content = await readFile(filePath, "utf8");
		return JSON.parse(content) as T;
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return null;
		}
		// If JSON parsing fails or other read error, treat as missing
		return null;
	}
}

export async function loadJiraBoard(): Promise<JiraBoard> {
	const data = await readJsonFile<JiraBoard>(getBoardFilePath());
	if (data === null || !Array.isArray(data.cards)) {
		return { cards: [] };
	}
	return data;
}

export async function saveJiraBoard(board: JiraBoard): Promise<void> {
	await lockedFileSystem.writeJsonFileAtomic(getBoardFilePath(), board, {
		lock: getBoardLockRequest(),
	});
}

export async function loadJiraSubtasks(): Promise<Record<string, JiraSubtask>> {
	const data = await readJsonFile<Record<string, JiraSubtask>>(getSubtasksFilePath());
	if (data === null || typeof data !== "object") {
		return {};
	}
	return data;
}

export async function createJiraSubtask(
	input: Omit<JiraSubtask, "id" | "createdAt" | "updatedAt">,
): Promise<JiraSubtask> {
	const id = randomUUID();
	const now = Date.now();
	const subtask: JiraSubtask = {
		...input,
		id,
		createdAt: now,
		updatedAt: now,
	};

	await lockedFileSystem.withLocks([getBoardLockRequest(), getSubtasksLockRequest()], async () => {
		// Read current state inside the lock
		const [board, subtasks] = await Promise.all([
			readJsonFile<JiraBoard>(getBoardFilePath()),
			readJsonFile<Record<string, JiraSubtask>>(getSubtasksFilePath()),
		]);

		const currentBoard: JiraBoard = board !== null && Array.isArray(board.cards) ? board : { cards: [] };
		const currentSubtasks: Record<string, JiraSubtask> =
			subtasks !== null && typeof subtasks === "object" ? subtasks : {};

		// Add subtask to map
		const updatedSubtasks: Record<string, JiraSubtask> = {
			...currentSubtasks,
			[id]: subtask,
		};

		// Update parent card's subtaskIds
		const updatedCards = currentBoard.cards.map((card) => {
			if (card.jiraKey === input.jiraKey) {
				return {
					...card,
					subtaskIds: [...card.subtaskIds, id],
					updatedAt: now,
				};
			}
			return card;
		});
		const updatedBoard: JiraBoard = { cards: updatedCards };

		// Write both files atomically within the lock (lock: null skips re-locking)
		await lockedFileSystem.writeJsonFileAtomic(getBoardFilePath(), updatedBoard, { lock: null });
		await lockedFileSystem.writeJsonFileAtomic(getSubtasksFilePath(), updatedSubtasks, { lock: null });
	});

	return subtask;
}

export async function deleteJiraSubtask(subtaskId: string): Promise<void> {
	await lockedFileSystem.withLocks([getBoardLockRequest(), getSubtasksLockRequest()], async () => {
		const [board, subtasks] = await Promise.all([
			readJsonFile<JiraBoard>(getBoardFilePath()),
			readJsonFile<Record<string, JiraSubtask>>(getSubtasksFilePath()),
		]);

		const currentBoard: JiraBoard = board !== null && Array.isArray(board.cards) ? board : { cards: [] };
		const currentSubtasks: Record<string, JiraSubtask> =
			subtasks !== null && typeof subtasks === "object" ? subtasks : {};

		// Find parent jiraKey for the subtask being deleted
		const subtaskToDelete = currentSubtasks[subtaskId];

		// Remove subtask from map
		const { [subtaskId]: _removed, ...updatedSubtasks } = currentSubtasks;

		// Remove subtask ID from parent card's subtaskIds
		const updatedCards = currentBoard.cards.map((card) => {
			if (subtaskToDelete !== undefined && card.jiraKey === subtaskToDelete.jiraKey) {
				return {
					...card,
					subtaskIds: card.subtaskIds.filter((sid) => sid !== subtaskId),
					updatedAt: Date.now(),
				};
			}
			return card;
		});
		const updatedBoard: JiraBoard = { cards: updatedCards };

		await lockedFileSystem.writeJsonFileAtomic(getBoardFilePath(), updatedBoard, { lock: null });
		await lockedFileSystem.writeJsonFileAtomic(getSubtasksFilePath(), updatedSubtasks, { lock: null });
	});
}
