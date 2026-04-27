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
import { listAuthoredGhPullRequestsForProject } from "../../../src/jira/jira-pr-scan";

const SAMPLE_OPEN_PRS: GhPullRequest[] = [
	{
		number: 42,
		title: "Fix POL-123 login bug",
		url: "https://github.com/org/repo/pull/42",
		headRefName: "feature/pol-123-login-fix",
		isDraft: false,
		state: "OPEN",
		repository: { nameWithOwner: "org/repo" },
	},
	{
		number: 57,
		title: "POL-456 add dashboard",
		url: "https://github.com/org/repo/pull/57",
		headRefName: "feature/pol-456-dashboard",
		isDraft: true,
		state: "OPEN",
		repository: { nameWithOwner: "org/repo" },
	},
];

const SAMPLE_MERGED_PR: GhPullRequest = {
	number: 30,
	title: "POL-100 initial setup",
	url: "https://github.com/org/repo/pull/30",
	headRefName: "feature/pol-100-setup",
	isDraft: false,
	state: "MERGED",
	repository: { nameWithOwner: "org/repo" },
};

function graphqlResponse(open: (GhPullRequest | null)[], closed: (GhPullRequest | null)[]) {
	return { data: { open: { nodes: open }, closed: { nodes: closed } } };
}

describe("listAuthoredGhPullRequestsForProject", () => {
	beforeEach(() => {
		childProcessMocks.execFile.mockReset();
		childProcessMocks.execFilePromise.mockReset();
	});

	it("returns parsed open pull requests on happy path", async () => {
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(graphqlResponse(SAMPLE_OPEN_PRS, [])),
			stderr: "",
		});

		const result = await listAuthoredGhPullRequestsForProject("POL");

		expect(result).toEqual(SAMPLE_OPEN_PRS);
	});

	it("includes merged PRs from closed bucket", async () => {
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(graphqlResponse(SAMPLE_OPEN_PRS, [SAMPLE_MERGED_PR])),
			stderr: "",
		});

		const result = await listAuthoredGhPullRequestsForProject("POL");

		expect(result).toHaveLength(3);
		const merged = result.find((pr) => pr.url === SAMPLE_MERGED_PR.url);
		expect(merged?.state).toBe("MERGED");
	});

	it("deduplicates by URL — open bucket takes precedence", async () => {
		// Same URL in both open and closed (edge case)
		const inClosed = { ...SAMPLE_OPEN_PRS[0], state: "CLOSED" as const };
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(graphqlResponse(SAMPLE_OPEN_PRS, [inClosed])),
			stderr: "",
		});

		const result = await listAuthoredGhPullRequestsForProject("POL");

		// URL appears only once and retains "OPEN" state from open bucket
		const matching = result.filter((pr) => pr.url === SAMPLE_OPEN_PRS[0]?.url);
		expect(matching).toHaveLength(1);
		expect(matching[0]?.state).toBe("OPEN");
	});

	it("returns empty array when both buckets are empty", async () => {
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(graphqlResponse([], [])),
			stderr: "",
		});

		const result = await listAuthoredGhPullRequestsForProject("POL");

		expect(result).toEqual([]);
	});

	it("filters out null nodes from GraphQL sparse results", async () => {
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(graphqlResponse([SAMPLE_OPEN_PRS[0], null, SAMPLE_OPEN_PRS[1]], [null])),
			stderr: "",
		});

		const result = await listAuthoredGhPullRequestsForProject("POL");

		expect(result).toEqual(SAMPLE_OPEN_PRS);
	});

	it("throws a clear error when gh CLI is not found (ENOENT)", async () => {
		const enoentError = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
		childProcessMocks.execFilePromise.mockRejectedValueOnce(enoentError);

		await expect(listAuthoredGhPullRequestsForProject("POL")).rejects.toThrow(
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

		await expect(listAuthoredGhPullRequestsForProject("POL")).rejects.toThrow(stderrMessage);
	});

	it("includes project key in the GraphQL query sent to gh", async () => {
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(graphqlResponse([], [])),
			stderr: "",
		});

		await listAuthoredGhPullRequestsForProject("POL");

		const callArgs: string[] = childProcessMocks.execFilePromise.mock.calls[0][1] as string[];
		const queryArg = callArgs.find((a) => a.startsWith("query=")) ?? "";
		expect(queryArg).toContain("in:title POL");
	});

	it("throws for invalid project key to prevent injection", async () => {
		await expect(listAuthoredGhPullRequestsForProject("pol lower")).rejects.toThrow("Invalid Jira project key");
		await expect(listAuthoredGhPullRequestsForProject("")).rejects.toThrow("Invalid Jira project key");
	});

	it("preserves isDraft and state fields from GraphQL response", async () => {
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(graphqlResponse(SAMPLE_OPEN_PRS, [])),
			stderr: "",
		});

		const result = await listAuthoredGhPullRequestsForProject("POL");

		expect(result[0]?.isDraft).toBe(false);
		expect(result[0]?.state).toBe("OPEN");
		expect(result[1]?.isDraft).toBe(true);
		expect(result[1]?.state).toBe("OPEN");
	});
});
