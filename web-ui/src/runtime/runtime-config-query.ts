// Browser-side query helpers for runtime settings.
// Keep TRPC request details here so components and controller hooks can focus
// on state orchestration instead of transport plumbing.
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeAgentId,
	RuntimeConfigResponse,
	RuntimeDebugResetAllStateResponse,
	RuntimeProjectShortcut,
} from "@/runtime/types";

export async function fetchRuntimeConfig(workspaceId: string | null): Promise<RuntimeConfigResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getConfig.query();
}

export async function saveRuntimeConfig(
	workspaceId: string | null,
	nextConfig: {
		selectedAgentId?: RuntimeAgentId;
		selectedShortcutLabel?: string | null;
		agentAutonomousModeEnabled?: boolean;
		shortcuts?: RuntimeProjectShortcut[];
		readyForReviewNotificationsEnabled?: boolean;
		commitPromptTemplate?: string;
		openPrPromptTemplate?: string;
		worktreesRoot?: string | null;
		reposRoot?: string | null;
		jiraProjectKey?: string | null;
		jiraBaseUrl?: string | null;
		jiraEmail?: string | null;
		jiraSyncIntervalMs?: number | null;
		jiraBaseUrl?: string | null;
		jiraEmail?: string | null;
	},
): Promise<RuntimeConfigResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveConfig.mutate(nextConfig);
}

export async function resetRuntimeDebugState(workspaceId: string | null): Promise<RuntimeDebugResetAllStateResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.resetAllState.mutate();
}

export async function openFileOnHost(workspaceId: string | null, filePath: string): Promise<void> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	await trpcClient.runtime.openFile.mutate({ filePath });
}

/**
 * Opens the OS native directory picker and returns the selected path,
 * or null if the user cancelled or the picker is unavailable.
 */
export async function pickDirectoryOnHost(workspaceId: string | null): Promise<string | null> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	const result = await trpcClient.projects.pickDirectory.mutate();
	if (result.ok && result.path) {
		return result.path;
	}
	return null;
}

export async function syncReposRoot(workspaceId: string | null): Promise<{ added: number; skipped: number }> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.projects.syncFromReposRoot.mutate();
}

export async function setJiraApiToken(
	workspaceId: string | null,
	token: string | null,
): Promise<{ configured: boolean }> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.jira.setApiToken.mutate({ token });
}
