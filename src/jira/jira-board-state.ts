import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type LockRequest, lockedFileSystem } from "../fs/locked-file-system.js";

export interface JiraCard {
	jiraKey: string; // e.g. "POL-1234"
	summary: string; // fetched from Jira
	status: "todo" | "in_progress" | "done";
	pullRequestIds: string[]; // ordered list of pull request IDs
	createdAt: number;
	updatedAt: number;
}

export interface JiraBoard {
	cards: JiraCard[];
}

export interface JiraDetail {
	jiraKey: string;
	summary: string;
	description: string | null;
	fetchedAt: number;
}

export interface JiraPullRequest {
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
	prUrl?: string; // GitHub PR URL
	prNumber?: number; // GitHub PR number
	prState?: "open" | "draft" | "merged";
	createdAt: number;
	updatedAt: number;
}

function getKanbanDataDir(): string {
	return join(homedir(), ".kanban", "kanban");
}

function getBoardFilePath(): string {
	return join(getKanbanDataDir(), "jira-board.json");
}

function getPullRequestsFilePath(): string {
	return join(getKanbanDataDir(), "jira-pull-requests.json");
}

function getOldSubtasksFilePath(): string {
	return join(getKanbanDataDir(), "jira-subtasks.json");
}

function getDetailsFilePath(): string {
	return join(getKanbanDataDir(), "jira-details.json");
}

function getBoardLockRequest(): LockRequest {
	return { path: getBoardFilePath(), type: "file" };
}

function getPullRequestsLockRequest(): LockRequest {
	return { path: getPullRequestsFilePath(), type: "file" };
}

function getDetailsLockRequest(): LockRequest {
	return { path: getDetailsFilePath(), type: "file" };
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
	// Migration: cards created before pullRequestIds was added may lack the field
	const cards = data.cards.map((card) => ({
		...card,
		pullRequestIds: card.pullRequestIds ?? [],
	}));
	return { cards };
}

export async function saveJiraBoard(board: JiraBoard): Promise<void> {
	await lockedFileSystem.writeJsonFileAtomic(getBoardFilePath(), board, {
		lock: getBoardLockRequest(),
	});
}

export async function loadJiraPullRequests(): Promise<Record<string, JiraPullRequest>> {
	// Migration: if old jira-subtasks.json exists, migrate to jira-pull-requests.json
	const oldPath = getOldSubtasksFilePath();
	const oldData = await readJsonFile<Record<string, JiraPullRequest>>(oldPath);
	if (oldData !== null) {
		// Write to new path
		await lockedFileSystem.writeJsonFileAtomic(getPullRequestsFilePath(), oldData);
		// Delete old file (best-effort)
		try {
			await unlink(oldPath);
		} catch {
			// Ignore deletion errors — the new file is authoritative
		}
		// Fix up prState if missing
		for (const pr of Object.values(oldData)) {
			if (pr.prUrl !== undefined && pr.prState === undefined) {
				pr.prState = "open";
			}
		}
		return oldData;
	}

	const data = await readJsonFile<Record<string, JiraPullRequest>>(getPullRequestsFilePath());
	if (data === null || typeof data !== "object") {
		return {};
	}
	for (const pr of Object.values(data)) {
		if (pr.prUrl !== undefined && pr.prState === undefined) {
			pr.prState = "open";
		}
	}
	return data;
}

export async function createJiraPullRequest(
	input: Omit<JiraPullRequest, "id" | "createdAt" | "updatedAt">,
): Promise<JiraPullRequest> {
	const id = randomUUID();
	const now = Date.now();
	const pullRequest: JiraPullRequest = {
		...input,
		id,
		createdAt: now,
		updatedAt: now,
	};

	await lockedFileSystem.withLocks([getBoardLockRequest(), getPullRequestsLockRequest()], async () => {
		// Read current state inside the lock
		const [board, pullRequests] = await Promise.all([
			readJsonFile<JiraBoard>(getBoardFilePath()),
			readJsonFile<Record<string, JiraPullRequest>>(getPullRequestsFilePath()),
		]);

		const currentBoard: JiraBoard = board !== null && Array.isArray(board.cards) ? board : { cards: [] };
		const currentPullRequests: Record<string, JiraPullRequest> =
			pullRequests !== null && typeof pullRequests === "object" ? pullRequests : {};

		const matchingCard = currentBoard.cards.find((card) => card.jiraKey === input.jiraKey);
		if (matchingCard === undefined) {
			throw new Error(`Cannot create pull request: Jira card "${input.jiraKey}" not found in board`);
		}

		// Add pull request to map
		const updatedPullRequests: Record<string, JiraPullRequest> = {
			...currentPullRequests,
			[id]: pullRequest,
		};

		// Update parent card's pullRequestIds
		const updatedCards = currentBoard.cards.map((card) => {
			if (card.jiraKey === matchingCard.jiraKey) {
				return {
					...card,
					pullRequestIds: [...card.pullRequestIds, id],
					updatedAt: now,
				};
			}
			return card;
		});
		const updatedBoard: JiraBoard = { cards: updatedCards };

		// Write both files atomically within the lock (lock: null skips re-locking)
		await lockedFileSystem.writeJsonFileAtomic(getBoardFilePath(), updatedBoard, { lock: null });
		await lockedFileSystem.writeJsonFileAtomic(getPullRequestsFilePath(), updatedPullRequests, { lock: null });
	});

	return pullRequest;
}

export async function loadJiraDetails(): Promise<Record<string, JiraDetail>> {
	const data = await readJsonFile<Record<string, JiraDetail>>(getDetailsFilePath());
	if (data === null || typeof data !== "object") {
		return {};
	}
	return data;
}

export async function saveJiraDetail(detail: JiraDetail): Promise<void> {
	await lockedFileSystem.withLocks([getDetailsLockRequest()], async () => {
		const current = (await readJsonFile<Record<string, JiraDetail>>(getDetailsFilePath())) ?? {};
		const updated = { ...current, [detail.jiraKey]: detail };
		await lockedFileSystem.writeJsonFileAtomic(getDetailsFilePath(), updated, { lock: null });
	});
}

export async function deleteJiraPullRequest(pullRequestId: string): Promise<void> {
	await lockedFileSystem.withLocks([getBoardLockRequest(), getPullRequestsLockRequest()], async () => {
		const [board, pullRequests] = await Promise.all([
			readJsonFile<JiraBoard>(getBoardFilePath()),
			readJsonFile<Record<string, JiraPullRequest>>(getPullRequestsFilePath()),
		]);

		const currentBoard: JiraBoard = board !== null && Array.isArray(board.cards) ? board : { cards: [] };
		const currentPullRequests: Record<string, JiraPullRequest> =
			pullRequests !== null && typeof pullRequests === "object" ? pullRequests : {};

		// Find parent jiraKey for the pull request being deleted
		const pullRequestToDelete = currentPullRequests[pullRequestId];

		// Remove pull request from map
		const { [pullRequestId]: _removed, ...updatedPullRequests } = currentPullRequests;

		// Remove pull request ID from parent card's pullRequestIds
		const updatedCards = currentBoard.cards.map((card) => {
			if (pullRequestToDelete !== undefined && card.jiraKey === pullRequestToDelete.jiraKey) {
				return {
					...card,
					pullRequestIds: card.pullRequestIds.filter((pid) => pid !== pullRequestId),
					updatedAt: Date.now(),
				};
			}
			return card;
		});
		const updatedBoard: JiraBoard = { cards: updatedCards };

		await lockedFileSystem.writeJsonFileAtomic(getBoardFilePath(), updatedBoard, { lock: null });
		await lockedFileSystem.writeJsonFileAtomic(getPullRequestsFilePath(), updatedPullRequests, { lock: null });
	});
}
