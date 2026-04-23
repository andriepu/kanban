import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadWorkspaceBoardById } from "../../../src/state/workspace-state";
import { createTempDir } from "../../utilities/temp-dir";

function withHomeEnv(home: string, fn: () => Promise<void>): Promise<void> {
	const prevHome = process.env.HOME;
	const prevUserProfile = process.env.USERPROFILE;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	return fn().finally(() => {
		process.env.HOME = prevHome;
		process.env.USERPROFILE = prevUserProfile;
	});
}

function writeWorkspaceFile(homeDir: string, workspaceId: string, filename: string, content: unknown): void {
	const dir = join(homeDir, ".kanban", "kanban", "workspaces", workspaceId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, filename), JSON.stringify(content));
}

describe("readWorkspaceBoard legacy scrub", () => {
	let tempDir: { path: string; cleanup: () => void };

	beforeEach(() => {
		tempDir = createTempDir("kanban-scrub-board-test-");
	});

	afterEach(() => {
		tempDir.cleanup();
	});

	it("strips clineSettings from board cards", async () => {
		const wsId = "test-workspace";
		writeWorkspaceFile(tempDir.path, wsId, "board.json", {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							id: "task-1",
							prompt: "do the thing",
							startInPlanMode: false,
							autoReviewEnabled: false,
							baseRef: "main",
							createdAt: 1000,
							updatedAt: 2000,
							agentId: "cline",
							clineSettings: { providerId: "openai", modelId: "gpt-4o" },
							clineProviderId: "openai",
							clineModelId: "gpt-4o",
							clineReasoningEffort: "high",
						},
					],
				},
			],
			dependencies: [],
		});

		await withHomeEnv(tempDir.path, async () => {
			const board = await loadWorkspaceBoardById(wsId);
			const card = board.columns[0]?.cards[0];
			expect(card).toBeDefined();
			expect(card).not.toHaveProperty("clineSettings");
			expect(card).not.toHaveProperty("clineProviderId");
			expect(card).not.toHaveProperty("clineModelId");
			expect(card).not.toHaveProperty("clineReasoningEffort");
			expect(card?.agentId).toBeUndefined();
		});
	});

	it("preserves agentId when it is claude", async () => {
		const wsId = "test-workspace-claude";
		writeWorkspaceFile(tempDir.path, wsId, "board.json", {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							id: "task-2",
							prompt: "do something",
							startInPlanMode: false,
							autoReviewEnabled: false,
							baseRef: "main",
							createdAt: 1000,
							updatedAt: 2000,
							agentId: "claude",
						},
					],
				},
			],
			dependencies: [],
		});

		await withHomeEnv(tempDir.path, async () => {
			const board = await loadWorkspaceBoardById(wsId);
			const card = board.columns[0]?.cards[0];
			expect(card?.agentId).toBe("claude");
		});
	});

	it("strips agentId for all non-claude agent ids", async () => {
		const wsId = "test-workspace-agents";
		const nonClaudeAgents = ["codex", "gemini", "opencode", "droid", "kiro"];
		writeWorkspaceFile(tempDir.path, wsId, "board.json", {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: nonClaudeAgents.map((agentId, i) => ({
						id: `task-${i}`,
						prompt: `task ${i}`,
						startInPlanMode: false,
						autoReviewEnabled: false,
						baseRef: "main",
						createdAt: 1000,
						updatedAt: 2000,
						agentId,
					})),
				},
			],
			dependencies: [],
		});

		await withHomeEnv(tempDir.path, async () => {
			const board = await loadWorkspaceBoardById(wsId);
			for (const card of board.columns[0]?.cards ?? []) {
				expect(card.agentId).toBeUndefined();
			}
		});
	});

	it("returns empty board when file is missing", async () => {
		const wsId = "empty-workspace";
		mkdirSync(join(tempDir.path, ".kanban", "kanban", "workspaces", wsId), { recursive: true });

		await withHomeEnv(tempDir.path, async () => {
			const board = await loadWorkspaceBoardById(wsId);
			expect(board.columns.length).toBeGreaterThan(0);
			for (const col of board.columns) {
				expect(col.cards).toHaveLength(0);
			}
		});
	});
});
