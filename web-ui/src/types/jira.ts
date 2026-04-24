export type JiraCardStatus = "todo" | "in_progress" | "done";
export type JiraSubtaskStatus = "backlog" | "in_progress" | "review" | "done";

export interface JiraCard {
	jiraKey: string;
	summary: string;
	status: JiraCardStatus;
	subtaskIds: string[];
	createdAt: number;
	updatedAt: number;
}

export interface JiraBoard {
	cards: JiraCard[];
}

export interface JiraSubtask {
	id: string;
	jiraKey: string;
	repoId: string;
	repoPath: string;
	prompt: string;
	title: string;
	baseRef: string;
	branchName: string;
	worktreePath: string;
	status: JiraSubtaskStatus;
	createdAt: number;
	updatedAt: number;
}

export interface RepoOption {
	id: string;
	path: string;
}
