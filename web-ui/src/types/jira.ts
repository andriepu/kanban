export type JiraCardStatus = "todo" | "in_progress" | "done";
export type JiraPullRequestStatus = "backlog" | "in_progress" | "review" | "done";

export interface JiraCard {
	jiraKey: string;
	summary: string;
	status: JiraCardStatus;
	pullRequestIds: string[];
	createdAt: number;
	updatedAt: number;
}

export interface JiraBoard {
	cards: JiraCard[];
}

export interface JiraPullRequest {
	id: string;
	jiraKey: string;
	repoId: string;
	repoPath: string;
	prompt: string;
	title: string;
	baseRef: string;
	branchName: string;
	worktreePath: string;
	status: JiraPullRequestStatus;
	prUrl?: string;
	prNumber?: number;
	prState?: "open" | "draft" | "merged";
	createdAt: number;
	updatedAt: number;
}

export interface RepoOption {
	id: string;
	path: string;
}
