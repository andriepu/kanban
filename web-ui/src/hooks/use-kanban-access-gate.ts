interface UseKanbanAccessGateInput {
	workspaceId: string | null;
}

export function useKanbanAccessGate(_input: UseKanbanAccessGateInput): { isBlocked: boolean } {
	return { isBlocked: false };
}
