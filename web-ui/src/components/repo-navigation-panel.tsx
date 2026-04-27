import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Ellipsis, Plus } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { PrRepoList } from "@/components/pr-repo-list";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/use-is-mobile";
import type { RuntimeRepoSummary } from "@/runtime/types";
import { formatPathForDisplay } from "@/utils/path-display";
import { useUnmount, useWindowEvent } from "@/utils/react-use";

const COLLAPSED_WIDTH = 48;
const SIDEBAR_COLLAPSE_THRESHOLD = 120;
const SIDEBAR_MIN_EXPANDED_WIDTH = 200;
const SIDEBAR_MAX_EXPANDED_WIDTH = 600;
const TASK_RAIL_WIDTH = 48;

interface TaskCountBadge {
	id: string;
	title: string;
	shortLabel: string;
	toneClassName: string;
	count: number;
}

export function RepoNavigationPanel({
	repos,
	isLoadingRepos = false,
	currentRepoId,
	removingRepoId,
	jiraDetailContent,
	onSelectRepo,
	onRemoveRepo,
	onAddRepo,
	sidebarWidth,
	setExpandedSidebarWidth,
	isCollapsed,
	setSidebarCollapsed,
	sidebarTab,
	onSidebarTabChange,
	hasJiraConfig,
	repoFilter,
	onFilterRepo,
}: {
	repos: RuntimeRepoSummary[];
	isLoadingRepos?: boolean;
	currentRepoId: string | null;
	removingRepoId: string | null;
	jiraDetailContent?: ReactNode;
	onSelectRepo: (repoId: string) => void;
	onRemoveRepo: (repoId: string) => Promise<boolean>;
	onAddRepo: () => void;
	sidebarWidth: number;
	setExpandedSidebarWidth: (width: number) => void;
	isCollapsed: boolean;
	setSidebarCollapsed: (collapsed: boolean, persist?: boolean) => void;
	sidebarTab: "task" | "repo";
	onSidebarTabChange: (tab: "task" | "repo") => void;
	hasJiraConfig: boolean;
	repoFilter: string | null;
	onFilterRepo: (repoPath: string) => void;
}): React.ReactElement {
	const sortedRepos = [...repos].sort((a, b) => a.path.localeCompare(b.path));

	const [pendingRepoRemoval, setPendingRepoRemoval] = useState<RuntimeRepoSummary | null>(null);
	const isRepoRemovalPending = pendingRepoRemoval !== null && removingRepoId === pendingRepoRemoval.id;
	const pendingRepoTaskCount = pendingRepoRemoval
		? pendingRepoRemoval.taskCounts.backlog +
			pendingRepoRemoval.taskCounts.in_progress +
			pendingRepoRemoval.taskCounts.review +
			pendingRepoRemoval.taskCounts.trash
		: 0;

	const isMobile = useIsMobile();
	const [isMobileClosing, setIsMobileClosing] = useState(false);

	useEffect(() => {
		if (isMobile) {
			setSidebarCollapsed(true, false);
		}
		// Only auto-collapse when crossing the mobile breakpoint, not on every isCollapsed change.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isMobile]);

	const setCollapsed = useCallback(
		(collapsed: boolean) => {
			if (isMobile && collapsed) {
				setIsMobileClosing(true);
				return;
			}
			setSidebarCollapsed(collapsed, !isMobile);
		},
		[isMobile, setSidebarCollapsed],
	);

	const handleMobileCloseAnimationEnd = useCallback(() => {
		setIsMobileClosing(false);
		setSidebarCollapsed(true, false);
	}, [setSidebarCollapsed]);

	const [isDragging, setIsDragging] = useState(false);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const previousBodyStyleRef = useRef<{ userSelect: string; cursor: string } | null>(null);

	const stopDrag = useCallback(() => {
		setIsDragging(false);
		const previousStyle = previousBodyStyleRef.current;
		if (previousStyle) {
			document.body.style.userSelect = previousStyle.userSelect;
			document.body.style.cursor = previousStyle.cursor;
			previousBodyStyleRef.current = null;
		}
		dragRef.current = null;
	}, []);

	useUnmount(stopDrag);

	const handleMouseMove = useCallback(
		(event: MouseEvent) => {
			if (!isDragging) {
				return;
			}
			const dragState = dragRef.current;
			if (!dragState) {
				return;
			}
			const delta = event.clientX - dragState.startX;
			const newWidth = dragState.startWidth + delta;
			if (newWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
				if (!isCollapsed) {
					setCollapsed(true);
				}
				return;
			}
			if (isCollapsed) {
				setCollapsed(false);
			}
			setExpandedSidebarWidth(newWidth);
		},
		[isCollapsed, isDragging, setExpandedSidebarWidth, setCollapsed],
	);

	const handleMouseUp = useCallback(() => {
		if (!isDragging) {
			return;
		}
		stopDrag();
	}, [isDragging, stopDrag]);

	useWindowEvent("mousemove", isDragging ? handleMouseMove : null);
	useWindowEvent("mouseup", isDragging ? handleMouseUp : null);

	const startDrag = useCallback(
		(e: ReactMouseEvent) => {
			e.preventDefault();
			if (isDragging) {
				stopDrag();
			}
			dragRef.current = { startX: e.clientX, startWidth: isCollapsed ? COLLAPSED_WIDTH : sidebarWidth };
			setIsDragging(true);
			previousBodyStyleRef.current = {
				userSelect: document.body.style.userSelect,
				cursor: document.body.style.cursor,
			};
			document.body.style.userSelect = "none";
			document.body.style.cursor = "ew-resize";
		},
		[isCollapsed, isDragging, sidebarWidth, stopDrag],
	);

	if (isMobile && isCollapsed && !isMobileClosing) {
		return <></>;
	}

	if (sidebarTab === "task") {
		const isRail = jiraDetailContent == null;
		return (
			<aside
				className={cn("flex flex-col min-h-0 overflow-hidden bg-surface-1 shrink-0 relative", isRail && "pt-10")}
				style={{
					width: isRail ? TASK_RAIL_WIDTH : sidebarWidth,
					minWidth: isRail ? TASK_RAIL_WIDTH : SIDEBAR_MIN_EXPANDED_WIDTH,
					maxWidth: isRail ? TASK_RAIL_WIDTH : SIDEBAR_MAX_EXPANDED_WIDTH,
					borderRight: "1px solid var(--color-divider)",
					transition: "width 250ms ease, min-width 250ms ease, max-width 250ms ease",
				}}
			>
				{isRail ? (
					<div className="flex flex-col items-center py-2 gap-1.5">
						<button
							type="button"
							aria-current="true"
							onClick={() => onSidebarTabChange("task")}
							style={{ writingMode: "vertical-lr", transform: "rotate(180deg)" }}
							className="cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold text-accent bg-surface-3 border border-border"
						>
							Task
						</button>
						<button
							type="button"
							onClick={() => onSidebarTabChange("repo")}
							style={{ writingMode: "vertical-lr", transform: "rotate(180deg)" }}
							className="cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-3"
						>
							Pull Request
						</button>
					</div>
				) : (
					<div className="flex flex-col min-h-0 flex-1 overflow-hidden">
						<div style={{ padding: "12px 12px 8px" }}>
							<div className="mt-2 rounded-md bg-surface-2 border border-border p-1">
								<div className="grid grid-cols-2 gap-1">
									<button
										type="button"
										onClick={() => onSidebarTabChange("task")}
										className="relative cursor-pointer rounded-sm px-2 py-1 text-xs font-medium bg-surface-4 text-text-primary border border-border"
									>
										Task
										{!hasJiraConfig && (
											<span
												className="ml-1 inline-flex size-2 rounded-full bg-status-orange"
												title="Jira & Repos not configured"
											/>
										)}
									</button>
									<button
										type="button"
										onClick={() => onSidebarTabChange("repo")}
										className="cursor-pointer rounded-sm px-2 py-1 text-xs font-medium text-text-secondary hover:text-text-primary border border-transparent"
									>
										Pull Request
									</button>
								</div>
							</div>
						</div>
						<div className="flex-1 min-h-0 overflow-hidden">{jiraDetailContent}</div>
					</div>
				)}
			</aside>
		);
	}

	return (
		<aside
			className={cn(
				"flex flex-col min-h-0 overflow-hidden bg-surface-1 shrink-0",
				isMobile ? "fixed inset-y-0 left-0 z-50 shadow-2xl" : "relative",
			)}
			onAnimationEnd={isMobileClosing ? handleMobileCloseAnimationEnd : undefined}
			style={
				isMobile
					? {
							width: "100vw",
							animation: isMobileClosing
								? "kb-sidebar-slide-out 200ms ease forwards"
								: "kb-sidebar-slide-in 200ms ease",
						}
					: {
							width: isCollapsed ? COLLAPSED_WIDTH : sidebarWidth,
							minWidth: isCollapsed ? COLLAPSED_WIDTH : SIDEBAR_MIN_EXPANDED_WIDTH,
							maxWidth: isCollapsed ? COLLAPSED_WIDTH : SIDEBAR_MAX_EXPANDED_WIDTH,
							borderRight: "1px solid var(--color-divider)",
							transition: "width 250ms ease, min-width 250ms ease, max-width 250ms ease",
						}
			}
		>
			{!isMobile && (
				<div
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize sidebar"
					onMouseDown={startDrag}
					className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize z-10"
				/>
			)}

			{/* Collapsed content layer */}
			<div
				style={{
					opacity: !isMobile && isCollapsed ? 1 : 0,
					transition: "opacity 150ms ease",
					pointerEvents: !isMobile && isCollapsed ? "auto" : "none",
					position: "absolute",
					inset: 0,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					paddingTop: 8,
					paddingBottom: 8,
					gap: 6,
				}}
			>
				{sortedRepos.map((repo) => {
					const letter = repo.name.charAt(0).toUpperCase();
					return (
						<button
							key={repo.id}
							type="button"
							title={repo.name}
							onClick={() => {
								if (isMobile) {
									setCollapsed(false);
								}
								onSelectRepo(repo.id);
							}}
							// Collapsed icons switch workspace; highlight tracks currentRepoId, not repoFilter.
							className={cn(
								"rounded-md text-xs font-semibold shrink-0 border-0 cursor-pointer flex items-center justify-center",
								isMobile ? "w-11 h-11" : "w-8 h-8",
								currentRepoId === repo.id
									? "bg-accent text-accent-fg"
									: repo.pullRequestCount === 0
										? "bg-surface-2 text-text-tertiary hover:text-text-secondary hover:bg-surface-3"
										: "bg-surface-3 text-text-secondary hover:text-text-primary hover:bg-surface-4",
							)}
						>
							{letter}
						</button>
					);
				})}
				<button
					type="button"
					title="Add repo"
					onClick={onAddRepo}
					disabled={removingRepoId !== null}
					className={cn(
						"rounded-md text-xs shrink-0 border-0 cursor-pointer flex items-center justify-center bg-transparent text-text-tertiary hover:text-text-secondary hover:bg-surface-2 mt-auto",
						isMobile ? "w-11 h-11" : "w-8 h-8",
					)}
				>
					<Plus size={16} />
				</button>
			</div>

			{/* Expanded content layer */}
			<div
				style={{
					opacity: isMobile || !isCollapsed ? 1 : 0,
					transition: isMobile ? undefined : "opacity 150ms ease 100ms",
					pointerEvents: isMobile || !isCollapsed ? "auto" : "none",
					display: "flex",
					flexDirection: "column",
					flex: 1,
					minHeight: 0,
					overflow: "hidden",
				}}
			>
				<div style={{ padding: "12px 12px 8px" }}>
					<div className="flex items-center justify-between">
						<div className="font-semibold text-base flex items-baseline gap-1.5">
							Kanban <span className="text-text-secondary font-normal text-xs">v{__APP_VERSION__}</span>
						</div>
						{isMobile ? (
							<Button
								variant="ghost"
								size="sm"
								icon={<Plus size={16} className="rotate-45" />}
								onClick={() => setCollapsed(true)}
								aria-label="Close sidebar"
								className="min-w-[44px] min-h-[44px] -mr-2"
							/>
						) : null}
					</div>
					<div className="mt-2 rounded-md bg-surface-2 border border-border p-1">
						<div className="grid grid-cols-2 gap-1">
							<button
								type="button"
								onClick={() => onSidebarTabChange("task")}
								className="relative cursor-pointer rounded-sm px-2 py-1 text-xs font-medium text-text-secondary hover:text-text-primary border border-transparent"
							>
								Task
								{!hasJiraConfig && (
									<span
										className="ml-1 inline-flex size-2 rounded-full bg-status-orange"
										title="Jira & Repos not configured"
									/>
								)}
							</button>
							<button
								type="button"
								onClick={() => onSidebarTabChange("repo")}
								className={cn(
									"cursor-pointer rounded-sm px-2 py-1 text-xs font-medium",
									sidebarTab === "repo"
										? "bg-surface-4 text-text-primary border border-border"
										: "text-text-secondary hover:text-text-primary border border-transparent",
								)}
							>
								Pull Request
							</button>
						</div>
					</div>
				</div>

				<div
					className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-1"
					style={{ padding: "4px 12px" }}
				>
					{sortedRepos.length === 0 && isLoadingRepos ? (
						<div style={{ padding: "4px 0" }}>
							{Array.from({ length: 3 }).map((_, index) => (
								<RepoRowSkeleton key={`repo-skeleton-${index}`} />
							))}
						</div>
					) : null}

					{sidebarTab === "repo" ? (
						<PrRepoList
							repos={repos}
							repoFilter={repoFilter}
							removingRepoId={removingRepoId}
							onSelect={(repoPath) => {
								onFilterRepo(repoPath);
								if (isMobile) {
									setCollapsed(true);
								}
							}}
							onRemove={(repoId) => {
								const found = sortedRepos.find((item) => item.id === repoId);
								if (!found) {
									return;
								}
								setPendingRepoRemoval(found);
							}}
						/>
					) : (
						sortedRepos.map((repo) => (
							<RepoRow
								key={repo.id}
								repo={repo}
								isCurrent={repoFilter === repo.path}
								removingRepoId={removingRepoId}
								onSelect={() => {
									onFilterRepo(repo.path);
									if (isMobile) {
										setCollapsed(true);
									}
								}}
								onRemove={(repoId) => {
									const found = sortedRepos.find((item) => item.id === repoId);
									if (!found) {
										return;
									}
									setPendingRepoRemoval(found);
								}}
							/>
						))
					)}

					{!isLoadingRepos ? (
						<button
							type="button"
							className="kb-repo-row flex cursor-pointer items-center gap-1.5 rounded-md text-text-secondary hover:text-text-primary"
							style={{ padding: "6px 8px" }}
							onClick={onAddRepo}
							disabled={removingRepoId !== null}
						>
							<Plus size={14} className="shrink-0" />
							<span className="text-sm">Add Repo</span>
						</button>
					) : null}
				</div>
			</div>

			<AlertDialog
				open={pendingRepoRemoval !== null}
				onOpenChange={(open) => {
					if (!open && !isRepoRemovalPending) {
						setPendingRepoRemoval(null);
					}
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>Remove Repo</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogBody>
					<AlertDialogDescription asChild>
						<div className="flex flex-col gap-3">
							<p>{pendingRepoRemoval ? pendingRepoRemoval.name : "This repo"}</p>
							<p className="text-text-primary">
								This will delete all repo tasks ({pendingRepoTaskCount}), remove task workspaces/worktrees, and
								stop any running processes for this repo.
							</p>
							<p className="text-text-primary">This action cannot be undone.</p>
						</div>
					</AlertDialogDescription>
				</AlertDialogBody>
				<AlertDialogFooter>
					<AlertDialogCancel asChild>
						<Button
							variant="default"
							disabled={isRepoRemovalPending}
							onClick={() => {
								if (!isRepoRemovalPending) {
									setPendingRepoRemoval(null);
								}
							}}
						>
							Cancel
						</Button>
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button
							variant="danger"
							disabled={isRepoRemovalPending}
							onClick={async () => {
								if (!pendingRepoRemoval) {
									return;
								}
								const removed = await onRemoveRepo(pendingRepoRemoval.id);
								if (removed) {
									setPendingRepoRemoval(null);
								}
							}}
						>
							{isRepoRemovalPending ? (
								<>
									<Spinner size={14} />
									Removing...
								</>
							) : (
								"Remove Repo"
							)}
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialog>
		</aside>
	);
}

function RepoRowSkeleton(): React.ReactElement {
	return (
		<div
			className="flex items-center gap-1.5"
			style={{
				padding: "6px 8px",
			}}
		>
			<div className="flex-1 min-w-0">
				<div
					className="kb-skeleton"
					style={{
						height: 14,
						width: "58%",
						borderRadius: 3,
						marginBottom: 6,
					}}
				/>
				<div
					className="kb-skeleton font-mono"
					style={{
						height: 10,
						width: "86%",
						borderRadius: 3,
						marginBottom: 6,
					}}
				/>
				<div className="flex gap-1">
					<div className="kb-skeleton" style={{ height: 18, width: 30, borderRadius: 999 }} />
					<div className="kb-skeleton" style={{ height: 18, width: 30, borderRadius: 999 }} />
					<div className="kb-skeleton" style={{ height: 18, width: 30, borderRadius: 999 }} />
				</div>
			</div>
		</div>
	);
}

export function RepoRow({
	repo,
	isCurrent,
	removingRepoId,
	onSelect,
	onRemove,
}: {
	repo: RuntimeRepoSummary;
	isCurrent: boolean;
	removingRepoId: string | null;
	onSelect: () => void;
	onRemove: (id: string) => void;
}): React.ReactElement {
	const displayPath = formatPathForDisplay(repo.path);
	const isRemovingRepo = removingRepoId === repo.id;
	const hasAnyRepoRemoval = removingRepoId !== null;
	const isEmpty = repo.pullRequestCount === 0;
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const taskCountBadges: TaskCountBadge[] = [
		{
			id: "backlog",
			title: "Backlog",
			shortLabel: "B",
			toneClassName: "bg-text-primary/15 text-text-primary",
			count: repo.taskCounts.backlog,
		},
		{
			id: "in_progress",
			title: "In Progress",
			shortLabel: "IP",
			toneClassName: "bg-accent/20 text-accent",
			count: repo.taskCounts.in_progress,
		},
		{
			id: "review",
			title: "Review",
			shortLabel: "R",
			toneClassName: "bg-accent-2/20 text-accent-2",
			count: repo.taskCounts.review,
		},
		{
			id: "trash",
			title: "Trash",
			shortLabel: "T",
			toneClassName: "bg-status-red/20 text-status-red",
			count: repo.taskCounts.trash,
		},
	].filter((item) => item.count > 0);

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => onSelect()}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect();
				}
			}}
			className={cn("kb-repo-row cursor-pointer rounded-md", isCurrent && "kb-repo-row-selected")}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "6px 8px",
			}}
		>
			<div className="flex-1 min-w-0">
				<div
					className={cn(
						"font-medium whitespace-nowrap overflow-hidden text-ellipsis text-sm",
						isCurrent ? "text-accent-fg" : isEmpty ? "text-text-tertiary" : "text-text-primary",
					)}
				>
					{repo.name}
				</div>
				<div
					className={cn(
						"font-mono text-[10px] whitespace-nowrap overflow-hidden text-ellipsis",
						isCurrent ? "text-accent-fg/60" : isEmpty ? "text-text-tertiary/70" : "text-text-secondary",
					)}
				>
					{displayPath}
				</div>
				{taskCountBadges.length > 0 ? (
					<div className="flex gap-1 mt-1">
						{taskCountBadges.map((badge) => (
							<span
								key={badge.id}
								className={cn(
									"inline-flex items-center gap-1 rounded-full text-[10px] px-1.5 py-px font-medium",
									isCurrent ? "bg-accent-fg/20 text-accent-fg" : badge.toneClassName,
								)}
								title={badge.title}
							>
								<span>{badge.shortLabel}</span>
								<span style={{ opacity: 0.4 }}>|</span>
								<span>{badge.count}</span>
							</span>
						))}
					</div>
				) : null}
			</div>
			<div className="kb-repo-row-actions flex items-center" style={isMenuOpen ? { opacity: 1 } : undefined}>
				<DropdownMenu.Root open={isMenuOpen} onOpenChange={setIsMenuOpen}>
					<DropdownMenu.Trigger asChild>
						<Button
							variant="ghost"
							size="sm"
							icon={isRemovingRepo ? <Spinner size={12} /> : <Ellipsis size={14} />}
							disabled={hasAnyRepoRemoval && !isRemovingRepo}
							className={
								isCurrent
									? "text-accent-fg hover:bg-accent-fg/20 hover:text-accent-fg active:bg-accent-fg/30"
									: undefined
							}
							onClick={(e) => {
								e.stopPropagation();
							}}
							aria-label="Repo actions"
						/>
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content
							side="bottom"
							align="end"
							sideOffset={4}
							className="z-50 min-w-[140px] rounded-md border border-border-bright bg-surface-1 p-1 shadow-lg"
							onCloseAutoFocus={(event) => event.preventDefault()}
						>
							<DropdownMenu.Item
								className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-status-red cursor-pointer outline-none data-[highlighted]:bg-surface-3"
								onSelect={() => onRemove(repo.id)}
							>
								Delete
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			</div>
		</div>
	);
}
