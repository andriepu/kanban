import { GitPullRequest, Trash2 } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { ColumnIndicator } from "@/components/ui/column-indicator";
import { Spinner } from "@/components/ui/spinner";
import type { UseJiraBoardResult } from "@/hooks/use-jira-board";
import type { JiraCard, JiraCardStatus, JiraPullRequest } from "@/types/jira";

const COLUMNS: Array<{ id: JiraCardStatus; label: string }> = [
	{ id: "todo", label: "To-Do" },
	{ id: "in_progress", label: "In-Progress" },
	{ id: "done", label: "Trash" },
];

type PrAggregate = { count: number; state: "open" | "draft" | "merged" };

const PILL_CLASSES: Record<PrAggregate["state"], string> = {
	open: "bg-status-green/15 text-status-green",
	draft: "bg-text-secondary/15 text-text-secondary",
	merged: "bg-status-purple/15 text-status-purple",
};

function aggregatePrState(pullRequests: JiraPullRequest[]): PrAggregate {
	const prPullRequests = pullRequests.filter((s) => s.prUrl !== undefined);
	const count = prPullRequests.length;
	if (count === 0) return { count: 0, state: "open" };

	const states = prPullRequests.map((s) => s.prState ?? "open");
	if (states.some((s) => s === "open")) return { count, state: "open" };
	if (states.some((s) => s === "draft")) return { count, state: "draft" };
	return { count, state: "merged" };
}

interface JiraBoardViewProps {
	onCardClick: (jiraKey: string) => void;
	selectedJiraKey: string | null;
	jiraBoard: UseJiraBoardResult;
}

export function JiraBoardView({ onCardClick, selectedJiraKey, jiraBoard }: JiraBoardViewProps): React.ReactElement {
	const { board, pullRequests, isLoading, isImporting, moveCard, deleteCard } = jiraBoard;

	if (isLoading) {
		return <div className="flex h-full flex-1 items-center justify-center text-text-secondary text-sm">Loading…</div>;
	}

	return (
		<div className="flex h-full flex-1 flex-col overflow-hidden">
			<div className="flex flex-1 gap-2 overflow-x-auto p-2 min-h-0">
				{COLUMNS.map((col) => {
					const cards = board.cards.filter((c) => c.status === col.id);
					return (
						<JiraBoardColumn
							key={col.id}
							columnId={col.id}
							label={col.label}
							cards={cards}
							prAggregates={Object.fromEntries(
								cards.map((c) => [
									c.jiraKey,
									aggregatePrState(
										(c.pullRequestIds ?? [])
											.map((id) => pullRequests[id])
											.filter((s): s is JiraPullRequest => Boolean(s)),
									),
								]),
							)}
							selectedJiraKey={selectedJiraKey}
							onCardClick={onCardClick}
							onDrop={(jiraKey) => moveCard(jiraKey, col.id)}
							onDelete={deleteCard}
						/>
					);
				})}
			</div>
			{isImporting && (
				<div className="h-7 flex items-center gap-1.5 px-4 border-t border-border bg-surface-1 text-xs text-text-secondary shrink-0">
					<Spinner size={12} />
					Syncing JIRA tasks…
				</div>
			)}
		</div>
	);
}

function JiraBoardColumn({
	columnId,
	label,
	cards,
	prAggregates,
	selectedJiraKey,
	onCardClick,
	onDrop,
	onDelete,
}: {
	columnId: string;
	label: string;
	cards: JiraCard[];
	prAggregates: Record<string, PrAggregate>;
	selectedJiraKey: string | null;
	onCardClick: (jiraKey: string) => void;
	onDrop: (jiraKey: string) => void;
	onDelete: (jiraKey: string) => void;
}): React.ReactElement {
	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
	};

	const handleDrop = (e: React.DragEvent) => {
		const jiraKey = e.dataTransfer.getData("jiraKey");
		if (jiraKey) onDrop(jiraKey);
	};

	return (
		<div
			className="flex flex-1 min-w-56 min-h-0 flex-col rounded-lg bg-surface-1 overflow-hidden border border-border"
			onDragOver={handleDragOver}
			onDrop={handleDrop}
		>
			<div className="flex h-10 items-center justify-between px-3">
				<div className="flex items-center gap-1.5">
					<ColumnIndicator columnId={columnId} />
					<span className="font-semibold text-sm">{label}</span>
				</div>
				<span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-tertiary">{cards.length}</span>
			</div>
			<div className="flex flex-col gap-2 p-1.5 overflow-y-auto min-h-0">
				{cards.map((card) => (
					<JiraBoardCard
						key={card.jiraKey}
						card={card}
						prAggregate={prAggregates[card.jiraKey] ?? { count: 0, state: "open" }}
						isSelected={selectedJiraKey === card.jiraKey}
						onClick={() => onCardClick(card.jiraKey)}
						onDelete={card.status === "done" ? () => onDelete(card.jiraKey) : undefined}
					/>
				))}
			</div>
		</div>
	);
}

function JiraBoardCard({
	card,
	prAggregate,
	isSelected,
	onClick,
	onDelete,
}: {
	card: JiraCard;
	prAggregate: PrAggregate;
	isSelected: boolean;
	onClick: () => void;
	onDelete?: () => void;
}): React.ReactElement {
	const isTrash = card.status === "done";

	const handleDragStart = (e: React.DragEvent) => {
		e.dataTransfer.setData("jiraKey", card.jiraKey);
		e.dataTransfer.effectAllowed = "move";
	};

	return (
		<button
			type="button"
			draggable
			onDragStart={handleDragStart}
			onClick={onClick}
			className={cn(
				"w-full cursor-pointer rounded-md bg-surface-2 p-3 text-left transition-colors hover:bg-surface-3",
				isSelected && "ring-2 ring-accent",
			)}
		>
			<div className="flex items-start justify-between gap-2">
				<span
					className={cn(
						"rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs",
						isTrash ? "text-text-tertiary line-through" : "text-text-secondary",
					)}
				>
					{card.jiraKey}
				</span>
				<div className="flex items-center gap-1">
					{prAggregate.count > 0 && (
						<span
							className={cn(
								"flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
								PILL_CLASSES[prAggregate.state],
							)}
						>
							<GitPullRequest size={10} />
							{prAggregate.count} {prAggregate.count === 1 ? "pull request" : "pull requests"}
						</span>
					)}
					{onDelete !== undefined && (
						<button
							type="button"
							aria-label="Delete card"
							onClick={(e) => {
								e.stopPropagation();
								onDelete();
							}}
							className="rounded p-0.5 text-text-tertiary hover:bg-surface-4 hover:text-status-red transition-colors"
						>
							<Trash2 size={13} />
						</button>
					)}
				</div>
			</div>
			<p className={cn("mt-2 text-sm", isTrash ? "text-text-tertiary line-through" : "text-text-primary")}>
				{card.summary}
			</p>
		</button>
	);
}
