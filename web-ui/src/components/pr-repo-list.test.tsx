import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PrRepoList } from "@/components/pr-repo-list";
import type { RuntimeRepoSummary } from "@/runtime/types";

function makeRepo(overrides: {
	id: string;
	name?: string;
	path?: string;
	pullRequestCount?: number;
}): RuntimeRepoSummary {
	return {
		id: overrides.id,
		name: overrides.name ?? overrides.id,
		path: overrides.path ?? `/tmp/${overrides.id}`,
		taskCounts: { backlog: 0, in_progress: 0, review: 0, trash: 0 },
		pullRequestCount: overrides.pullRequestCount ?? 0,
	};
}

describe("PrRepoList", () => {
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

	function render(repos: RuntimeRepoSummary[], repoFilter: string | null = null): void {
		act(() => {
			root.render(
				<PrRepoList
					repos={repos}
					repoFilter={repoFilter}
					removingRepoId={null}
					onSelect={() => {}}
					onRemove={() => {}}
				/>,
			);
		});
	}

	it("shows Active section header for repos with pullRequestCount > 0", () => {
		render([
			makeRepo({ id: "repo-a", name: "Repo A", pullRequestCount: 2 }),
			makeRepo({ id: "repo-b", name: "Repo B", pullRequestCount: 0 }),
		]);
		expect(container.textContent).toContain("Active (1)");
		expect(container.textContent).toContain("Repo A");
	});

	it("shows Inactive section header and hides repo names by default (collapsed)", () => {
		render([
			makeRepo({ id: "repo-a", name: "Repo A", pullRequestCount: 2 }),
			makeRepo({ id: "repo-b", name: "Repo B", pullRequestCount: 0 }),
		]);
		expect(container.textContent).toContain("Inactive (1)");
		expect(container.textContent).not.toContain("Repo B");
	});

	it("expands Inactive section when header is clicked", () => {
		render([
			makeRepo({ id: "repo-a", name: "Repo A", pullRequestCount: 2 }),
			makeRepo({ id: "repo-b", name: "Repo B", pullRequestCount: 0 }),
		]);
		const inactiveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("Inactive"),
		);
		if (!inactiveBtn) throw new Error("Inactive header button not found");
		act(() => {
			inactiveBtn.click();
		});
		expect(container.textContent).toContain("Repo B");
	});

	it("collapses Inactive section when header is clicked twice", () => {
		render([
			makeRepo({ id: "repo-a", name: "Repo A", pullRequestCount: 2 }),
			makeRepo({ id: "repo-b", name: "Repo B", pullRequestCount: 0 }),
		]);
		const inactiveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("Inactive"),
		);
		if (!inactiveBtn) throw new Error("Inactive header button not found");
		act(() => {
			inactiveBtn.click();
		});
		act(() => {
			inactiveBtn.click();
		});
		expect(container.textContent).not.toContain("Repo B");
	});

	it("expands Inactive by default when no active repos exist", () => {
		render([
			makeRepo({ id: "repo-a", name: "Repo A", pullRequestCount: 0 }),
			makeRepo({ id: "repo-b", name: "Repo B", pullRequestCount: 0 }),
		]);
		expect(container.textContent).not.toContain("Active");
		expect(container.textContent).toContain("Inactive (2)");
		expect(container.textContent).toContain("Repo A");
		expect(container.textContent).toContain("Repo B");
	});

	it("shows only Active section when all repos have PRs", () => {
		render([
			makeRepo({ id: "repo-a", name: "Repo A", pullRequestCount: 1 }),
			makeRepo({ id: "repo-b", name: "Repo B", pullRequestCount: 3 }),
		]);
		expect(container.textContent).toContain("Active (2)");
		expect(container.textContent).not.toContain("Inactive");
	});
});
