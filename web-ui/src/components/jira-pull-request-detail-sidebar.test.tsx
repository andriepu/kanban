import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JiraPullRequest } from "@/types/jira";
import { JiraPullRequestDetailSidebar } from "./jira-pull-request-detail-sidebar";

const mockFetchPullRequestDetail = vi.hoisted(() => vi.fn());

const mockTrpcClient = {
	jira: {
		fetchPullRequestDetail: { query: mockFetchPullRequestDetail },
	},
};

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => mockTrpcClient,
}));

function makePullRequest(overrides: Partial<JiraPullRequest> = {}): JiraPullRequest {
	return {
		id: "pr-1",
		jiraKey: "POL-1",
		repoId: "org/repo",
		repoPath: "/path/to/repo",
		prompt: "",
		title: "feat: related PR",
		baseRef: "main",
		branchName: "feature/related",
		worktreePath: "",
		prUrl: "https://github.com/org/repo/pull/10",
		prNumber: 10,
		prState: "open",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

describe("JiraPullRequestDetailSidebar", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
		mockFetchPullRequestDetail.mockResolvedValue({ body: "", threads: [] });
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("renders Related PRs section when relatedPullRequests is non-empty", async () => {
		const related = [makePullRequest({ id: "pr-2", title: "feat: sibling PR", branchName: "feature/sibling" })];

		await act(async () => {
			root.render(
				<JiraPullRequestDetailSidebar
					pullRequestId="pr-1"
					relatedPullRequests={related}
					onOpenPullRequest={vi.fn()}
				/>,
			);
		});

		expect(container.textContent).toContain("Related PRs");
		expect(container.textContent).toContain("feat: sibling PR");
	});

	it("hides Related PRs section when relatedPullRequests is empty", async () => {
		await act(async () => {
			root.render(
				<JiraPullRequestDetailSidebar pullRequestId="pr-1" relatedPullRequests={[]} onOpenPullRequest={vi.fn()} />,
			);
		});

		expect(container.textContent).not.toContain("Related PRs");
	});

	it("calls onOpenPullRequest when a related PR row is clicked", async () => {
		const onOpenPullRequest = vi.fn();
		const related = [makePullRequest({ id: "pr-2", title: "feat: clickable PR" })];

		await act(async () => {
			root.render(
				<JiraPullRequestDetailSidebar
					pullRequestId="pr-1"
					relatedPullRequests={related}
					onOpenPullRequest={onOpenPullRequest}
				/>,
			);
		});

		const button = Array.from(container.querySelectorAll('button[type="button"]')).find((btn) =>
			btn.textContent?.includes("feat: clickable PR"),
		) as HTMLButtonElement | undefined;
		expect(button).not.toBeNull();

		await act(async () => {
			button?.click();
		});

		expect(onOpenPullRequest).toHaveBeenCalledOnce();
		expect(onOpenPullRequest).toHaveBeenCalledWith(related[0]);
	});

	it("keeps Related PRs section visible while detail is loading", async () => {
		// Never resolve so isLoading stays true
		mockFetchPullRequestDetail.mockReturnValue(new Promise(() => {}));
		const related = [makePullRequest({ id: "pr-2", title: "feat: loading sibling" })];

		await act(async () => {
			root.render(
				<JiraPullRequestDetailSidebar
					pullRequestId="pr-1"
					relatedPullRequests={related}
					onOpenPullRequest={vi.fn()}
				/>,
			);
		});

		expect(container.textContent).toContain("Related PRs");
		expect(container.textContent).toContain("feat: loading sibling");
	});

	it("renders multiple related PRs", async () => {
		const related = [
			makePullRequest({ id: "pr-2", title: "feat: sibling A" }),
			makePullRequest({ id: "pr-3", title: "feat: sibling B", branchName: "feature/b" }),
		];

		await act(async () => {
			root.render(
				<JiraPullRequestDetailSidebar
					pullRequestId="pr-1"
					relatedPullRequests={related}
					onOpenPullRequest={vi.fn()}
				/>,
			);
		});

		expect(container.textContent).toContain("feat: sibling A");
		expect(container.textContent).toContain("feat: sibling B");
	});
});
