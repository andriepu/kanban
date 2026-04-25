import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { lockedFileSystem } from "../fs/locked-file-system.js";
import type { JiraBoard, JiraCard, JiraSubtask } from "../jira/jira-board-state.js";
import { extractJiraKey } from "../jira/jira-key-extract.js";
import type { GhPullRequest } from "../jira/jira-pr-scan.js";
import type { JiraIssueRaw } from "../jira/jira-rest.js";
import type { RepoInfo } from "../jira/jira-worktree.js";
import { buildSubtaskWorktreePath } from "../jira/jira-worktree.js";

export interface CreateJiraApiDependencies {
	loadJiraBoard: () => Promise<JiraBoard>;
	saveJiraBoard: (board: JiraBoard) => Promise<void>;
	loadJiraSubtasks: () => Promise<Record<string, JiraSubtask>>;
	createJiraSubtask: (input: Omit<JiraSubtask, "id" | "createdAt" | "updatedAt">) => Promise<JiraSubtask>;
	deleteJiraSubtask: (subtaskId: string) => Promise<void>;
	searchJiraIssues: (jql: string) => Promise<JiraIssueRaw[]>;
	fetchIssue: (issueKey: string) => Promise<{ key: string; summary: string; description: string | null }>;
	transitionIssue: (issueKey: string, targetName: string) => Promise<void>;
	setApiToken: (token: string | null) => Promise<void>;
	scanRepos: (reposRoot: string) => Promise<RepoInfo[]>;
	createSubtaskWorktree: (options: {
		repoPath: string;
		worktreePath: string;
		branchName: string;
		baseRef: string;
	}) => Promise<void>;
	removeSubtaskWorktree: (options: { repoPath: string; worktreePath: string }) => Promise<void>;
	startTaskSession: (
		workspacePath: string,
		taskId: string,
		prompt: string,
		customCwd: string,
	) => Promise<{ started: boolean }>;
	stopTaskSession: (workspacePath: string, taskId: string) => Promise<{ stopped: boolean }>;
	addWorkspace: (workspacePath: string) => Promise<string>;
	getWorktreesRoot: () => string | null;
	getReposRoot: () => string | null;
	listOpenAuthoredGhPullRequests: () => Promise<GhPullRequest[]>;
	getJiraProjectKey: () => string | null;
}

function getSubtasksFilePath(): string {
	return join(homedir(), ".kanban", "kanban", "jira-subtasks.json");
}

const JIRA_STATUS_MAP: Record<string, "todo" | "in_progress" | "done"> = {
	"to do": "todo",
	"to-do": "todo",
	todo: "todo",
	blocked: "todo",
	"in progress": "in_progress",
	"in-progress": "in_progress",
	qa: "in_progress",
	"code review": "in_progress",
	"ready to deploy": "done",
	done: "done",
};

export function createJiraApi(deps: CreateJiraApiDependencies) {
	return {
		async loadBoard(): Promise<{ board: JiraBoard; subtasks: Record<string, JiraSubtask> }> {
			const [board, subtasks] = await Promise.all([deps.loadJiraBoard(), deps.loadJiraSubtasks()]);
			return { board, subtasks };
		},

		async saveBoard(board: JiraBoard): Promise<{ board: JiraBoard }> {
			await deps.saveJiraBoard(board);
			return { board };
		},

		async scanRepos(): Promise<{ repos: RepoInfo[] }> {
			const reposRoot = deps.getReposRoot();
			if (!reposRoot) return { repos: [] };
			const repos = await deps.scanRepos(reposRoot);
			return { repos };
		},

		async createSubtask(input: {
			jiraKey: string;
			repoId: string;
			repoPath: string;
			prompt: string;
			title: string;
			baseRef: string;
			branchName: string;
		}): Promise<{ subtask: JiraSubtask }> {
			const worktreesRoot = deps.getWorktreesRoot();
			if (!worktreesRoot) throw new Error("worktreesRoot not configured");

			const worktreePath = buildSubtaskWorktreePath(worktreesRoot, input.jiraKey, input.repoId, input.branchName);

			await deps.createSubtaskWorktree({
				repoPath: input.repoPath,
				worktreePath,
				branchName: input.branchName,
				baseRef: input.baseRef,
			});

			const subtask = await deps.createJiraSubtask({
				...input,
				worktreePath,
				status: "backlog",
			});

			return { subtask };
		},

		async deleteSubtask(subtaskId: string): Promise<{ deleted: boolean }> {
			const subtasks = await deps.loadJiraSubtasks();
			const subtask = subtasks[subtaskId];
			if (subtask) {
				await deps.removeSubtaskWorktree({ repoPath: subtask.repoPath, worktreePath: subtask.worktreePath });
			}
			await deps.deleteJiraSubtask(subtaskId);
			return { deleted: true };
		},

		async importFromJira(jql: string): Promise<{ imported: number; skipped: number; board: JiraBoard }> {
			const issues = await deps.searchJiraIssues(jql);

			const board = await deps.loadJiraBoard();
			const existingCardMap = new Map(board.cards.map((c) => [c.jiraKey, c]));

			const updatedCards: JiraCard[] = [...board.cards];
			let imported = 0;
			let skipped = 0;
			const now = Date.now();

			for (const issue of issues) {
				if (!issue.key || !issue.summary) continue;
				const mappedStatus = JIRA_STATUS_MAP[issue.status?.toLowerCase().trim() ?? ""];

				const existing = existingCardMap.get(issue.key);
				if (existing) {
					skipped++;
					if (mappedStatus && mappedStatus !== "done") {
						const idx = updatedCards.findIndex((c) => c.jiraKey === issue.key);
						if (idx !== -1) {
							const card = updatedCards[idx] as JiraCard;
							updatedCards[idx] = { ...card, status: mappedStatus, updatedAt: now };
						}
					} else {
						// Unmapped status OR done → remove from board
						const idx = updatedCards.findIndex((c) => c.jiraKey === issue.key);
						if (idx !== -1) updatedCards.splice(idx, 1);
					}
				} else if (mappedStatus && mappedStatus !== "done") {
					updatedCards.push({
						jiraKey: issue.key,
						summary: issue.summary,
						status: mappedStatus,
						subtaskIds: [],
						createdAt: now,
						updatedAt: now,
					});
					imported++;
				}
				// else: new issue with unmapped status or done → skip
			}

			const updatedBoard: JiraBoard = { cards: updatedCards };
			await deps.saveJiraBoard(updatedBoard);
			return { imported, skipped, board: updatedBoard };
		},

		async transitionIssue(jiraKey: string, targetStatus: "todo" | "in_progress" | "done"): Promise<{ ok: boolean }> {
			if (targetStatus === "in_progress") {
				await deps.transitionIssue(jiraKey, "In Progress").catch(() => null);
			}
			return { ok: true };
		},

		async fetchIssue(jiraKey: string): Promise<{ jiraKey: string; summary: string; description: string | null }> {
			const result = await deps.fetchIssue(jiraKey);
			return {
				jiraKey: result.key,
				summary: result.summary,
				description: result.description,
			};
		},

		async setApiToken(token: string | null): Promise<{ configured: boolean }> {
			await deps.setApiToken(token);
			return { configured: token !== null };
		},

		async startSubtaskSession(
			subtaskId: string,
		): Promise<{ started: boolean; workspacePath: string; workspaceId: string; openUrl?: string }> {
			const subtasks = await deps.loadJiraSubtasks();
			const subtask = subtasks[subtaskId];
			if (!subtask) throw new Error(`Subtask ${subtaskId} not found`);

			if (subtask.worktreePath) {
				let worktreeAccessible = false;
				try {
					await access(subtask.worktreePath);
					worktreeAccessible = true;
				} catch {
					// worktree path does not exist on disk
				}

				if (worktreeAccessible) {
					const workspaceId = await deps.addWorkspace(subtask.repoPath);
					const result = await deps.startTaskSession(
						subtask.repoPath,
						subtask.id,
						subtask.prompt,
						subtask.worktreePath,
					);
					subtasks[subtaskId] = { ...subtask, status: "in_progress", updatedAt: Date.now() };
					await lockedFileSystem.writeJsonFileAtomic(getSubtasksFilePath(), subtasks);
					return { started: result.started, workspacePath: subtask.repoPath, workspaceId };
				}
			}

			if (subtask.prUrl) {
				return { started: false, workspacePath: "", workspaceId: "", openUrl: subtask.prUrl };
			}

			throw new Error(`Subtask ${subtaskId}: no worktree path and no PR URL`);
		},

		async stopSubtaskSession(subtaskId: string, workspacePath: string): Promise<{ stopped: boolean }> {
			return deps.stopTaskSession(workspacePath, subtaskId);
		},

		async updateSubtaskStatus(subtaskId: string, status: JiraSubtask["status"]): Promise<{ subtask: JiraSubtask }> {
			const subtasks = await deps.loadJiraSubtasks();
			const subtask = subtasks[subtaskId];
			if (!subtask) throw new Error(`Subtask ${subtaskId} not found`);

			const updated: JiraSubtask = { ...subtask, status, updatedAt: Date.now() };
			subtasks[subtaskId] = updated;

			await lockedFileSystem.writeJsonFileAtomic(getSubtasksFilePath(), subtasks);

			return { subtask: updated };
		},

		async scanAndAttachPRs(): Promise<{ attached: number; skipped: number; subtasks: Record<string, JiraSubtask> }> {
			const projectKey = deps.getJiraProjectKey();
			if (!projectKey) {
				throw new Error("Jira project key not configured. Set it in Settings → Jira & Repos.");
			}

			let prs: GhPullRequest[];
			try {
				prs = await deps.listOpenAuthoredGhPullRequests();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Failed to fetch GitHub PRs: ${message}`);
			}

			const [board, subtasks] = await Promise.all([deps.loadJiraBoard(), deps.loadJiraSubtasks()]);
			const boardKeySet = new Set(board.cards.map((c) => c.jiraKey));

			const prUrlToSubtaskId = new Map<string, string>();
			for (const [id, subtask] of Object.entries(subtasks)) {
				if (subtask.prUrl) prUrlToSubtaskId.set(subtask.prUrl, id);
			}

			const updatedSubtasks: Record<string, JiraSubtask> = { ...subtasks };
			const newSubtasksByCard = new Map<string, string[]>();
			const now = Date.now();
			let attached = 0;
			let skipped = 0;

			for (const pr of prs) {
				const jiraKey = extractJiraKey(pr.title, projectKey);
				if (!jiraKey || !boardKeySet.has(jiraKey)) {
					skipped++;
					continue;
				}

				const existingId = prUrlToSubtaskId.get(pr.url);
				if (existingId) {
					const existing = updatedSubtasks[existingId];
					if (existing) {
						const newStatus: JiraSubtask["status"] = pr.isDraft ? "in_progress" : "review";
						const shouldUpdateStatus = existing.status === "in_progress" || existing.status === "review";
						updatedSubtasks[existingId] = {
							...existing,
							isDraft: pr.isDraft,
							status: shouldUpdateStatus ? newStatus : existing.status,
							updatedAt: now,
						};
					}
				} else {
					const repoShortName = pr.repository.nameWithOwner.split("/").pop() ?? pr.repository.nameWithOwner;
					const reposRoot = deps.getReposRoot();
					let repoPath = "";
					if (reposRoot) {
						const repos = await deps.scanRepos(reposRoot);
						const match = repos.find((r) => r.id === repoShortName);
						if (match) repoPath = match.path;
					}

					const id = randomUUID();
					const newSubtask: JiraSubtask = {
						id,
						jiraKey,
						repoId: repoShortName,
						repoPath,
						prompt: "",
						title: pr.title,
						baseRef: "main",
						branchName: pr.headRefName,
						worktreePath: "",
						status: pr.isDraft ? "in_progress" : "review",
						prUrl: pr.url,
						prNumber: pr.number,
						isDraft: pr.isDraft,
						createdAt: now,
						updatedAt: now,
					};
					updatedSubtasks[id] = newSubtask;

					const existing = newSubtasksByCard.get(jiraKey) ?? [];
					newSubtasksByCard.set(jiraKey, [...existing, id]);
					attached++;
				}
			}

			if (newSubtasksByCard.size > 0) {
				const updatedCards = board.cards.map((card) => {
					const newIds = newSubtasksByCard.get(card.jiraKey);
					if (!newIds) return card;
					return { ...card, subtaskIds: [...card.subtaskIds, ...newIds], updatedAt: now };
				});
				await deps.saveJiraBoard({ cards: updatedCards });
			}

			await lockedFileSystem.writeJsonFileAtomic(getSubtasksFilePath(), updatedSubtasks);

			return { attached, skipped, subtasks: updatedSubtasks };
		},
	};
}
