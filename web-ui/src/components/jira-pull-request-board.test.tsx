import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JiraPullRequestBoard } from "@/components/jira-pull-request-board";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { JiraPullRequest } from "@/types/jira";

function makeSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "running",
		agentId: null,
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: 1000,
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...overrides,
	};
}

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

	describe("activity indicator", () => {
		it("shows no indicator when no PR terminal session exists", () => {
			const pullRequest = makePullRequest({ id: "s1", prState: "open" });
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
			expect(container.querySelector("[data-pull-request-activity]")).toBeNull();
		});

		it("shows indicator when primary terminal is running", () => {
			const pullRequest = makePullRequest({ id: "s1", prState: "open" });
			const summary = makeSummary({
				taskId: "__pr_terminal__:s1",
				state: "running",
				latestHookActivity: {
					activityText: "Using Bash: git status",
					toolName: "Bash",
					toolInputSummary: "git status",
					finalMessage: null,
					hookEventName: "tool_use",
					notificationType: null,
					source: null,
				},
			});
			act(() => {
				root.render(
					<JiraPullRequestBoard
						pullRequests={[pullRequest]}
						repoFilter={null}
						sessions={{ "__pr_terminal__:s1": summary }}
						onPullRequestClick={() => {}}
					/>,
				);
			});
			const indicator = container.querySelector("[data-pull-request-activity]");
			expect(indicator).not.toBeNull();
			expect(indicator?.textContent).toContain("Bash");
		});

		it("shows indicator from stacked terminal when primary is absent", () => {
			const pullRequest = makePullRequest({ id: "s1", prState: "open" });
			const stackedSummary = makeSummary({
				taskId: "__pr_terminal__:s1:stacked:1",
				state: "running",
			});
			act(() => {
				root.render(
					<JiraPullRequestBoard
						pullRequests={[pullRequest]}
						repoFilter={null}
						sessions={{ "__pr_terminal__:s1:stacked:1": stackedSummary }}
						onPullRequestClick={() => {}}
					/>,
				);
			});
			expect(container.querySelector("[data-pull-request-activity]")).not.toBeNull();
		});

		it("shows indicator with green dot when terminal awaiting review with finalMessage", () => {
			const pullRequest = makePullRequest({ id: "s1", prState: "open" });
			const summary = makeSummary({
				taskId: "__pr_terminal__:s1",
				state: "awaiting_review",
				reviewReason: "hook",
				latestHookActivity: {
					activityText: null,
					toolName: null,
					toolInputSummary: null,
					finalMessage: "Done with review",
					hookEventName: "agent_end",
					notificationType: null,
					source: null,
				},
			});
			act(() => {
				root.render(
					<JiraPullRequestBoard
						pullRequests={[pullRequest]}
						repoFilter={null}
						sessions={{ "__pr_terminal__:s1": summary }}
						onPullRequestClick={() => {}}
					/>,
				);
			});
			const indicator = container.querySelector("[data-pull-request-activity]");
			expect(indicator?.textContent).toContain("Done with review");
		});

		it("priority-pick: failed primary wins over running stacked", () => {
			const pullRequest = makePullRequest({ id: "s1", prState: "open" });
			const failedSummary = makeSummary({
				taskId: "__pr_terminal__:s1",
				state: "failed",
			});
			const runningSummary = makeSummary({
				taskId: "__pr_terminal__:s1:stacked:1",
				state: "running",
			});
			act(() => {
				root.render(
					<JiraPullRequestBoard
						pullRequests={[pullRequest]}
						repoFilter={null}
						sessions={{
							"__pr_terminal__:s1": failedSummary,
							"__pr_terminal__:s1:stacked:1": runningSummary,
						}}
						onPullRequestClick={() => {}}
					/>,
				);
			});
			const indicator = container.querySelector("[data-pull-request-activity]");
			expect(indicator).not.toBeNull();
			// Failed state renders "Task failed to start" text
			expect(indicator?.textContent).toContain("Task failed to start");
		});
	});
});
