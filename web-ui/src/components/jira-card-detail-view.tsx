import { GitPullRequest, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { MarkdownText } from "@/components/markdown-text";
import { SubtaskCreateDialog } from "@/components/subtask-create-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { JiraBoard, JiraPrLink, JiraSubtask } from "@/types/jira";

interface IssueData {
	jiraKey: string;
	summary: string;
	description: string | null;
}

interface JiraCardDetailViewProps {
	jiraKey: string;
	board: JiraBoard;
	subtasks: Record<string, JiraSubtask>;
	prLinks: Record<string, JiraPrLink[]>;
	onSubtaskCreated: () => void;
}

const SUBTASK_STATUS_COLORS: Record<JiraSubtask["status"], string> = {
	backlog: "text-text-tertiary",
	in_progress: "text-status-blue",
	review: "text-status-orange",
	done: "text-status-green",
};

export function JiraCardDetailView({
	jiraKey,
	board,
	subtasks,
	prLinks,
	onSubtaskCreated,
}: JiraCardDetailViewProps): React.ReactElement {
	const trpc = getRuntimeTrpcClient(null);

	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [selectedSubtaskId, setSelectedSubtaskId] = useState<string | null>(null);
	const [activeSession, setActiveSession] = useState<{ subtaskId: string; workspaceId: string } | null>(null);
	const [sessionSummary, setSessionSummary] = useState<RuntimeTaskSessionSummary | null>(null);
	const [issueData, setIssueData] = useState<IssueData | null>(null);
	const [isLoadingIssue, setIsLoadingIssue] = useState(false);
	const [isStartingSession, setIsStartingSession] = useState(false);
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
	const [isDescriptionTruncated, setIsDescriptionTruncated] = useState(false);
	const descriptionRef = useRef<HTMLDivElement>(null);

	const card = board.cards.find((c) => c.jiraKey === jiraKey);
	const cardSubtasks = (card?.subtaskIds ?? []).map((id) => subtasks[id]).filter((s): s is JiraSubtask => Boolean(s));
	const cardPrLinks = prLinks[jiraKey] ?? [];

	const fetchIssue = useCallback(async () => {
		setIsLoadingIssue(true);
		try {
			const data = await trpc.jira.fetchIssue.query({ jiraKey });
			setIssueData(data);
		} finally {
			setIsLoadingIssue(false);
		}
	}, [trpc, jiraKey]);

	useEffect(() => {
		if (jiraKey) {
			void fetchIssue();
		}
	}, [fetchIssue, jiraKey]);

	useEffect(() => {
		setSelectedSubtaskId(null);
		setActiveSession(null);
		setSessionSummary(null);
		setIssueData(null);
		setIsDescriptionExpanded(false);
		setIsDescriptionTruncated(false);
	}, [jiraKey]);

	useLayoutEffect(() => {
		const el = descriptionRef.current;
		if (!el) return;
		setIsDescriptionTruncated(el.scrollHeight > el.clientHeight + 1);
	}, [issueData?.description]);

	const handleSubtaskClick = useCallback(
		async (subtask: JiraSubtask) => {
			if (selectedSubtaskId === subtask.id) {
				setSelectedSubtaskId(null);
				setActiveSession(null);
				setSessionSummary(null);
				return;
			}
			setSelectedSubtaskId(subtask.id);
			setIsStartingSession(true);
			try {
				const result = await trpc.jira.startSubtaskSession.mutate({ subtaskId: subtask.id });
				setActiveSession({ subtaskId: subtask.id, workspaceId: result.workspaceId });
			} finally {
				setIsStartingSession(false);
			}
		},
		[selectedSubtaskId, trpc],
	);

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
									<div
										ref={descriptionRef}
										className="overflow-hidden"
										style={{
											maxHeight: isDescriptionExpanded
												? `${descriptionRef.current?.scrollHeight ?? 9999}px`
												: "4.5rem",
											transition: "max-height 0.3s ease",
										}}
									>
										<MarkdownText>{issueData.description}</MarkdownText>
									</div>
									{(isDescriptionTruncated || isDescriptionExpanded) && (
										<button
											type="button"
											onClick={() => setIsDescriptionExpanded((v) => !v)}
											aria-expanded={isDescriptionExpanded}
											aria-label={isDescriptionExpanded ? "Collapse description" : "Expand description"}
											className="mt-1 text-xs text-text-tertiary hover:text-text-secondary"
										>
											{isDescriptionExpanded ? "Show less" : "Show more"}
										</button>
									)}
								</div>
							)}
						</>
					)}
				</div>

				<div className="flex flex-col gap-1 p-3">
					{cardPrLinks.length > 0 && (
						<div className="mb-3">
							<div className="mb-1 flex items-center justify-between">
								<span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
									Pull Requests
								</span>
							</div>
							{cardPrLinks.map((pr) => (
								<button
									key={pr.id}
									type="button"
									aria-label={`Open PR: ${pr.title}`}
									onClick={() => window.open(pr.prUrl, "_blank", "noopener,noreferrer")}
									className="group flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
								>
									<GitPullRequest size={14} className="mt-0.5 shrink-0 text-status-purple" />
									<div className="flex flex-col gap-0.5 min-w-0">
										<span className="truncate text-sm text-text-primary group-hover:text-accent">
											{pr.title}
										</span>
										<span className="truncate text-xs text-text-tertiary">
											{pr.repoName} · {pr.headRefName}
										</span>
									</div>
								</button>
							))}
						</div>
					)}
					<div className="mb-1 flex items-center justify-between">
						<span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Subtasks</span>
					</div>
					{cardSubtasks.length === 0 && (
						<p className="text-xs text-text-tertiary">No subtasks yet. Add one below.</p>
					)}
					{cardSubtasks.map((subtask) => (
						<button
							key={subtask.id}
							type="button"
							disabled={isStartingSession}
							onClick={() => void handleSubtaskClick(subtask)}
							className={cn(
								"flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60",
								selectedSubtaskId === subtask.id && "bg-surface-2",
							)}
						>
							<span className={cn("shrink-0 text-xs font-medium", SUBTASK_STATUS_COLORS[subtask.status])}>
								{subtask.status}
							</span>
							<span className="flex-1 truncate text-sm text-text-primary">{subtask.repoId}</span>
							<span className="truncate font-mono text-xs text-text-tertiary">{subtask.branchName}</span>
						</button>
					))}
					<Button
						variant="ghost"
						size="sm"
						icon={<Plus size={14} />}
						className="mt-2 w-full justify-start"
						onClick={() => setCreateDialogOpen(true)}
					>
						Add Subtask
					</Button>
				</div>
			</div>

			{activeSession && (
				<div className="flex-1 overflow-hidden border-t border-border">
					<AgentTerminalPanel
						taskId={activeSession.subtaskId}
						workspaceId={activeSession.workspaceId}
						summary={sessionSummary}
						onSummary={setSessionSummary}
						showSessionToolbar={false}
						showMoveToTrash={false}
					/>
				</div>
			)}

			<SubtaskCreateDialog
				jiraKey={jiraKey}
				open={createDialogOpen}
				onClose={() => setCreateDialogOpen(false)}
				onCreated={() => {
					onSubtaskCreated();
					setCreateDialogOpen(false);
				}}
			/>
		</div>
	);
}
