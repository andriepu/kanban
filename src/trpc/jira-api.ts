import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { lockedFileSystem } from "../fs/locked-file-system.js";
import type { JiraBoard, JiraCard, JiraDetail, JiraPullRequest } from "../jira/jira-board-state.js";
import { extractJiraKey } from "../jira/jira-key-extract.js";
import type { GhPullRequest, GhPullRequestDetail, GhPullRequestReviewThread } from "../jira/jira-pr-scan.js";
import type { JiraIssueRaw } from "../jira/jira-rest.js";
import type { RepoInfo } from "../jira/jira-worktree.js";
import { buildPullRequestWorktreePath } from "../jira/jira-worktree.js";

export interface CreateJiraApiDependencies {
	loadJiraBoard: () => Promise<JiraBoard>;
	saveJiraBoard: (board: JiraBoard) => Promise<void>;
	loadJiraPullRequests: () => Promise<Record<string, JiraPullRequest>>;
	loadJiraDetails: () => Promise<Record<string, JiraDetail>>;
	saveJiraDetail: (detail: JiraDetail) => Promise<void>;
	createJiraPullRequest: (input: Omit<JiraPullRequest, "id" | "createdAt" | "updatedAt">) => Promise<JiraPullRequest>;
	deleteJiraPullRequest: (pullRequestId: string) => Promise<void>;
	searchJiraIssues: (jql: string) => Promise<JiraIssueRaw[]>;
	fetchIssue: (issueKey: string) => Promise<{ key: string; summary: string; description: string | null }>;
	transitionIssue: (issueKey: string, targetName: string) => Promise<void>;
	setApiToken: (token: string | null) => Promise<void>;
	scanRepos: (reposRoot: string) => Promise<RepoInfo[]>;
	createPullRequestWorktree: (options: {
		repoPath: string;
		worktreePath: string;
		branchName: string;
		baseRef: string;
	}) => Promise<void>;
	removePullRequestWorktree: (options: { repoPath: string; worktreePath: string }) => Promise<void>;
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
	listAuthoredGhPullRequestsForProject: (projectKey: string) => Promise<GhPullRequest[]>;
	fetchGhPullRequestDetail: (owner: string, repo: string, number: number) => Promise<GhPullRequestDetail>;
	getJiraProjectKey: () => string | null;
	broadcastRuntimeReposUpdated?: () => void;
}

function getPullRequestsFilePath(): string {
	return join(homedir(), ".kanban", "kanban", "jira-pull-requests.json");
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
		async loadBoard(): Promise<{ board: JiraBoard; pullRequests: Record<string, JiraPullRequest> }> {
			const [board, pullRequests] = await Promise.all([deps.loadJiraBoard(), deps.loadJiraPullRequests()]);
			return { board, pullRequests };
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

		async createPullRequest(input: {
			jiraKey: string;
			repoId: string;
			repoPath: string;
			prompt: string;
			title: string;
			baseRef: string;
			branchName: string;
		}): Promise<{ pullRequest: JiraPullRequest }> {
			const worktreesRoot = deps.getWorktreesRoot();
			if (!worktreesRoot) throw new Error("worktreesRoot not configured");

			const worktreePath = buildPullRequestWorktreePath(
				worktreesRoot,
				input.jiraKey,
				input.repoId,
				input.branchName,
			);

			await deps.createPullRequestWorktree({
				repoPath: input.repoPath,
				worktreePath,
				branchName: input.branchName,
				baseRef: input.baseRef,
			});

			const pullRequest = await deps.createJiraPullRequest({
				...input,
				worktreePath,
				status: "backlog",
			});

			deps.broadcastRuntimeReposUpdated?.();
			return { pullRequest };
		},

		async deletePullRequest(pullRequestId: string): Promise<{ deleted: boolean }> {
			const pullRequests = await deps.loadJiraPullRequests();
			const pullRequest = pullRequests[pullRequestId];
			if (pullRequest) {
				await deps.removePullRequestWorktree({
					repoPath: pullRequest.repoPath,
					worktreePath: pullRequest.worktreePath,
				});
			}
			await deps.deleteJiraPullRequest(pullRequestId);
			deps.broadcastRuntimeReposUpdated?.();
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
						pullRequestIds: [],
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

		async loadDetails(): Promise<{ details: Record<string, JiraDetail> }> {
			const details = await deps.loadJiraDetails();
			return { details };
		},

		async fetchIssue(jiraKey: string): Promise<{ jiraKey: string; summary: string; description: string | null }> {
			const result = await deps.fetchIssue(jiraKey);
			const detail: JiraDetail = {
				jiraKey: result.key,
				summary: result.summary,
				description: result.description,
				fetchedAt: Date.now(),
			};
			await deps.saveJiraDetail(detail);
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

		async fetchPullRequestDetail(pullRequestId: string): Promise<{ body: string; threads: GhPullRequestReviewThread[] }> {
			const pullRequests = await deps.loadJiraPullRequests();
			const pullRequest = pullRequests[pullRequestId];
			if (!pullRequest) throw new Error(`Pull request ${pullRequestId} not found`);
			if (!pullRequest.prNumber) throw new Error(`Pull request ${pullRequestId} has no PR number`);

			const match = pullRequest.prUrl
				?.replace(/[?#].*$/, "")
				.replace(/\/$/, "")
				.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+$/);
			if (!match) throw new Error(`Pull request ${pullRequestId} has invalid or missing prUrl`);
			const [, owner, repo] = match;
			if (!owner || !repo) throw new Error(`Pull request ${pullRequestId} has invalid or missing prUrl`);

			const detail = await deps.fetchGhPullRequestDetail(owner, repo, pullRequest.prNumber);
			const unresolvedThreads = detail.reviewThreads.filter((t) => !t.isResolved);
			return { body: detail.body, threads: unresolvedThreads };
		},

		async startPullRequestSession(
			pullRequestId: string,
		): Promise<{ started: boolean; workspacePath: string; workspaceId: string; openUrl?: string }> {
			const pullRequests = await deps.loadJiraPullRequests();
			const pullRequest = pullRequests[pullRequestId];
			if (!pullRequest) throw new Error(`Pull request ${pullRequestId} not found`);

			if (pullRequest.worktreePath) {
				let worktreeAccessible = false;
				try {
					await access(pullRequest.worktreePath);
					worktreeAccessible = true;
				} catch {}

				if (worktreeAccessible) {
					const workspaceId = await deps.addWorkspace(pullRequest.repoPath);
					const result = await deps.startTaskSession(
						pullRequest.repoPath,
						pullRequest.id,
						pullRequest.prompt,
						pullRequest.worktreePath,
					);
					pullRequests[pullRequestId] = { ...pullRequest, status: "in_progress", updatedAt: Date.now() };
					await lockedFileSystem.writeJsonFileAtomic(getPullRequestsFilePath(), pullRequests);
					return { started: result.started, workspacePath: pullRequest.repoPath, workspaceId };
				}
			}

			// Auto-create worktree if branchName and repoPath are set
			if (pullRequest.branchName && pullRequest.repoPath) {
				const worktreesRoot = deps.getWorktreesRoot();
				if (worktreesRoot) {
					try {
						const derivedPath = buildPullRequestWorktreePath(
							worktreesRoot,
							pullRequest.jiraKey,
							pullRequest.repoId,
							pullRequest.branchName,
						);
						await deps.createPullRequestWorktree({
							repoPath: pullRequest.repoPath,
							worktreePath: derivedPath,
							branchName: pullRequest.branchName,
							baseRef: pullRequest.baseRef,
						});
						const updatedPr: JiraPullRequest = { ...pullRequest, worktreePath: derivedPath, updatedAt: Date.now() };
						pullRequests[pullRequestId] = updatedPr;
						await lockedFileSystem.writeJsonFileAtomic(getPullRequestsFilePath(), pullRequests);

						const workspaceId = await deps.addWorkspace(updatedPr.repoPath);
						const result = await deps.startTaskSession(updatedPr.repoPath, updatedPr.id, updatedPr.prompt, derivedPath);
						pullRequests[pullRequestId] = { ...updatedPr, status: "in_progress", updatedAt: Date.now() };
						await lockedFileSystem.writeJsonFileAtomic(getPullRequestsFilePath(), pullRequests);
						return { started: result.started, workspacePath: updatedPr.repoPath, workspaceId };
					} catch {
						// auto-create failed; fall through to openUrl / error below
					}
				}
			}

			if (pullRequest.prUrl) {
				return { started: false, workspacePath: "", workspaceId: "", openUrl: pullRequest.prUrl };
			}

			throw new Error(`Pull request ${pullRequestId}: no worktree path and no PR URL`);
		},

		async stopPullRequestSession(pullRequestId: string, workspacePath: string): Promise<{ stopped: boolean }> {
			return deps.stopTaskSession(workspacePath, pullRequestId);
		},

		async updatePullRequestStatus(
			pullRequestId: string,
			status: JiraPullRequest["status"],
		): Promise<{ pullRequest: JiraPullRequest }> {
			const pullRequests = await deps.loadJiraPullRequests();
			const pullRequest = pullRequests[pullRequestId];
			if (!pullRequest) throw new Error(`Pull request ${pullRequestId} not found`);

			const updated: JiraPullRequest = { ...pullRequest, status, updatedAt: Date.now() };
			pullRequests[pullRequestId] = updated;

			await lockedFileSystem.writeJsonFileAtomic(getPullRequestsFilePath(), pullRequests);

			return { pullRequest: updated };
		},

		async scanAndAttachPRs(): Promise<{
			attached: number;
			skipped: number;
			pullRequests: Record<string, JiraPullRequest>;
			board: JiraBoard;
		}> {
			const projectKey = deps.getJiraProjectKey();
			if (!projectKey) {
				throw new Error("Jira project key not configured. Set it in Settings → Jira & Repos.");
			}

			let prs: GhPullRequest[];
			try {
				prs = await deps.listAuthoredGhPullRequestsForProject(projectKey);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Failed to fetch GitHub PRs: ${message}`);
			}

			const [board, pullRequests] = await Promise.all([deps.loadJiraBoard(), deps.loadJiraPullRequests()]);
			const boardKeySet = new Set(board.cards.map((c) => c.jiraKey));

			const prUrlToPullRequestId = new Map<string, string>();
			for (const [id, pullRequest] of Object.entries(pullRequests)) {
				if (pullRequest.prUrl) prUrlToPullRequestId.set(pullRequest.prUrl, id);
			}

			const updatedPullRequests: Record<string, JiraPullRequest> = { ...pullRequests };
			const newPullRequestsByCard = new Map<string, string[]>();
			const now = Date.now();
			let attached = 0;
			let skipped = 0;

			for (const pr of prs) {
				const jiraKey = extractJiraKey(pr.title, projectKey);
				if (!jiraKey || !boardKeySet.has(jiraKey)) {
					skipped++;
					continue;
				}

				const existingId = prUrlToPullRequestId.get(pr.url);
				if (existingId) {
					const existing = updatedPullRequests[existingId];
					if (existing) {
						const prState: JiraPullRequest["prState"] =
							existing.prState === "merged" || pr.state === "MERGED" ? "merged" : pr.isDraft ? "draft" : "open";
						const newStatus: JiraPullRequest["status"] = pr.isDraft ? "in_progress" : "review";
						const shouldUpdateStatus = existing.status === "in_progress" || existing.status === "review";
						updatedPullRequests[existingId] = {
							...existing,
							prState,
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
					const newPullRequest: JiraPullRequest = {
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
						prState: pr.state === "MERGED" ? "merged" : pr.isDraft ? "draft" : "open",
						createdAt: now,
						updatedAt: now,
					};
					updatedPullRequests[id] = newPullRequest;

					const existing = newPullRequestsByCard.get(jiraKey) ?? [];
					newPullRequestsByCard.set(jiraKey, [...existing, id]);
					attached++;
				}
			}

			let updatedBoard: JiraBoard = board;
			if (newPullRequestsByCard.size > 0) {
				const updatedCards = board.cards.map((card) => {
					const newIds = newPullRequestsByCard.get(card.jiraKey);
					if (!newIds) return card;
					return { ...card, pullRequestIds: [...card.pullRequestIds, ...newIds], updatedAt: now };
				});
				updatedBoard = { cards: updatedCards };
				await deps.saveJiraBoard(updatedBoard);
			}

			for (const pullRequest of Object.values(updatedPullRequests)) {
				if (pullRequest.prUrl !== undefined && pullRequest.prState === undefined) {
					pullRequest.prState = "open";
				}
			}

			await lockedFileSystem.writeJsonFileAtomic(getPullRequestsFilePath(), updatedPullRequests);

			deps.broadcastRuntimeReposUpdated?.();

			return { attached, skipped, pullRequests: updatedPullRequests, board: updatedBoard };
		},
	};
}
