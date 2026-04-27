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

import type { GhPullRequest, GhPullRequestDetail, GhPullRequestReviewThread } from "../../../src/jira/jira-pr-scan";
import {
	fetchGhPullRequestDetail,
	GH_PR_DETAIL_GRAPHQL_QUERY,
	listAuthoredGhPullRequestsForProject,
} from "../../../src/jira/jira-pr-scan";

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

// ---- fetchGhPullRequestDetail ----

function prDetailResponse(detail: {
	body: string;
	reviewThreads: {
		nodes: ({
			isResolved: boolean;
			isOutdated: boolean;
			path: string;
			comments: { nodes: ({ author: { login: string }; body: string; createdAt: string; url: string } | null)[] };
		} | null)[];
	};
}) {
	return { data: { repository: { pullRequest: detail } } };
}

const SAMPLE_COMMENT_1 = {
	author: { login: "reviewer1" },
	body: "Please extract this into a utility function.",
	createdAt: "2026-04-27T10:00:00Z",
	url: "https://github.com/org/repo/pull/42#discussion_r1",
};

const SAMPLE_THREAD_1 = {
	isResolved: false,
	isOutdated: false,
	path: "src/foo.ts",
	comments: {
		nodes: [SAMPLE_COMMENT_1],
	},
};

const SAMPLE_THREAD_2 = {
	isResolved: true,
	isOutdated: false,
	path: "src/bar.ts",
	comments: {
		nodes: [
			{
				author: { login: "reviewer2" },
				body: "Fixed in latest commit.",
				createdAt: "2026-04-27T11:00:00Z",
				url: "https://github.com/org/repo/pull/42#discussion_r2",
			},
		],
	},
};

describe("fetchGhPullRequestDetail", () => {
	beforeEach(() => {
		childProcessMocks.execFile.mockReset();
		childProcessMocks.execFilePromise.mockReset();
	});

	it("returns body and all threads (resolved + unresolved) on happy path", async () => {
		const payload = prDetailResponse({
			body: "## Summary\nThis PR fixes the login bug.",
			reviewThreads: { nodes: [SAMPLE_THREAD_1, SAMPLE_THREAD_2] },
		});
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(payload),
			stderr: "",
		});

		const result = await fetchGhPullRequestDetail("org", "repo", 42);

		expect(result.body).toBe("## Summary\nThis PR fixes the login bug.");
		expect(result.reviewThreads).toHaveLength(2);
		expect(result.reviewThreads[0]).toMatchObject<Partial<GhPullRequestReviewThread>>({
			isResolved: false,
			path: "src/foo.ts",
		});
		expect(result.reviewThreads[1]).toMatchObject<Partial<GhPullRequestReviewThread>>({
			isResolved: true,
			path: "src/bar.ts",
		});
	});

	it("returns empty body and empty threads when PR has no content", async () => {
		const payload = prDetailResponse({
			body: "",
			reviewThreads: { nodes: [] },
		});
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(payload),
			stderr: "",
		});

		const result = await fetchGhPullRequestDetail("org", "repo", 1);

		expect(result).toEqual<GhPullRequestDetail>({ body: "", reviewThreads: [] });
	});

	it("throws a clear error when gh CLI is not found (ENOENT)", async () => {
		const enoentError = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
		childProcessMocks.execFilePromise.mockRejectedValueOnce(enoentError);

		await expect(fetchGhPullRequestDetail("org", "repo", 42)).rejects.toThrow(
			"gh CLI not found. Install GitHub CLI (gh) to use PR scan.",
		);
	});

	it("throws with stderr content when gh exits non-zero", async () => {
		const stderrMessage = "gh: Could not resolve to a Repository with the name 'org/repo'.";
		const exitError = Object.assign(new Error("Command failed"), {
			code: 1,
			stderr: stderrMessage,
		});
		childProcessMocks.execFilePromise.mockRejectedValueOnce(exitError);

		await expect(fetchGhPullRequestDetail("org", "repo", 42)).rejects.toThrow(stderrMessage);
	});

	it("invokes gh api graphql with correct args including -F number and owner/repo variables", async () => {
		const payload = prDetailResponse({ body: "", reviewThreads: { nodes: [] } });
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(payload),
			stderr: "",
		});

		await fetchGhPullRequestDetail("myorg", "myrepo", 99);

		expect(childProcessMocks.execFilePromise).toHaveBeenCalledWith(
			"gh",
			[
				"api",
				"graphql",
				"-f",
				`query=${GH_PR_DETAIL_GRAPHQL_QUERY}`,
				"-f",
				"owner=myorg",
				"-f",
				"repo=myrepo",
				"-F",
				"number=99",
			],
			expect.objectContaining({ encoding: "utf8" }),
		);
	});

	it("filters out null thread nodes from sparse GraphQL results", async () => {
		const payload = prDetailResponse({
			body: "PR body",
			reviewThreads: { nodes: [null, SAMPLE_THREAD_1, null] },
		});
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(payload),
			stderr: "",
		});

		const result = await fetchGhPullRequestDetail("org", "repo", 42);

		expect(result.reviewThreads).toHaveLength(1);
		expect(result.reviewThreads[0]?.path).toBe("src/foo.ts");
	});

	it("filters out null comment nodes within threads from sparse GraphQL results", async () => {
		const threadWithNullComments = {
			...SAMPLE_THREAD_1,
			comments: {
				nodes: [null, SAMPLE_COMMENT_1, null],
			},
		};
		const payload = prDetailResponse({
			body: "PR body",
			reviewThreads: { nodes: [threadWithNullComments] },
		});
		childProcessMocks.execFilePromise.mockResolvedValueOnce({
			stdout: JSON.stringify(payload),
			stderr: "",
		});

		const result = await fetchGhPullRequestDetail("org", "repo", 42);

		expect(result.reviewThreads[0]?.comments).toHaveLength(1);
		expect(result.reviewThreads[0]?.comments[0]?.author.login).toBe("reviewer1");
	});
});
