import { cn } from "@/components/ui/cn";
import { ColumnIndicator } from "@/components/ui/column-indicator";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { JiraPullRequest } from "@/types/jira";

type PrColumn = "draft" | "open" | "done";

const PULL_REQUEST_COLUMNS: Array<{ id: PrColumn; label: string }> = [
	{ id: "draft", label: "Draft" },
	{ id: "open", label: "Open" },
	{ id: "done", label: "Done" },
];

function getPrColumn(pr: JiraPullRequest): PrColumn {
	if (pr.prState === "merged") return "done";
	if (pr.prState === "open") return "open";
	return "draft";
}

export function JiraPullRequestBoard({
	pullRequests,
	repoFilter,
	sessions,
	onPullRequestClick,
}: {
	pullRequests: JiraPullRequest[];
	repoFilter: string | null;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	onPullRequestClick: (pullRequest: JiraPullRequest) => void;
}): React.ReactElement {
	const filtered = repoFilter === null ? pullRequests : pullRequests.filter((s) => s.repoPath === repoFilter);

	return (
		<div className="flex h-full flex-1 gap-2 overflow-x-auto p-2">
			{PULL_REQUEST_COLUMNS.map((col) => {
				const colPullRequests = filtered.filter((s) => getPrColumn(s) === col.id);
				return (
					<PullRequestColumn
						key={col.id}
						columnId={col.id}
						label={col.label}
						pullRequests={colPullRequests}
						sessions={sessions}
						showRepoName={repoFilter === null}
						onPullRequestClick={onPullRequestClick}
					/>
				);
			})}
		</div>
	);
}

function PullRequestColumn({
	columnId,
	label,
	pullRequests,
	sessions,
	showRepoName,
	onPullRequestClick,
}: {
	columnId: PrColumn;
	label: string;
	pullRequests: JiraPullRequest[];
	sessions: Record<string, RuntimeTaskSessionSummary>;
	showRepoName: boolean;
	onPullRequestClick: (pullRequest: JiraPullRequest) => void;
}): React.ReactElement {
	return (
		<div
			data-column-id={columnId}
			className="flex flex-1 min-w-56 min-h-0 flex-col rounded-lg bg-surface-1 overflow-hidden border border-border"
		>
			<div className="flex h-10 items-center justify-between px-3 shrink-0">
				<div className="flex items-center gap-1.5">
					<ColumnIndicator columnId={columnId} />
					<span className="font-semibold text-sm">{label}</span>
				</div>
				<span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-tertiary">
					{pullRequests.length}
				</span>
			</div>
			<div className="flex flex-col gap-2 p-1.5 overflow-y-auto min-h-0">
				{pullRequests.map((pullRequest) => (
					<PullRequestCard
						key={pullRequest.id}
						pullRequest={pullRequest}
						isRunning={Boolean(sessions[pullRequest.id])}
						showRepoName={showRepoName}
						onClick={onPullRequestClick}
					/>
				))}
			</div>
		</div>
	);
}

function PullRequestCard({
	pullRequest,
	isRunning,
	showRepoName,
	onClick,
}: {
	pullRequest: JiraPullRequest;
	isRunning: boolean;
	showRepoName: boolean;
	onClick: (pullRequest: JiraPullRequest) => void;
}): React.ReactElement {
	const repoName = pullRequest.repoPath.split("/").pop() ?? pullRequest.repoPath;

	return (
		<button
			type="button"
			data-pull-request-id={pullRequest.id}
			onClick={() => onClick(pullRequest)}
			className="w-full rounded-md bg-surface-2 p-3 text-left transition-colors hover:bg-surface-3"
		>
			<div className="flex items-center justify-between gap-2 mb-1.5">
				<span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-text-secondary shrink-0">
					{pullRequest.jiraKey}
				</span>
				{isRunning && <span className="inline-flex size-2 rounded-full bg-status-green shrink-0" title="Running" />}
			</div>
			<p className="text-sm text-text-primary font-medium truncate">{pullRequest.title}</p>
			<p className="font-mono text-[11px] text-text-tertiary truncate mt-0.5">{pullRequest.branchName}</p>
			{showRepoName && (
				<p
					data-repo-name=""
					className={cn(
						"font-mono text-[10px] mt-1 truncate",
						isRunning ? "text-status-green" : "text-text-tertiary",
					)}
				>
					{repoName}
				</p>
			)}
		</button>
	);
}
