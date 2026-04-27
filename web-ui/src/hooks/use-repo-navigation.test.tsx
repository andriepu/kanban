import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseRepoNavigationResult } from "@/hooks/use-repo-navigation";
import { parseRemovedRepoPathFromStreamError, useRepoNavigation } from "@/hooks/use-repo-navigation";

vi.mock("@/runtime/use-runtime-state-stream", () => ({
	useRuntimeStateStream: () => ({
		currentRepoId: null,
		repos: [],
		workspaceState: null,
		workspaceMetadata: null,
		latestTaskChatMessage: null,
		taskChatMessagesByTaskId: {},
		latestTaskReadyForReview: null,
		streamError: null,
		isRuntimeDisconnected: false,
		hasReceivedSnapshot: true,
	}),
}));

vi.mock("@/utils/react-use", () => ({
	useWindowEvent: () => {},
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({}),
}));

vi.mock("@/utils/localhost-detection", () => ({
	isLocalhostAccess: () => true,
}));

vi.mock("@/components/app-toaster", () => ({
	showAppToast: () => {},
	notifyError: () => {},
}));

function HookHarness({ onResult }: { onResult: (result: UseRepoNavigationResult) => void }): null {
	const result = useRepoNavigation({ onRepoSwitchStart: () => {} });
	onResult(result);
	return null;
}

describe("parseRemovedRepoPathFromStreamError", () => {
	it("extracts removed repo paths", () => {
		expect(parseRemovedRepoPathFromStreamError("Repo no longer exists on disk and was removed: /tmp/project")).toBe(
			"/tmp/project",
		);
	});

	it("returns null when prefix is not present", () => {
		expect(parseRemovedRepoPathFromStreamError("Something else happened")).toBeNull();
	});
});

describe("useRepoNavigation", () => {
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

	it("clears repoFilter when switching to task tab", async () => {
		let latestResult: UseRepoNavigationResult | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					onResult={(r) => {
						latestResult = r;
					}}
				/>,
			);
		});

		// Set a non-null repoFilter to simulate a selected PR repo
		await act(async () => {
			if (latestResult === null) throw new Error("Hook did not render");
			latestResult.setRepoFilter("/tmp/some-repo");
		});

		const afterSet: UseRepoNavigationResult = latestResult!;
		expect(afterSet.repoFilter).toBe("/tmp/some-repo");

		// Switch to task tab — should clear repoFilter
		await act(async () => {
			afterSet.setSidebarTab("task");
		});

		const afterSwitch: UseRepoNavigationResult = latestResult!;
		expect(afterSwitch.sidebarTab).toBe("task");
		expect(afterSwitch.repoFilter).toBeNull();
	});

	it("clears repoFilter when switching to pr tab", async () => {
		let latestResult: UseRepoNavigationResult | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					onResult={(r) => {
						latestResult = r;
					}}
				/>,
			);
		});

		await act(async () => {
			if (latestResult === null) throw new Error("Hook did not render");
			latestResult.setRepoFilter("/tmp/some-repo");
		});

		await act(async () => {
			const r: UseRepoNavigationResult = latestResult!;
			r.setSidebarTab("pr");
		});

		const afterSwitch: UseRepoNavigationResult = latestResult!;
		expect(afterSwitch.sidebarTab).toBe("pr");
		expect(afterSwitch.repoFilter).toBeNull();
	});
});
