import { GitPullRequest } from "lucide-react";
import { cn } from "@/components/ui/cn";
import type { JiraPullRequest } from "@/types/jira";

const PR_STATE_COLORS: Record<NonNullable<JiraPullRequest["prState"]>, string> = {
	open: "text-status-green",
	draft: "text-text-secondary",
	merged: "text-status-purple",
};

interface JiraPullRequestRowProps {
	pullRequest: JiraPullRequest;
	onClick: (pullRequest: JiraPullRequest) => void;
}

export function JiraPullRequestRow({ pullRequest, onClick }: JiraPullRequestRowProps): React.ReactElement {
	return (
		<button
			type="button"
			onClick={() => onClick(pullRequest)}
			className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-2"
		>
			{!pullRequest.prUrl && <span className="shrink-0 text-xs font-medium text-text-tertiary">Draft</span>}
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				{pullRequest.prUrl ? (
					<div className="flex items-center gap-1.5">
						<GitPullRequest
							size={14}
							className={cn("shrink-0", PR_STATE_COLORS[pullRequest.prState ?? "open"])}
						/>
						<span className="truncate text-sm text-text-primary">{pullRequest.title || pullRequest.repoId}</span>
					</div>
				) : (
					<span className="truncate text-sm text-text-primary">{pullRequest.title || pullRequest.repoId}</span>
				)}
				<span className="truncate font-mono text-xs text-text-tertiary">
					{pullRequest.repoId} · {pullRequest.branchName}
				</span>
			</div>
		</button>
	);
}
