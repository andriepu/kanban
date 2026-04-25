import { homedir } from "node:os";
import { join } from "node:path";
import { lockedFileSystem } from "../fs/locked-file-system.js";
import type { JiraBoard, JiraCard, JiraSubtask } from "../jira/jira-board-state.js";
import { extractJiraKey } from "../jira/jira-key-extract.js";
import type { JiraPrLink } from "../jira/jira-pr-links.js";
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
	loadJiraPrLinks: () => Promise<Record<string, JiraPrLink[]>>;
	saveJiraPrLinks: (links: Record<string, JiraPrLink[]>) => Promise<void>;
	mergeScannedPrLinks: (
		existing: Record<string, JiraPrLink[]>,
		scanned: Array<{ jiraKey: string; pr: GhPullRequest }>,
	) => Record<string, JiraPrLink[]>;
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
		async loadBoard(): Promise<{
			board: JiraBoard;
			subtasks: Record<string, JiraSubtask>;
			prLinks: Record<string, JiraPrLink[]>;
		}> {
			const [board, subtasks, prLinks] = await Promise.all([
				deps.loadJiraBoard(),
				deps.loadJiraSubtasks(),
				deps.loadJiraPrLinks(),
			]);
			return { board, subtasks, prLinks };
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
		): Promise<{ started: boolean; workspacePath: string; workspaceId: string }> {
			const subtasks = await deps.loadJiraSubtasks();
			const subtask = subtasks[subtaskId];
			if (!subtask) throw new Error(`Subtask ${subtaskId} not found`);

			const workspaceId = await deps.addWorkspace(subtask.repoPath);
			const result = await deps.startTaskSession(subtask.repoPath, subtask.id, subtask.prompt, subtask.worktreePath);

			subtasks[subtaskId] = { ...subtask, status: "in_progress", updatedAt: Date.now() };
			await lockedFileSystem.writeJsonFileAtomic(getSubtasksFilePath(), subtasks);

			return { started: result.started, workspacePath: subtask.repoPath, workspaceId };
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

		async scanAndAttachPRs(): Promise<{ attached: number; skipped: number; prLinks: Record<string, JiraPrLink[]> }> {
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
			const [board, existingLinks] = await Promise.all([deps.loadJiraBoard(), deps.loadJiraPrLinks()]);

			const boardKeySet = new Set(board.cards.map((c) => c.jiraKey));
			const scanned: Array<{ jiraKey: string; pr: GhPullRequest }> = [];
			let skipped = 0;

			for (const pr of prs) {
				const jiraKey = extractJiraKey(pr.title, projectKey);
				if (!jiraKey || !boardKeySet.has(jiraKey)) {
					skipped++;
					continue;
				}
				scanned.push({ jiraKey, pr });
			}

			const existingPrUrls = new Set(Object.values(existingLinks).flatMap((links) => links.map((l) => l.prUrl)));
			const merged = deps.mergeScannedPrLinks(existingLinks, scanned);
			await deps.saveJiraPrLinks(merged);

			const attached = scanned.filter((s) => !existingPrUrls.has(s.pr.url)).length;
			return { attached, skipped, prLinks: merged };
		},
	};
}
