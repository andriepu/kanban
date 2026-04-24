import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { UseJiraBoardResult } from "@/hooks/use-jira-board";
import type { JiraCard, JiraCardStatus } from "@/types/jira";

const COLUMNS: Array<{ id: JiraCardStatus; label: string }> = [
	{ id: "todo", label: "To-Do" },
	{ id: "in_progress", label: "In-Progress" },
	{ id: "done", label: "Done" },
];

interface JiraBoardViewProps {
	onCardClick: (jiraKey: string) => void;
	selectedJiraKey: string | null;
	jiraBoard: UseJiraBoardResult;
}

export function JiraBoardView({ onCardClick, selectedJiraKey, jiraBoard }: JiraBoardViewProps): React.ReactElement {
	const { board, isLoading, isImporting, importFromJira, moveCard } = jiraBoard;

	return (
		<div className="flex h-full flex-col">
			{/* Top bar */}
			<div className="flex items-center justify-between border-b border-border px-4 py-2">
				<span className="text-sm font-medium text-text-primary">Jira Board</span>
				<Button
					variant="default"
					size="sm"
					icon={<Download size={14} />}
					onClick={importFromJira}
					disabled={isImporting}
				>
					{isImporting ? "Importing…" : "Import To-Do"}
				</Button>
			</div>

			{/* Columns */}
			{isLoading ? (
				<div className="flex flex-1 items-center justify-center text-text-secondary text-sm">Loading…</div>
			) : (
				<div className="flex flex-1 gap-3 overflow-x-auto p-4">
					{COLUMNS.map((col) => {
						const cards = board.cards.filter((c) => c.status === col.id);
						return (
							<JiraBoardColumn
								key={col.id}
								label={col.label}
								cards={cards}
								subtaskCounts={Object.fromEntries(cards.map((c) => [c.jiraKey, c.subtaskIds.length]))}
								selectedJiraKey={selectedJiraKey}
								onCardClick={onCardClick}
								onDrop={(jiraKey) => moveCard(jiraKey, col.id)}
							/>
						);
					})}
				</div>
			)}
		</div>
	);
}

function JiraBoardColumn({
	label,
	cards,
	subtaskCounts,
	selectedJiraKey,
	onCardClick,
	onDrop,
}: {
	label: string;
	cards: JiraCard[];
	subtaskCounts: Record<string, number>;
	selectedJiraKey: string | null;
	onCardClick: (jiraKey: string) => void;
	onDrop: (jiraKey: string) => void;
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
			className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-surface-1 p-3"
			onDragOver={handleDragOver}
			onDrop={handleDrop}
		>
			<div className="flex items-center justify-between">
				<span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</span>
				<span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-tertiary">{cards.length}</span>
			</div>
			<div className="flex flex-col gap-2">
				{cards.map((card) => (
					<JiraBoardCard
						key={card.jiraKey}
						card={card}
						subtaskCount={subtaskCounts[card.jiraKey] ?? 0}
						isSelected={selectedJiraKey === card.jiraKey}
						onClick={() => onCardClick(card.jiraKey)}
					/>
				))}
			</div>
		</div>
	);
}

function JiraBoardCard({
	card,
	subtaskCount,
	isSelected,
	onClick,
}: {
	card: JiraCard;
	subtaskCount: number;
	isSelected: boolean;
	onClick: () => void;
}): React.ReactElement {
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
				<span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-text-secondary">
					{card.jiraKey}
				</span>
				{subtaskCount > 0 && (
					<span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
						{subtaskCount} {subtaskCount === 1 ? "subtask" : "subtasks"}
					</span>
				)}
			</div>
			<p className="mt-2 text-sm text-text-primary">{card.summary}</p>
		</button>
	);
}
