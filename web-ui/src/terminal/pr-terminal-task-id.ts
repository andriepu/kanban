import type { RuntimeTaskSessionSummary } from "@/runtime/types";

export const PR_TERMINAL_TASK_PREFIX = "__pr_terminal__:";

export function getPrTerminalTaskId(prId: string): string {
	return `${PR_TERMINAL_TASK_PREFIX}${prId}`;
}

export function getStackedPrTerminalTaskIdMatcher(prId: string): (taskId: string) => boolean {
	const stackedPrefix = `${PR_TERMINAL_TASK_PREFIX}${prId}:stacked:`;
	return (taskId) => taskId.startsWith(stackedPrefix);
}

export function parseStackedPrTerminalCounter(taskId: string, prId: string): number | null {
	const prefix = `${PR_TERMINAL_TASK_PREFIX}${prId}:stacked:`;
	if (!taskId.startsWith(prefix)) return null;
	const n = Number(taskId.slice(prefix.length));
	return Number.isInteger(n) && n > 0 ? n : null;
}

export function selectActivePrTerminalSummary(
	sessions: Record<string, RuntimeTaskSessionSummary>,
	prId: string,
): RuntimeTaskSessionSummary | null {
	const primaryKey = getPrTerminalTaskId(prId);
	const isStacked = getStackedPrTerminalTaskIdMatcher(prId);

	const candidates: RuntimeTaskSessionSummary[] = [];
	const primary = sessions[primaryKey];
	if (primary) {
		candidates.push(primary);
	}
	for (const [key, summary] of Object.entries(sessions)) {
		if (isStacked(key)) {
			candidates.push(summary);
		}
	}

	if (candidates.length === 0) {
		return null;
	}

	// Priority: failed > awaiting_review > running > any non-null
	// Tiebreaker within same priority: highest updatedAt then lastOutputAt
	const statePriority = (s: RuntimeTaskSessionSummary): number => {
		if (s.state === "failed") return 0;
		if (s.state === "awaiting_review") return 1;
		if (s.state === "running") return 2;
		return 3;
	};

	candidates.sort((a, b) => {
		const pa = statePriority(a);
		const pb = statePriority(b);
		if (pa !== pb) return pa - pb;
		const ua = a.updatedAt ?? a.lastOutputAt ?? 0;
		const ub = b.updatedAt ?? b.lastOutputAt ?? 0;
		return ub - ua;
	});

	return candidates[0] ?? null;
}
