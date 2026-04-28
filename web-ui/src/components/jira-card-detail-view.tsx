import { GitPullRequest, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { MarkdownText } from "@/components/markdown-text";
import { PullRequestCreateDialog } from "@/components/pull-request-create-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import type { IssueData } from "@/hooks/use-jira-board";
import type { JiraBoard, JiraPullRequest } from "@/types/jira";

interface JiraCardDetailViewProps {
	jiraKey: string;
	board: JiraBoard;
	pullRequests: Record<string, JiraPullRequest>;
	details: Record<string, IssueData>;
	prScanning: boolean;
	fetchDetail: (jiraKey: string) => void;
	scanPRs: () => Promise<void>;
	onPullRequestCreated: () => void;
	onPullRequestClick: (pullRequest: JiraPullRequest) => void;
}

const PR_STATE_COLORS: Record<NonNullable<JiraPullRequest["prState"]>, string> = {
	open: "text-status-green",
	draft: "text-text-secondary",
	merged: "text-status-purple",
};

export function JiraCardDetailView({
	jiraKey,
	board,
	pullRequests,
	details,
	prScanning,
	fetchDetail,
	scanPRs,
	onPullRequestCreated,
	onPullRequestClick,
}: JiraCardDetailViewProps): React.ReactElement {
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

	const card = board.cards.find((c) => c.jiraKey === jiraKey);
	const cardPullRequests = (card?.pullRequestIds ?? [])
		.map((id) => pullRequests[id])
		.filter((s): s is JiraPullRequest => Boolean(s));
	const issueData = details[jiraKey];
	const isLoadingIssue = issueData === undefined;

	// Revalidate detail + trigger PR scan on every card open
	useEffect(() => {
		if (jiraKey) {
			fetchDetail(jiraKey);
			void scanPRs();
		}
	}, [jiraKey, fetchDetail, scanPRs]);

	// Reset local state when switching cards
	useEffect(() => {
		setIsDescriptionExpanded(false);
	}, [jiraKey]);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="border-b border-border p-4">
					{isLoadingIssue ? (
						<Spinner size={16} />
					) : (
						<>
							<div className="flex items-center gap-2">
								<span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-xs text-text-secondary">
									{jiraKey}
								</span>
							</div>
							<h2 className="mt-1 text-base font-semibold text-text-primary">
								{issueData?.summary ?? card?.summary}
							</h2>
							{issueData?.description && (
								<div className="mt-2">
									<div className={cn("overflow-hidden", !isDescriptionExpanded && "line-clamp-6")}>
										<MarkdownText>{issueData.description}</MarkdownText>
									</div>
									{!isDescriptionExpanded && (
										<button
											type="button"
											onClick={() => setIsDescriptionExpanded(true)}
											aria-expanded={false}
											aria-label="Expand description"
											className="mt-1 text-xs text-text-tertiary hover:text-text-secondary"
										>
											Show more
										</button>
									)}
								</div>
							)}
						</>
					)}
				</div>

				<div className="flex flex-col gap-1 p-3">
					<div className="mb-1 flex items-center justify-between">
						<span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
							Pull Requests
						</span>
					</div>
					{cardPullRequests.length === 0 &&
						(prScanning ? (
							<p className="flex items-center gap-1.5 text-xs text-text-tertiary">
								<Spinner size={12} />
								Scanning for PRs…
							</p>
						) : (
							<p className="text-xs text-text-tertiary">No pull requests yet. Add one below.</p>
						))}
					{cardPullRequests.map((pullRequest) => (
						<button
							key={pullRequest.id}
							type="button"
							onClick={() => onPullRequestClick(pullRequest)}
							className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-2"
						>
							{!pullRequest.prUrl && (
								<span className="shrink-0 text-xs font-medium text-text-tertiary">Draft</span>
							)}
							<div className="flex min-w-0 flex-1 flex-col gap-0.5">
								{pullRequest.prUrl ? (
									<div className="flex items-center gap-1.5">
										<GitPullRequest
											size={14}
											className={cn("shrink-0", PR_STATE_COLORS[pullRequest.prState ?? "open"])}
										/>
										<span className="truncate text-sm text-text-primary">
											{pullRequest.title || pullRequest.repoId}
										</span>
									</div>
								) : (
									<span className="truncate text-sm text-text-primary">
										{pullRequest.title || pullRequest.repoId}
									</span>
								)}
								<span className="truncate font-mono text-xs text-text-tertiary">{pullRequest.branchName}</span>
							</div>
						</button>
					))}
					<Button
						variant="ghost"
						size="sm"
						icon={<Plus size={14} />}
						className="mt-2 w-full justify-start"
						onClick={() => setCreateDialogOpen(true)}
					>
						Add Pull Request
					</Button>
				</div>
			</div>

			<PullRequestCreateDialog
				jiraKey={jiraKey}
				open={createDialogOpen}
				onClose={() => setCreateDialogOpen(false)}
				onCreated={() => {
					onPullRequestCreated();
					setCreateDialogOpen(false);
				}}
			/>
		</div>
	);
}
