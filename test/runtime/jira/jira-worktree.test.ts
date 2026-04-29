import type { readdir as ReaddirFn } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	buildPullRequestWorktreePath,
	derivePullRequestBranchName,
	ensureJiraCardWorktreeParent,
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

describe("ensureJiraCardWorktreeParent", () => {
	it("creates the directory and returns its absolute path", async () => {
		const base = await fs.mkdtemp(path.join(tmpdir(), "kanban-test-"));
		try {
			const result = await ensureJiraCardWorktreeParent({ worktreesRoot: base, jiraKey: "POL-1234" });
			expect(result.parentPath).toBe(path.join(base, "POL-1234"));
			const stat = await fs.stat(result.parentPath);
			expect(stat.isDirectory()).toBe(true);
		} finally {
			await fs.rm(base, { recursive: true, force: true });
		}
	});

	it("is idempotent when directory already exists", async () => {
		const base = await fs.mkdtemp(path.join(tmpdir(), "kanban-test-"));
		try {
			await ensureJiraCardWorktreeParent({ worktreesRoot: base, jiraKey: "POL-5" });
			const result = await ensureJiraCardWorktreeParent({ worktreesRoot: base, jiraKey: "POL-5" });
			expect(result.parentPath).toBe(path.join(base, "POL-5"));
		} finally {
			await fs.rm(base, { recursive: true, force: true });
		}
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
