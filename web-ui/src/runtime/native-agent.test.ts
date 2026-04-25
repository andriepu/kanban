import { describe, expect, it } from "vitest";

import {
	getTaskAgentNavbarHint,
	isTaskAgentSetupSatisfied,
	selectLatestTaskChatMessageForTask,
	selectTaskChatMessagesForTask,
} from "@/runtime/native-agent";
import type { RuntimeConfigResponse, RuntimeStateStreamTaskChatMessage } from "@/runtime/types";

function createRuntimeConfigResponse(
	selectedAgentId: RuntimeConfigResponse["selectedAgentId"],
	overrides?: Partial<RuntimeConfigResponse>,
): RuntimeConfigResponse {
	const nextConfig: RuntimeConfigResponse = {
		selectedAgentId,
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		effectiveCommand: selectedAgentId,
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project/.kanban/config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: ["claude"],
		agents: [
			{
				id: "claude",
				label: "Claude Code",
				binary: "claude",
				command: "claude",
				defaultArgs: [],
				installed: true,
				configured: true,
			},
		],
		shortcuts: [],
		commitPromptTemplate: "",
		openPrPromptTemplate: "",
		commitPromptTemplateDefault: "",
		openPrPromptTemplateDefault: "",
		worktreesRoot: null,
		reposRoot: null,
		jiraProjectKey: null,
		jiraBaseUrl: null,
		jiraEmail: null,
		jiraSyncIntervalMs: 60 * 60 * 1000,
	};
	return {
		...nextConfig,
		...overrides,
	};
}

function createLatestTaskChatMessage(taskId: string): RuntimeStateStreamTaskChatMessage {
	return {
		type: "task_chat_message",
		workspaceId: "workspace-1",
		taskId,
		message: {
			id: "message-1",
			role: "assistant",
			content: "Hello",
			createdAt: Date.now(),
			meta: null,
		},
	};
}

describe("native-agent helpers", () => {
	it("treats selected claude as task-ready when installed", () => {
		expect(isTaskAgentSetupSatisfied(createRuntimeConfigResponse("claude"))).toBe(true);
		expect(isTaskAgentSetupSatisfied(null)).toBeNull();
	});

	it("does not show the navbar setup hint when claude is configured", () => {
		expect(getTaskAgentNavbarHint(createRuntimeConfigResponse("claude"))).toBeUndefined();
	});

	it("shows the navbar setup hint when no task agent path is ready", () => {
		const config = createRuntimeConfigResponse("claude", {
			agents: [
				{
					id: "claude",
					label: "Claude Code",
					binary: "claude",
					command: "claude",
					defaultArgs: [],
					installed: false,
					configured: true,
				},
			],
		});
		expect(getTaskAgentNavbarHint(config)).toBe("No agent configured");
		expect(
			getTaskAgentNavbarHint(config, {
				shouldUseNavigationPath: true,
			}),
		).toBeUndefined();
	});

	it("ignores non-launch agents when checking native CLI availability", () => {
		const config = createRuntimeConfigResponse("claude");
		config.agents = [
			{
				id: "claude",
				label: "Claude Code",
				binary: "claude",
				command: "claude",
				defaultArgs: [],
				installed: false,
				configured: true,
			},
		];
		expect(isTaskAgentSetupSatisfied(config)).toBe(false);
	});

	it("selects the latest incoming chat message only for the matching task", () => {
		const messageEvent = createLatestTaskChatMessage("task-1");
		expect(selectLatestTaskChatMessageForTask("task-1", messageEvent)).toEqual(messageEvent.message);
		expect(selectLatestTaskChatMessageForTask("task-2", messageEvent)).toBeNull();
		expect(selectLatestTaskChatMessageForTask(null, messageEvent)).toBeNull();
	});

	it("selects the streamed task chat transcript for the matching task", () => {
		const messageEvent = createLatestTaskChatMessage("task-1");
		expect(
			selectTaskChatMessagesForTask("task-1", {
				"task-1": [messageEvent.message],
			}),
		).toEqual([messageEvent.message]);
		expect(selectTaskChatMessagesForTask("task-2", { "task-1": [messageEvent.message] })).toBeNull();
		expect(selectTaskChatMessagesForTask(null, { "task-1": [messageEvent.message] })).toBeNull();
	});
});
