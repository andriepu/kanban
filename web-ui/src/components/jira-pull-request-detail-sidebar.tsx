import { useEffect, useState } from "react";
import { MarkdownText } from "@/components/markdown-text";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { JiraPullRequestDetail, JiraPullRequestDetailThread } from "@/types/jira";

interface JiraPullRequestDetailSidebarProps {
	pullRequestId: string;
}

function ThreadCard({ thread }: { thread: JiraPullRequestDetailThread }): React.ReactElement {
	return (
		<div className="rounded-md border border-border bg-surface-2 p-3">
			<div className="mb-2 font-mono text-xs text-text-tertiary">{thread.path}</div>
			{thread.comments.map((comment) => (
				<div key={comment.url} className="mt-2 first:mt-0">
					<div className="mb-1 flex items-center gap-2">
						<span className="text-xs font-medium text-text-secondary">{comment.author.login}</span>
						<span className="text-xs text-text-tertiary">
							{new Date(comment.createdAt).toLocaleDateString(undefined, {
								month: "short",
								day: "numeric",
								year: "numeric",
							})}
						</span>
					</div>
					<div className="text-sm text-text-primary">
						<MarkdownText>{comment.body}</MarkdownText>
					</div>
				</div>
			))}
		</div>
	);
}

export function JiraPullRequestDetailSidebar({ pullRequestId }: JiraPullRequestDetailSidebarProps): React.ReactElement {
	const trpc = getRuntimeTrpcClient(null);
	const [detail, setDetail] = useState<JiraPullRequestDetail | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setDetail(null);
		setError(null);
		setIsLoading(true);
		trpc.jira.fetchPullRequestDetail
			.query({ pullRequestId })
			.then(setDetail)
			.catch((err: unknown) => {
				setError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, [pullRequestId, trpc]);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner size={20} />
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex h-full items-center justify-center p-4">
				<p className="text-center text-sm text-status-red">{error}</p>
			</div>
		);
	}

	if (!detail) return <></>;

	const unresolvedThreads = detail.threads.filter((t) => !t.isResolved);

	return (
		<div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
			{detail.body ? (
				<div>
					<div className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">Description</div>
					<div className="text-sm text-text-primary">
						<MarkdownText>{detail.body}</MarkdownText>
					</div>
				</div>
			) : null}

			<div>
				<div className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">
					Unresolved Comments
				</div>
				{unresolvedThreads.length === 0 ? (
					<p className="text-sm text-text-tertiary">No unresolved comments.</p>
				) : (
					<div className="flex flex-col gap-2">
						{unresolvedThreads.map((thread) => (
							<ThreadCard key={thread.path + thread.comments[0]?.url} thread={thread} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}
