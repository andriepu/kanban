import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JiraPullRequestBoard } from "@/components/jira-pull-request-board";
import type { JiraPullRequest } from "@/types/jira";

function makePullRequest(overrides: Partial<JiraPullRequest> = {}): JiraPullRequest {
	return {
		id: "subtask-1",
		jiraKey: "KAN-1",
		repoId: "repo-1",
		repoPath: "/projects/alpha",
		prompt: "Do the thing",
		title: "Implement feature",
		baseRef: "main",
		branchName: "feature/kan-1-implement-feature",
		worktreePath: "/worktrees/kan-1",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

describe("JiraPullRequestBoard", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
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

	it("renders three columns", () => {
		act(() => {
			root.render(
				<JiraPullRequestBoard pullRequests={[]} repoFilter={null} sessions={{}} onPullRequestClick={() => {}} />,
			);
		});
		const columns = Array.from(container.querySelectorAll("[data-column-id]")).map((el) =>
			el.getAttribute("data-column-id"),
		);
		expect(columns).toEqual(["draft", "open", "done"]);
	});

	it("shows draft PR in draft column", () => {
		const pullRequest = makePullRequest({ id: "s1", prState: "draft", title: "My draft" });
		act(() => {
			root.render(
				<JiraPullRequestBoard
					pullRequests={[pullRequest]}
					repoFilter={null}
					sessions={{}}
					onPullRequestClick={() => {}}
				/>,
			);
		});
		expect(container.querySelector("[data-column-id='draft']")?.textContent).toContain("My draft");
		expect(container.querySelector("[data-column-id='open']")?.textContent).not.toContain("My draft");
	});

	it("shows open PR in open column", () => {
		const pullRequest = makePullRequest({ id: "s1", prState: "open", title: "My open PR" });
		act(() => {
			root.render(
				<JiraPullRequestBoard
					pullRequests={[pullRequest]}
					repoFilter={null}
					sessions={{}}
					onPullRequestClick={() => {}}
				/>,
			);
		});
		expect(container.querySelector("[data-column-id='open']")?.textContent).toContain("My open PR");
		expect(container.querySelector("[data-column-id='draft']")?.textContent).not.toContain("My open PR");
	});

	it("shows merged PR in done column", () => {
		const pullRequest = makePullRequest({ id: "s1", prState: "merged", title: "My merged PR" });
		act(() => {
			root.render(
				<JiraPullRequestBoard
					pullRequests={[pullRequest]}
					repoFilter={null}
					sessions={{}}
					onPullRequestClick={() => {}}
				/>,
			);
		});
		expect(container.querySelector("[data-column-id='done']")?.textContent).toContain("My merged PR");
		expect(container.querySelector("[data-column-id='open']")?.textContent).not.toContain("My merged PR");
	});

	it("shows PR without prState in draft column", () => {
		const pullRequest = makePullRequest({ id: "s1", title: "Local draft" });
		act(() => {
			root.render(
				<JiraPullRequestBoard
					pullRequests={[pullRequest]}
					repoFilter={null}
					sessions={{}}
					onPullRequestClick={() => {}}
				/>,
			);
		});
		expect(container.querySelector("[data-column-id='draft']")?.textContent).toContain("Local draft");
	});

	it("filters pull requests by repoFilter", () => {
		const alpha = makePullRequest({ id: "s1", repoPath: "/projects/alpha", title: "Alpha task" });
		const beta = makePullRequest({ id: "s2", repoPath: "/projects/beta", title: "Beta task" });
		act(() => {
			root.render(
				<JiraPullRequestBoard
					pullRequests={[alpha, beta]}
					repoFilter="/projects/alpha"
					sessions={{}}
					onPullRequestClick={() => {}}
				/>,
			);
		});
		expect(container.textContent).toContain("Alpha task");
		expect(container.textContent).not.toContain("Beta task");
	});

	it("shows all pull requests when repoFilter is null", () => {
		const alpha = makePullRequest({ id: "s1", repoPath: "/projects/alpha", title: "Alpha task" });
		const beta = makePullRequest({ id: "s2", repoPath: "/projects/beta", title: "Beta task" });
		act(() => {
			root.render(
				<JiraPullRequestBoard
					pullRequests={[alpha, beta]}
					repoFilter={null}
					sessions={{}}
					onPullRequestClick={() => {}}
				/>,
			);
		});
		expect(container.textContent).toContain("Alpha task");
		expect(container.textContent).toContain("Beta task");
	});

	it("calls onPullRequestClick with the correct pull request on card click", () => {
		const pullRequest = makePullRequest({ id: "s1", title: "Click me" });
		const onClick = vi.fn();
		act(() => {
			root.render(
				<JiraPullRequestBoard
					pullRequests={[pullRequest]}
					repoFilter={null}
					sessions={{}}
					onPullRequestClick={onClick}
				/>,
			);
		});
		const card = container.querySelector("[data-pull-request-id='s1']") as HTMLElement;
		act(() => {
			card.click();
		});
		expect(onClick).toHaveBeenCalledWith(pullRequest);
	});

	it("hides repo name when repoFilter is set", () => {
		const pullRequest = makePullRequest({ id: "s1", repoPath: "/projects/alpha" });
		act(() => {
			root.render(
				<JiraPullRequestBoard
					pullRequests={[pullRequest]}
					repoFilter="/projects/alpha"
					sessions={{}}
					onPullRequestClick={() => {}}
				/>,
			);
		});
		expect(container.querySelector("[data-pull-request-id='s1']")?.querySelector("[data-repo-name]")).toBeNull();
	});

	it("shows repo name when repoFilter is null", () => {
		const pullRequest = makePullRequest({ id: "s1", repoPath: "/projects/alpha" });
		act(() => {
			root.render(
				<JiraPullRequestBoard
					pullRequests={[pullRequest]}
					repoFilter={null}
					sessions={{}}
					onPullRequestClick={() => {}}
				/>,
			);
		});
		const repoNameEl = container.querySelector("[data-pull-request-id='s1']")?.querySelector("[data-repo-name]");
		expect(repoNameEl).not.toBeNull();
		expect(repoNameEl?.textContent).toBe("alpha");
	});
});
