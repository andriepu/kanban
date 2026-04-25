import type { RuntimeConfigResponse } from "@/runtime/types";

function isBlank(value: string | null | undefined): boolean {
	return !value || value.trim().length === 0;
}

export function shouldShowStartupOnboardingDialog(config: RuntimeConfigResponse | null | undefined): boolean {
	if (!config) return false;
	if (isBlank(config.jiraBaseUrl)) return true;
	if (isBlank(config.jiraEmail)) return true;
	if (config.jiraApiTokenConfigured !== true) return true;
	if (isBlank(config.reposRoot)) return true;
	if (isBlank(config.worktreesRoot)) return true;
	return false;
}
