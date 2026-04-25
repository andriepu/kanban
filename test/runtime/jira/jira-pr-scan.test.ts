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
import { GH_PR_GRAPHQL_QUERY, listOpenAuthoredGhPullRequests } from "../../../src/jira/jira-pr-scan";

const SAMPLE_PRS: GhPullRequest[] = [
	{
		number: 42,
		title: "Fix POL-123 login bug",
		url: "https://github.com/org/repo/pull/42",
		headRefName: "feature/pol-123-login-fix",
		isDraft: false,
		repository: { nameWithOwner: "org/repo" },
	},
	{
		number: 57,
		title: "POL-456 add dashboard",
		url: "https://github.com/org/repo/pull/57",
		headRefName: "feature/pol-456-dashboard",
		isDraft: true,
		repository: { nameWithOwner: "org/repo" },
	},
];

function graphqlResponse(nodes: (GhPullRequest | null)[]) {
	return { data: { search: { nodes } } };
}

describe("listOpenAuthoredGhPullRequests", () => {
	beforeEach(() => {
		childProcessMocks.execFile.mockReset();
		childProcessMocks.execFilePromise.mockReset();
	});

	it("returns parsed pull requests on happy path", async () => {
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(graphqlResponse(SAMPLE_PRS)),
			stderr: "",
		});

		const result = await listOpenAuthoredGhPullRequests();

		expect(result).toEqual(SAMPLE_PRS);
	});

	it("returns empty array when nodes is empty", async () => {
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(graphqlResponse([])),
			stderr: "",
		});

		const result = await listOpenAuthoredGhPullRequests();

		expect(result).toEqual([]);
	});

	it("filters out null nodes from GraphQL sparse results", async () => {
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(graphqlResponse([SAMPLE_PRS[0], null, SAMPLE_PRS[1]])),
			stderr: "",
		});

		const result = await listOpenAuthoredGhPullRequests();

		expect(result).toEqual(SAMPLE_PRS);
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

	it("invokes gh api graphql with headRefName in query", async () => {
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(graphqlResponse([])),
			stderr: "",
		});

		await listOpenAuthoredGhPullRequests();

		expect(childProcessMocks.execFilePromise).toHaveBeenCalledWith(
			"gh",
			["api", "graphql", "-f", `query=${GH_PR_GRAPHQL_QUERY}`],
			expect.objectContaining({ encoding: "utf8" }),
		);
	});

	it("preserves isDraft field from GraphQL response", async () => {
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(graphqlResponse(SAMPLE_PRS)),
			stderr: "",
		});

		const result = await listOpenAuthoredGhPullRequests();

		expect(result[0]?.isDraft).toBe(false);
		expect(result[1]?.isDraft).toBe(true);
	});
});
