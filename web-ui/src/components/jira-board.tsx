interface JiraBoardViewProps {
	onCardClick: (jiraKey: string) => void;
	selectedJiraKey: string | null;
}

export function JiraBoardView(_props: JiraBoardViewProps) {
	return <div className="flex-1 p-4 text-text-secondary text-sm">Jira board loading…</div>;
}
