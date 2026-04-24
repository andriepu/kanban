import { describe, expect, it, vi } from "vitest";
import { callJiraMcp } from "../../../src/jira/jira-mcp.js";

describe("callJiraMcp", () => {
	it("parses JSON from claude stdout", async () => {
		const mockSpawn = vi.fn().mockResolvedValue({
			stdout: JSON.stringify({ issues: [] }),
			exitCode: 0,
		});
		const result = await callJiraMcp("list issues", { spawnClaude: mockSpawn });
		expect(result).toEqual({ issues: [] });
		expect(mockSpawn).toHaveBeenCalledWith(
			expect.arrayContaining(["-p", "list issues", "--output-format", "json", "--max-turns", "5"]),
		);
	});

	it("throws if claude exits non-zero", async () => {
		const mockSpawn = vi.fn().mockResolvedValue({
			stdout: "",
			exitCode: 1,
			stderr: "something went wrong",
		});
		await expect(callJiraMcp("bad", { spawnClaude: mockSpawn })).rejects.toThrow("claude -p exited with code 1");
	});

	it("throws if stdout is not valid JSON", async () => {
		const mockSpawn = vi.fn().mockResolvedValue({ stdout: "not json", exitCode: 0 });
		await expect(callJiraMcp("p", { spawnClaude: mockSpawn })).rejects.toThrow("Failed to parse");
	});
});
