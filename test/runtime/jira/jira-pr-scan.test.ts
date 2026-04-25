import { promisify } from "node:util";

import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
	execFile: vi.fn(),
	execFilePromise: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFile: Object.assign(childProcessMocks.execFile, {
		[promisify.custom]: childProcessMocks.execFilePromise,
	}),
}));

import type { GhPullRequest } from "../../../src/jira/jira-pr-scan";
import { listOpenAuthoredGhPullRequests } from "../../../src/jira/jira-pr-scan";

const EXPECTED_ARGS = [
	"search",
	"prs",
	"--author=@me",
	"--state=open",
	"--json",
	"number,title,url,headRefName,repository",
	"--limit",
	"100",
];

const SAMPLE_PRS: GhPullRequest[] = [
	{
		number: 42,
		title: "Fix POL-123 login bug",
		url: "https://github.com/org/repo/pull/42",
		headRefName: "feature/pol-123-login-fix",
		repository: { nameWithOwner: "org/repo" },
	},
	{
		number: 57,
		title: "POL-456 add dashboard",
		url: "https://github.com/org/repo/pull/57",
		headRefName: "feature/pol-456-dashboard",
		repository: { nameWithOwner: "org/repo" },
	},
];

describe("listOpenAuthoredGhPullRequests", () => {
	beforeEach(() => {
		childProcessMocks.execFile.mockReset();
		childProcessMocks.execFilePromise.mockReset();
	});

	it("returns parsed pull requests on happy path", async () => {
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(SAMPLE_PRS),
			stderr: "",
		});

		const result = await listOpenAuthoredGhPullRequests();

		expect(result).toEqual(SAMPLE_PRS);
	});

	it("returns empty array when stdout is empty array", async () => {
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: "[]",
			stderr: "",
		});

		const result = await listOpenAuthoredGhPullRequests();

		expect(result).toEqual([]);
	});

	it("throws a clear error when gh CLI is not found (ENOENT)", async () => {
		const enoentError = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
		childProcessMocks.execFilePromise.mockRejectedValueOnce(enoentError);

		await expect(listOpenAuthoredGhPullRequests()).rejects.toThrow(
			"gh CLI not found. Install GitHub CLI (gh) to use PR scan.",
		);
	});

	it("throws with stderr content when gh exits non-zero", async () => {
		const stderrMessage = "gh: no pull requests found matching filter";
		const exitError = Object.assign(new Error("Command failed"), {
			code: 1,
			stderr: stderrMessage,
		});
		childProcessMocks.execFilePromise.mockRejectedValueOnce(exitError);

		await expect(listOpenAuthoredGhPullRequests()).rejects.toThrow(stderrMessage);
	});

	it("invokes the exact expected gh command", async () => {
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: "[]",
			stderr: "",
		});

		await listOpenAuthoredGhPullRequests();

		expect(childProcessMocks.execFilePromise).toHaveBeenCalledWith(
			"gh",
			EXPECTED_ARGS,
			expect.objectContaining({ encoding: "utf8" }),
		);
	});
});
