import { describe, expect, it } from "vitest";

import type { RuntimeConfigResponse } from "@/runtime/types";

import { shouldShowStartupOnboardingDialog } from "./onboarding";

function makeConfig(overrides: Partial<RuntimeConfigResponse> = {}): RuntimeConfigResponse {
	return {
		selectedAgentId: "claude",
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		effectiveCommand: "claude",
		globalConfigPath: "/home/user/.kanban/kanban/config.json",
		repoConfigPath: null,
		readyForReviewNotificationsEnabled: true,
		detectedCommands: ["claude"],
		agents: [],
		shortcuts: [],
		commitPromptTemplate: "",
		openPrPromptTemplate: "",
		commitPromptTemplateDefault: "",
		openPrPromptTemplateDefault: "",
		worktreesRoot: "/home/user/worktrees",
		reposRoot: "/home/user/repos",
		jiraProjectKey: null,
		jiraSyncIntervalMs: 3600000,
		jiraBaseUrl: "your-team.atlassian.net",
		jiraEmail: "user@example.com",
		jiraApiTokenConfigured: true,
		...overrides,
	};
}

describe("shouldShowStartupOnboardingDialog", () => {
	it("returns false for null config", () => {
		expect(shouldShowStartupOnboardingDialog(null)).toBe(false);
	});

	it("returns false for undefined config", () => {
		expect(shouldShowStartupOnboardingDialog(undefined)).toBe(false);
	});

	it("returns false when all required fields are set", () => {
		expect(shouldShowStartupOnboardingDialog(makeConfig())).toBe(false);
	});

	it("returns true when jiraBaseUrl is null", () => {
		expect(shouldShowStartupOnboardingDialog(makeConfig({ jiraBaseUrl: null }))).toBe(true);
	});

	it("returns true when jiraBaseUrl is empty string", () => {
		expect(shouldShowStartupOnboardingDialog(makeConfig({ jiraBaseUrl: "" }))).toBe(true);
	});

	it("returns true when jiraBaseUrl is whitespace only", () => {
		expect(shouldShowStartupOnboardingDialog(makeConfig({ jiraBaseUrl: "   " }))).toBe(true);
	});

	it("returns true when jiraEmail is null", () => {
		expect(shouldShowStartupOnboardingDialog(makeConfig({ jiraEmail: null }))).toBe(true);
	});

	it("returns true when jiraEmail is empty string", () => {
		expect(shouldShowStartupOnboardingDialog(makeConfig({ jiraEmail: "" }))).toBe(true);
	});

	it("returns true when jiraApiTokenConfigured is false", () => {
		expect(shouldShowStartupOnboardingDialog(makeConfig({ jiraApiTokenConfigured: false }))).toBe(true);
	});

	it("returns true when reposRoot is null", () => {
		expect(shouldShowStartupOnboardingDialog(makeConfig({ reposRoot: null }))).toBe(true);
	});

	it("returns true when reposRoot is empty string", () => {
		expect(shouldShowStartupOnboardingDialog(makeConfig({ reposRoot: "" }))).toBe(true);
	});

	it("returns true when worktreesRoot is null", () => {
		expect(shouldShowStartupOnboardingDialog(makeConfig({ worktreesRoot: null }))).toBe(true);
	});

	it("returns true when worktreesRoot is empty string", () => {
		expect(shouldShowStartupOnboardingDialog(makeConfig({ worktreesRoot: "" }))).toBe(true);
	});

	it("returns true when all required fields are missing", () => {
		expect(
			shouldShowStartupOnboardingDialog(
				makeConfig({
					jiraBaseUrl: null,
					jiraEmail: null,
					jiraApiTokenConfigured: false,
					reposRoot: null,
					worktreesRoot: null,
				}),
			),
		).toBe(true);
	});
});
