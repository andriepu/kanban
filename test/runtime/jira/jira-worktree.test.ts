import type { readdir as ReaddirFn } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	buildPullRequestWorktreePath,
	derivePullRequestBranchName,
	scanReposInRoot,
} from "../../../src/jira/jira-worktree.js";

describe("derivePullRequestBranchName", () => {
	it("creates kebab branch name with jiraKey prefix", () => {
		expect(derivePullRequestBranchName("POL-1234", "Fix the Login Bug")).toBe("POL-1234-fix-the-login-bug");
	});

	it("truncates to 63 chars total", () => {
		const branch = derivePullRequestBranchName("POL-1", "A".repeat(100));
		expect(branch.length).toBeLessThanOrEqual(63);
		expect(branch.startsWith("POL-1-")).toBe(true);
	});

	it("strips leading/trailing hyphens from slug", () => {
		const branch = derivePullRequestBranchName("POL-1", "  Fix (auth) flow!  ");
		expect(branch).toBe("POL-1-fix-auth-flow");
	});
});

describe("buildPullRequestWorktreePath", () => {
	it("constructs correct path", () => {
		const p = buildPullRequestWorktreePath("/work", "POL-1", "my-repo", "POL-1-fix-login");
		expect(p).toBe(path.join("/work", "POL-1", "my-repo__POL-1-fix-login"));
	});
});

describe("scanReposInRoot", () => {
	it("returns git repos found 1 level deep", async () => {
		const mockReaddir = vi.fn().mockResolvedValue([
			{ name: "repo-a", isDirectory: () => true },
			{ name: "file.txt", isDirectory: () => false },
			{ name: "repo-b", isDirectory: () => true },
		]);
		const mockAccess = vi.fn().mockImplementation((p: string) => {
			if (p.includes("repo-b")) return Promise.reject(new Error("ENOENT"));
			return Promise.resolve();
		});

		const repos = await scanReposInRoot("/repos", {
			readdir: mockReaddir as unknown as typeof ReaddirFn,
			access: mockAccess,
		});
		expect(repos).toEqual([{ id: "repo-a", path: path.join("/repos", "repo-a") }]);
	});

	it("returns empty array when reposRoot does not exist", async () => {
		const mockReaddir = vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
		const repos = await scanReposInRoot("/nonexistent", {
			readdir: mockReaddir as unknown as typeof ReaddirFn,
		});
		expect(repos).toEqual([]);
	});
});
