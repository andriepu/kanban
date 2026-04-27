import { useCallback, useEffect, useRef, useState } from "react";

import { notifyError, showAppToast } from "@/components/app-toaster";
import type { Route } from "@/hooks/app-utils";
import { buildPathname, parseRoute } from "@/hooks/app-utils";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { useRuntimeStateStream } from "@/runtime/use-runtime-state-stream";
import { isLocalhostAccess } from "@/utils/localhost-detection";
import { useWindowEvent } from "@/utils/react-use";

export const REMOVED_REPO_ERROR_PREFIX = "Repo no longer exists on disk and was removed:";

const DIRECTORY_PICKER_UNAVAILABLE_MARKERS = [
	"could not open directory picker",
	'install "zenity" or "kdialog"',
	'install powershell ("powershell" or "pwsh")',
	'command "osascript" is not available',
] as const;

function isDirectoryPickerUnavailableError(message: string | null | undefined): boolean {
	if (!message) {
		return false;
	}
	const normalized = message.trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	return DIRECTORY_PICKER_UNAVAILABLE_MARKERS.some((marker) => normalized.includes(marker));
}

export function parseRemovedRepoPathFromStreamError(streamError: string | null): string | null {
	if (!streamError || !streamError.startsWith(REMOVED_REPO_ERROR_PREFIX)) {
		return null;
	}
	return streamError.slice(REMOVED_REPO_ERROR_PREFIX.length).trim();
}

interface UseRepoNavigationInput {
	onRepoSwitchStart: () => void;
}

export interface UseRepoNavigationResult {
	requestedRepoId: string | null;
	navigationCurrentRepoId: string | null;
	removingRepoId: string | null;
	isAddRepoDialogOpen: boolean;
	setIsAddRepoDialogOpen: (open: boolean) => void;
	pendingNativeGitInitPath: string | null;
	currentRepoId: string | null;
	repos: ReturnType<typeof useRuntimeStateStream>["repos"];
	workspaceState: ReturnType<typeof useRuntimeStateStream>["workspaceState"];
	workspaceMetadata: ReturnType<typeof useRuntimeStateStream>["workspaceMetadata"];
	latestTaskChatMessage: ReturnType<typeof useRuntimeStateStream>["latestTaskChatMessage"];
	taskChatMessagesByTaskId: ReturnType<typeof useRuntimeStateStream>["taskChatMessagesByTaskId"];
	latestTaskReadyForReview: ReturnType<typeof useRuntimeStateStream>["latestTaskReadyForReview"];
	streamError: string | null;
	isRuntimeDisconnected: boolean;
	hasReceivedSnapshot: boolean;
	hasNoRepos: boolean;
	isRepoSwitching: boolean;
	handleSelectRepo: (repoId: string) => void;
	handleAddRepo: () => void;
	handleAddRepoSuccess: (repoId: string) => void;
	handleRemoveRepo: (repoId: string) => Promise<boolean>;
	resetRepoNavigationState: () => void;
	repoFilter: string | null;
	setRepoFilter: (path: string | null) => void;
	sidebarTab: "task" | "pr";
	setSidebarTab: (tab: "task" | "pr") => void;
}

export function useRepoNavigation({ onRepoSwitchStart }: UseRepoNavigationInput): UseRepoNavigationResult {
	const [sidebarTabRaw, setSidebarTabRaw] = useState<"task" | "pr">(() => {
		if (typeof window === "undefined") return "task";
		return parseRoute(window.location.pathname)?.kind ?? "task";
	});
	const [prRepoNameFromUrl, setPrRepoNameFromUrl] = useState<string | null>(() => {
		if (typeof window === "undefined") return null;
		const route = parseRoute(window.location.pathname);
		return route?.kind === "pr" ? route.repoName : null;
	});
	const [requestedRepoId, setRequestedRepoId] = useState<string | null>(null);
	const [pendingAddedRepoId, setPendingAddedRepoId] = useState<string | null>(null);
	const [removingRepoId, setRemovingRepoId] = useState<string | null>(null);
	const [isAddRepoDialogOpen, setIsAddRepoDialogOpen] = useState(false);
	const [pendingGitInitPath, setPendingGitInitPath] = useState<string | null>(null);
	const [repoFilter, setRepoFilter] = useState<string | null>(null);

	const reposRef = useRef<ReturnType<typeof useRuntimeStateStream>["repos"]>([]);
	const prevTabRef = useRef(sidebarTabRaw);
	const isFirstTabEffectRef = useRef(true);

	const setSidebarTab = useCallback((tab: "task" | "pr") => {
		setSidebarTabRaw(tab);
		setRepoFilter(null);
	}, []);

	const {
		currentRepoId,
		repos,
		workspaceState,
		workspaceMetadata,
		latestTaskChatMessage,
		taskChatMessagesByTaskId,
		latestTaskReadyForReview,
		streamError,
		isRuntimeDisconnected,
		hasReceivedSnapshot,
	} = useRuntimeStateStream(requestedRepoId);

	reposRef.current = repos;

	const hasNoRepos = hasReceivedSnapshot && repos.length === 0 && currentRepoId === null;
	const isRepoSwitching = requestedRepoId !== null && requestedRepoId !== currentRepoId && !hasNoRepos;
	const navigationCurrentRepoId = requestedRepoId ?? currentRepoId;

	const handleSelectRepo = useCallback(
		(repoId: string) => {
			if (!repoId || repoId === currentRepoId) {
				return;
			}
			onRepoSwitchStart();
			setRequestedRepoId(repoId);
		},
		[currentRepoId, onRepoSwitchStart],
	);

	const handleAddRepoSuccess = useCallback(
		(repoId: string) => {
			setPendingAddedRepoId(repoId);
			handleSelectRepo(repoId);
		},
		[handleSelectRepo],
	);

	const handleAddRepo = useCallback(async () => {
		if (!isLocalhostAccess()) {
			setIsAddRepoDialogOpen(true);
			return;
		}

		// On localhost, try the native OS file picker first for a more
		// familiar UX.  Fall back to the remote file browser dialog if the
		// native picker is unavailable (e.g. headless / Docker).
		try {
			const trpcClient = getRuntimeTrpcClient(currentRepoId);
			const picked = await trpcClient.repos.pickDirectory.mutate();

			if (picked.ok && picked.path) {
				const added = await trpcClient.repos.add.mutate({ path: picked.path });
				if (!added.ok || !added.repo) {
					if (added.requiresGitInitialization) {
						// Needs git init — open the dialog with the path
						// pre-filled so the user can confirm initialization.
						setPendingGitInitPath(picked.path);
						setIsAddRepoDialogOpen(true);
						return;
					}
					throw new Error(added.error ?? "Could not add repo.");
				}
				handleAddRepoSuccess(added.repo.id);
				return;
			}
			if (!picked.ok && picked.error === "No directory was selected.") {
				// User cancelled — do nothing
				return;
			}
			if (!picked.ok && isDirectoryPickerUnavailableError(picked.error)) {
				// Native picker not available — fall back to dialog
				setIsAddRepoDialogOpen(true);
				return;
			}
			throw new Error(picked.error ?? "Could not pick repo directory.");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (isDirectoryPickerUnavailableError(message)) {
				setIsAddRepoDialogOpen(true);
			} else {
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
			}
		}
	}, [currentRepoId, handleAddRepoSuccess]);

	const handleRemoveRepo = useCallback(
		async (repoId: string): Promise<boolean> => {
			if (removingRepoId) {
				return false;
			}
			setRemovingRepoId(repoId);
			try {
				const trpcClient = getRuntimeTrpcClient(currentRepoId);
				const payload = await trpcClient.repos.remove.mutate({ repoId });
				if (!payload.ok) {
					throw new Error(payload.error ?? "Could not remove repo.");
				}
				if (currentRepoId === repoId) {
					onRepoSwitchStart();
					setRequestedRepoId(null);
				}
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				notifyError(message);
				return false;
			} finally {
				setRemovingRepoId((current) => (current === repoId ? null : current));
			}
		},
		[currentRepoId, onRepoSwitchStart, removingRepoId],
	);

	const handlePopState = useCallback(() => {
		if (typeof window === "undefined") {
			return;
		}
		const route = parseRoute(window.location.pathname);
		const nextTab = route?.kind ?? "task";
		setSidebarTabRaw(nextTab);
		prevTabRef.current = nextTab;
		if (route?.kind === "pr") {
			if (route.repoName) {
				const repo = reposRef.current.find((r) => r.name === route.repoName);
				setRepoFilter(repo?.path ?? null);
			} else {
				setRepoFilter(null);
			}
		} else {
			setRepoFilter(null);
		}
	}, []);
	useWindowEvent("popstate", handlePopState);

	// Redirect invalid/unknown paths to /task on mount.
	useEffect(() => {
		if (typeof window === "undefined") return;
		const route = parseRoute(window.location.pathname);
		if (!route) {
			const nextUrl = new URL(window.location.href);
			window.history.replaceState({}, "", `/task${nextUrl.search}${nextUrl.hash}`);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Resolve initial PR repo name from URL once repos are available.
	useEffect(() => {
		if (prRepoNameFromUrl === null || repos.length === 0) return;
		const repo = repos.find((r) => r.name === prRepoNameFromUrl);
		setRepoFilter(repo?.path ?? null);
		setPrRepoNameFromUrl(null);
	}, [prRepoNameFromUrl, repos]);

	// Sync (sidebarTab, repoFilter) → URL pathname.
	useEffect(() => {
		if (typeof window === "undefined") return;
		if (prRepoNameFromUrl !== null) return; // Still resolving initial URL repo
		if (isFirstTabEffectRef.current) {
			isFirstTabEffectRef.current = false;
			prevTabRef.current = sidebarTabRaw;
			return;
		}

		const repoName =
			sidebarTabRaw === "pr" && repoFilter
				? (reposRef.current.find((r) => r.path === repoFilter)?.name ?? null)
				: null;
		const route: Route = sidebarTabRaw === "task" ? { kind: "task" } : { kind: "pr", repoName };
		const nextPathname = buildPathname(route);
		const nextUrl = new URL(window.location.href);

		if (nextUrl.pathname !== nextPathname) {
			const href = `${nextPathname}${nextUrl.search}${nextUrl.hash}`;
			if (sidebarTabRaw !== prevTabRef.current) {
				window.history.pushState({}, "", href);
			} else {
				window.history.replaceState({}, "", href);
			}
		}
		prevTabRef.current = sidebarTabRaw;
	}, [sidebarTabRaw, repoFilter, prRepoNameFromUrl]);

	useEffect(() => {
		if (!pendingAddedRepoId) {
			return;
		}
		const repoExists = repos.some((repo) => repo.id === pendingAddedRepoId);
		if (!repoExists && currentRepoId !== pendingAddedRepoId) {
			return;
		}
		setPendingAddedRepoId(null);
	}, [currentRepoId, pendingAddedRepoId, repos]);

	useEffect(() => {
		if (!requestedRepoId || !currentRepoId) {
			return;
		}
		if (pendingAddedRepoId && requestedRepoId === pendingAddedRepoId) {
			return;
		}
		const requestedStillExists = repos.some((repo) => repo.id === requestedRepoId);
		if (requestedStillExists) {
			return;
		}
		setRequestedRepoId(currentRepoId);
	}, [currentRepoId, pendingAddedRepoId, repos, requestedRepoId]);

	const resetRepoNavigationState = useCallback(() => {
		setRemovingRepoId(null);
		setIsAddRepoDialogOpen(false);
		setPendingGitInitPath(null);
	}, []);

	return {
		requestedRepoId,
		navigationCurrentRepoId,
		removingRepoId,
		isAddRepoDialogOpen,
		setIsAddRepoDialogOpen,
		pendingNativeGitInitPath: pendingGitInitPath,
		currentRepoId,
		repos,
		workspaceState,
		workspaceMetadata,
		latestTaskChatMessage,
		taskChatMessagesByTaskId,
		latestTaskReadyForReview,
		streamError,
		isRuntimeDisconnected,
		hasReceivedSnapshot,
		hasNoRepos,
		isRepoSwitching,
		handleSelectRepo,
		handleAddRepo,
		handleAddRepoSuccess,
		handleRemoveRepo,
		resetRepoNavigationState,
		repoFilter,
		setRepoFilter,
		sidebarTab: sidebarTabRaw,
		setSidebarTab,
	};
}
