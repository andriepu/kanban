import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
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
	saveJiraPullRequests: (pullRequests: Record<string, JiraPullRequest>) => Promise<void>;
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
	}) => Promise<{ worktreePath: string }>;
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
	deleteJiraCardCascade: (jiraKey: string) => Promise<{ removedPullRequestIds: string[] }>;
	deleteLocalBranch: (opts: { repoPath: string; branchName: string }) => Promise<void>;
	deleteRemoteBranch: (opts: { repoPath: string; branchName: string }) => Promise<void>;
	removeJiraCardWorktreeParent: (opts: { worktreesRoot: string; jiraKey: string }) => Promise<void>;
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

async function cascadeDeleteCard(
	jiraKey: string,
	deps: CreateJiraApiDependencies,
): Promise<{ deleted: boolean; removedPullRequestIds: string[] }> {
	const pullRequests = await deps.loadJiraPullRequests();
	const targetPRs = Object.values(pullRequests).filter((pr) => pr.jiraKey === jiraKey);

	for (const pr of targetPRs) {
		if (pr.worktreePath) {
			try {
				await deps.removePullRequestWorktree({ repoPath: pr.repoPath, worktreePath: pr.worktreePath });
			} catch {}
		}
		if (pr.repoPath && pr.branchName) {
			try {
				await deps.deleteLocalBranch({ repoPath: pr.repoPath, branchName: pr.branchName });
			} catch {}
			try {
				await deps.deleteRemoteBranch({ repoPath: pr.repoPath, branchName: pr.branchName });
			} catch {}
		}
	}

	const { removedPullRequestIds } = await deps.deleteJiraCardCascade(jiraKey);

	const worktreesRoot = deps.getWorktreesRoot();
	if (worktreesRoot) {
		try {
			await deps.removeJiraCardWorktreeParent({ worktreesRoot, jiraKey });
		} catch {}
	}

	deps.broadcastRuntimeReposUpdated?.();
	return { deleted: true, removedPullRequestIds };
}

async function pruneOrphanPullRequests(
	pullRequests: Record<string, JiraPullRequest>,
	boardKeySet: Set<string>,
	deps: Pick<
		CreateJiraApiDependencies,
		"saveJiraPullRequests" | "removePullRequestWorktree" | "removeJiraCardWorktreeParent" | "getWorktreesRoot"
	>,
): Promise<Record<string, JiraPullRequest>> {
	const next: Record<string, JiraPullRequest> = {};
	const orphans: JiraPullRequest[] = [];
	for (const [id, pr] of Object.entries(pullRequests)) {
		if (boardKeySet.has(pr.jiraKey)) {
			next[id] = pr;
		} else {
			orphans.push(pr);
		}
	}
	if (orphans.length === 0) return pullRequests;

	// Best-effort: remove each orphan's worktree
	for (const pr of orphans) {
		if (pr.worktreePath) {
			try {
				await deps.removePullRequestWorktree({ repoPath: pr.repoPath, worktreePath: pr.worktreePath });
			} catch {}
		}
	}

	// Best-effort: remove parent worktree dir for each orphaned jiraKey
	const worktreesRoot = deps.getWorktreesRoot();
	if (worktreesRoot) {
		const orphanedKeys = new Set(orphans.map((pr) => pr.jiraKey));
		for (const jiraKey of orphanedKeys) {
			try {
				await deps.removeJiraCardWorktreeParent({ worktreesRoot, jiraKey });
			} catch {}
		}
	}

	try {
		await deps.saveJiraPullRequests(next);
	} catch {
		// best-effort persist; in-memory response is still clean
	}
	return next;
}

export function createJiraApi(deps: CreateJiraApiDependencies) {
	return {
		async loadBoard(): Promise<{ board: JiraBoard; pullRequests: Record<string, JiraPullRequest> }> {
			const [board, pullRequests] = await Promise.all([deps.loadJiraBoard(), deps.loadJiraPullRequests()]);
			const boardKeySet = new Set(board.cards.map((c) => c.jiraKey));
			const pruned = await pruneOrphanPullRequests(pullRequests, boardKeySet, deps);
			return { board, pullRequests: pruned };
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

			const { worktreePath: resolvedWorktreePath } = await deps.createPullRequestWorktree({
				repoPath: input.repoPath,
				worktreePath,
				branchName: input.branchName,
				baseRef: input.baseRef,
			});

			const pullRequest = await deps.createJiraPullRequest({
				...input,
				worktreePath: resolvedWorktreePath,
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

		async deleteCard(jiraKey: string): Promise<{ deleted: boolean; removedPullRequestIds: string[] }> {
			return cascadeDeleteCard(jiraKey, deps);
		},

		async importFromJira(jql: string): Promise<{ imported: number; skipped: number; board: JiraBoard }> {
			const issues = await deps.searchJiraIssues(jql);

			const board = await deps.loadJiraBoard();
			const existingCardMap = new Map(board.cards.map((c) => [c.jiraKey, c]));

			const updatedCards: JiraCard[] = [...board.cards];
			let imported = 0;
			let skipped = 0;
			const now = Date.now();
			const keysToCleanup: string[] = [];

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
						// Unmapped status OR done → cascade-delete
						const idx = updatedCards.findIndex((c) => c.jiraKey === issue.key);
						if (idx !== -1) updatedCards.splice(idx, 1);
						keysToCleanup.push(issue.key);
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

			// Cascade-delete PRs, worktrees, branches, and details for Done cards
			for (const jiraKey of keysToCleanup) {
				await cascadeDeleteCard(jiraKey, deps);
			}

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

		async fetchPullRequestDetail(
			pullRequestId: string,
		): Promise<{ body: string; threads: GhPullRequestReviewThread[] }> {
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

		async startPullRequestSession(input: {
			pullRequestId?: string;
			repoPath?: string;
			branchName?: string;
		}): Promise<{
			started: boolean;
			workspacePath: string;
			workspaceId: string;
			worktreePath?: string;
			openUrl?: string;
		}> {
			const { pullRequestId, repoPath, branchName } = input;
			const pullRequests = await deps.loadJiraPullRequests();

			// Lookup by UUID first; fall back to (repoPath, branchName) pair if stale.
			let pullRequest = pullRequestId != null ? pullRequests[pullRequestId] : undefined;
			if (!pullRequest && repoPath && branchName) {
				pullRequest = Object.values(pullRequests).find(
					(pr) => pr.repoPath === repoPath && pr.branchName === branchName,
				);
			}
			if (!pullRequest) {
				const identifier =
					repoPath && branchName ? `branch "${branchName}" in "${repoPath}"` : `id "${pullRequestId ?? "(none)"}"`;
				throw new Error(
					`Pull request ${identifier} not found. Try refreshing the Jira board to re-sync pull requests.`,
				);
			}
			const resolvedPullRequestId = pullRequest.id;

			if (pullRequest.worktreePath) {
				let worktreeAccessible = false;
				try {
					await access(pullRequest.worktreePath);
					worktreeAccessible = true;
				} catch {}

				if (worktreeAccessible) {
					const workspaceId = await deps.addWorkspace(pullRequest.repoPath);
					pullRequests[resolvedPullRequestId] = { ...pullRequest, updatedAt: Date.now() };
					await deps.saveJiraPullRequests(pullRequests);
					return {
						started: true,
						workspacePath: pullRequest.repoPath,
						workspaceId,
						worktreePath: pullRequest.worktreePath,
					};
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
						const { worktreePath: resolvedWorktreePath } = await deps.createPullRequestWorktree({
							repoPath: pullRequest.repoPath,
							worktreePath: derivedPath,
							branchName: pullRequest.branchName,
							baseRef: pullRequest.baseRef,
						});
						const updatedPr: JiraPullRequest = {
							...pullRequest,
							worktreePath: resolvedWorktreePath,
							updatedAt: Date.now(),
						};
						pullRequests[resolvedPullRequestId] = updatedPr;
						await deps.saveJiraPullRequests(pullRequests);

						const workspaceId = await deps.addWorkspace(updatedPr.repoPath);
						pullRequests[resolvedPullRequestId] = { ...updatedPr, updatedAt: Date.now() };
						await deps.saveJiraPullRequests(pullRequests);
						return {
							started: true,
							workspacePath: updatedPr.repoPath,
							workspaceId,
							worktreePath: resolvedWorktreePath,
						};
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
						updatedPullRequests[existingId] = {
							...existing,
							prState,
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

			// Sweep orphans: PRs whose jiraKey is no longer on the board (disk drift)
			const finalKeySet = new Set(updatedBoard.cards.map((c) => c.jiraKey));
			const finalPullRequests = await pruneOrphanPullRequests(updatedPullRequests, finalKeySet, deps);

			// pruneOrphanPullRequests skips saving when there are no orphans (early return).
			// Always persist here so newly-attached PRs survive a server restart or re-load.
			await deps.saveJiraPullRequests(finalPullRequests);

			deps.broadcastRuntimeReposUpdated?.();

			return { attached, skipped, pullRequests: finalPullRequests, board: updatedBoard };
		},
	};
}
