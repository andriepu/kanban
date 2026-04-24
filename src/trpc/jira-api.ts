import { homedir } from "node:os";
import { join } from "node:path";
import { lockedFileSystem } from "../fs/locked-file-system.js";
import type { JiraBoard, JiraCard, JiraSubtask } from "../jira/jira-board-state.js";
import type { RepoInfo } from "../jira/jira-worktree.js";
import { buildSubtaskWorktreePath } from "../jira/jira-worktree.js";

export interface CreateJiraApiDependencies {
	loadJiraBoard: () => Promise<JiraBoard>;
	saveJiraBoard: (board: JiraBoard) => Promise<void>;
	loadJiraSubtasks: () => Promise<Record<string, JiraSubtask>>;
	createJiraSubtask: (input: Omit<JiraSubtask, "id" | "createdAt" | "updatedAt">) => Promise<JiraSubtask>;
	deleteJiraSubtask: (subtaskId: string) => Promise<void>;
	callJiraMcp: (prompt: string) => Promise<unknown>;
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
}

function getSubtasksFilePath(): string {
	return join(homedir(), ".kanban", "kanban", "jira-subtasks.json");
}

const JIRA_STATUS_MAP: Record<string, "todo" | "in_progress" | "done"> = {
	todo: "todo",
	blocked: "todo",
	"in-progress": "in_progress",
	qa: "in_progress",
	"code review": "in_progress",
	"ready to deploy": "done",
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
			const prompt = `Use the Atlassian MCP searchJiraIssuesUsingJql tool with this exact JQL: ${jql}\nFor each issue returned, extract the issue key, summary field, and status name.\nRespond with ONLY a valid JSON array — no markdown, no backticks, no explanation:\n[{"key":"PROJ-1","summary":"Issue title","status":"In-Progress"}]\nIf no issues are found, respond with only: []`;
			const raw = await deps.callJiraMcp(prompt);

			interface JiraIssueRaw {
				key: string;
				summary: string;
				status: string;
			}
			let issues: JiraIssueRaw[] = [];
			if (Array.isArray(raw)) {
				issues = raw as JiraIssueRaw[];
			} else if (raw && typeof raw === "object") {
				const rawObj = raw as Record<string, unknown>;
				if (Array.isArray(rawObj.result)) {
					issues = rawObj.result as JiraIssueRaw[];
				} else if (typeof rawObj.result === "string") {
					const stripped = rawObj.result
						.replace(/^```(?:json)?\s*\n?/, "")
						.replace(/\n?```\s*$/, "")
						.trim();
					try {
						const parsed: unknown = JSON.parse(stripped);
						if (Array.isArray(parsed)) {
							issues = parsed as JiraIssueRaw[];
						}
					} catch {
						// Not parseable JSON — no issues extracted
					}
				}
			}

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
					if (mappedStatus) {
						const idx = updatedCards.findIndex((c) => c.jiraKey === issue.key);
						if (idx !== -1) {
							const card = updatedCards[idx] as JiraCard;
							updatedCards[idx] = { ...card, status: mappedStatus, updatedAt: now };
						}
					} else {
						// Returned by Jira with unmapped status → remove from board
						const idx = updatedCards.findIndex((c) => c.jiraKey === issue.key);
						if (idx !== -1) updatedCards.splice(idx, 1);
					}
				} else if (mappedStatus) {
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
				// else: new issue with unmapped status → skip
			}

			const updatedBoard: JiraBoard = { cards: updatedCards };
			await deps.saveJiraBoard(updatedBoard);
			return { imported, skipped, board: updatedBoard };
		},

		async transitionIssue(jiraKey: string, targetStatus: "todo" | "in_progress" | "done"): Promise<{ ok: boolean }> {
			if (targetStatus === "in_progress") {
				const prompt = `Use the Atlassian MCP tool to transition Jira issue ${jiraKey} to status "IN-PROGRESS". Return JSON: { "ok": true }`;
				await deps.callJiraMcp(prompt).catch(() => null);
			}
			return { ok: true };
		},

		async fetchIssue(jiraKey: string): Promise<{ jiraKey: string; summary: string; description: string | null }> {
			const prompt = `Use the Atlassian MCP tool to fetch Jira issue ${jiraKey}. Return JSON with fields: key, summary, description (string or null).`;
			const raw = await deps.callJiraMcp(prompt);
			const data: { key?: string; summary?: string; description?: string | null } =
				raw !== null && typeof raw === "object"
					? (raw as { key?: string; summary?: string; description?: string | null })
					: {};
			return {
				jiraKey: data.key ?? jiraKey,
				summary: data.summary ?? "",
				description: data.description ?? null,
			};
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
	};
}
