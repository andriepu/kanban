import { ArrowDown, ArrowLeft, ArrowUp, Bug, CircleArrowDown, GitBranch, Menu, Settings } from "lucide-react";
import { OpenWorkspaceButton } from "@/components/open-workspace-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-is-mobile";
import type { RuntimeGitSyncAction } from "@/runtime/types";
import {
	useHomeGitSummaryValue,
	useTaskWorkspaceInfoValue,
	useTaskWorkspaceSnapshotValue,
} from "@/stores/workspace-metadata-store";
import type { OpenTargetId, OpenTargetOption } from "@/utils/open-targets";
import { formatPathForDisplay } from "@/utils/path-display";

const MOBILE_TOUCH_TARGET = "min-w-[44px] min-h-[44px]";

function getWorkspacePathSegments(path: string): string[] {
	return path
		.replaceAll("\\", "/")
		.split("/")
		.filter((segment) => segment.length > 0);
}

function GitBranchStatusControl({
	branchLabel,
	changedFiles,
	additions,
	deletions,
	onToggleGitHistory,
	isGitHistoryOpen,
}: {
	branchLabel: string;
	changedFiles: number;
	additions: number;
	deletions: number;
	onToggleGitHistory?: () => void;
	isGitHistoryOpen?: boolean;
}): React.ReactElement {
	if (onToggleGitHistory) {
		return (
			<div className="flex items-center min-w-0 overflow-hidden">
				<Button
					variant={isGitHistoryOpen ? "primary" : "default"}
					size="sm"
					icon={<GitBranch size={12} />}
					onClick={onToggleGitHistory}
					className={cn(
						"font-mono text-xs shrink min-w-0 max-w-full overflow-hidden",
						isGitHistoryOpen ? "ring-1 ring-accent" : "kb-navbar-btn",
					)}
					title={branchLabel}
				>
					<span className="truncate w-full text-left">{branchLabel}</span>
				</Button>
				<span className="font-mono text-xs text-text-tertiary ml-1.5 shrink-0 whitespace-nowrap">
					({changedFiles} {changedFiles === 1 ? "file" : "files"}
					<span className="text-status-green"> +{additions}</span>
					<span className="text-status-red"> -{deletions}</span>)
				</span>
			</div>
		);
	}

	return (
		<span className="font-mono text-xs text-text-secondary mr-1 whitespace-nowrap">
			<GitBranch size={12} className="inline-block mr-1" style={{ verticalAlign: -1 }} />
			<span className="text-text-primary">{branchLabel}</span>
			<span className="ml-1.5">
				<span className="text-text-tertiary">
					({changedFiles} {changedFiles === 1 ? "file" : "files"}
				</span>
				<span className="text-status-green"> +{additions}</span>
				<span className="text-status-red"> -{deletions}</span>
				<span className="text-text-tertiary">)</span>
			</span>
		</span>
	);
}

function TopBarGitStatusSection({
	showHomeGitSummary,
	selectedTaskId,
	selectedTaskBaseRef,
	onToggleGitHistory,
	isGitHistoryOpen,
	runningGitAction,
	onGitFetch,
	onGitPull,
	onGitPush,
}: {
	showHomeGitSummary: boolean;
	selectedTaskId: string | null;
	selectedTaskBaseRef: string | null;
	onToggleGitHistory?: () => void;
	isGitHistoryOpen?: boolean;
	runningGitAction?: RuntimeGitSyncAction | null;
	onGitFetch?: () => void;
	onGitPull?: () => void;
	onGitPush?: () => void;
}): React.ReactElement | null {
	const homeGitSummary = useHomeGitSummaryValue();
	const taskWorkspaceInfo = useTaskWorkspaceInfoValue(selectedTaskId, selectedTaskBaseRef);
	const taskWorkspaceSnapshot = useTaskWorkspaceSnapshotValue(selectedTaskId);

	if (showHomeGitSummary && homeGitSummary) {
		const branchLabel = homeGitSummary.currentBranch ?? "detached HEAD";
		const pullCount = homeGitSummary.behindCount ?? 0;
		const pushCount = homeGitSummary.aheadCount ?? 0;
		const pullTooltip =
			pullCount > 0
				? `Pull ${pullCount} commit${pullCount === 1 ? "" : "s"} from upstream into your local branch.`
				: "Pull from upstream. Branch is already up to date.";
		const pushTooltip =
			pushCount > 0
				? `Push ${pushCount} local commit${pushCount === 1 ? "" : "s"} to upstream.`
				: "Push local commits to upstream. No local commits are pending.";
		return (
			<>
				<div className="w-px h-5 bg-border mx-1" />
				<GitBranchStatusControl
					branchLabel={branchLabel}
					changedFiles={homeGitSummary.changedFiles ?? 0}
					additions={homeGitSummary.additions ?? 0}
					deletions={homeGitSummary.deletions ?? 0}
					onToggleGitHistory={onToggleGitHistory}
					isGitHistoryOpen={isGitHistoryOpen}
				/>
				<div className="flex gap-0 ml-1">
					<Tooltip
						side="bottom"
						content="Fetch latest refs from upstream without changing your local branch or files."
					>
						<Button
							variant="ghost"
							size="sm"
							icon={runningGitAction === "fetch" ? <Spinner size={14} /> : <CircleArrowDown size={18} />}
							onClick={onGitFetch}
							disabled={runningGitAction === "fetch"}
							aria-label="Fetch from upstream"
						/>
					</Tooltip>
					<Tooltip side="bottom" content={pullTooltip}>
						<Button
							variant="ghost"
							size="sm"
							icon={runningGitAction === "pull" ? <Spinner size={14} /> : <ArrowDown size={14} />}
							onClick={onGitPull}
							disabled={runningGitAction === "pull"}
							aria-label="Pull from upstream"
						>
							<span className="text-text-tertiary">{pullCount}</span>
						</Button>
					</Tooltip>
					<Tooltip side="bottom" content={pushTooltip}>
						<Button
							variant="ghost"
							size="sm"
							icon={runningGitAction === "push" ? <Spinner size={14} /> : <ArrowUp size={14} />}
							onClick={onGitPush}
							disabled={runningGitAction === "push"}
							aria-label="Push to upstream"
						>
							<span className="text-text-tertiary">{pushCount}</span>
						</Button>
					</Tooltip>
				</div>
			</>
		);
	}

	if (selectedTaskId && (taskWorkspaceInfo || taskWorkspaceSnapshot)) {
		return (
			<>
				<div className="w-px h-5 bg-border mx-1" />
				<GitBranchStatusControl
					branchLabel={
						taskWorkspaceInfo?.branch ?? taskWorkspaceSnapshot?.headCommit?.slice(0, 8) ?? "initializing"
					}
					changedFiles={taskWorkspaceSnapshot?.changedFiles ?? 0}
					additions={taskWorkspaceSnapshot?.additions ?? 0}
					deletions={taskWorkspaceSnapshot?.deletions ?? 0}
					onToggleGitHistory={onToggleGitHistory}
					isGitHistoryOpen={isGitHistoryOpen}
				/>
			</>
		);
	}

	return null;
}

export function TopBar({
	onToggleSidebar,
	onBack,
	workspacePath,
	isWorkspacePathLoading = false,
	workspaceHint,
	runtimeHint,
	selectedTaskId,
	selectedTaskBaseRef,
	showHomeGitSummary,
	runningGitAction,
	onGitFetch,
	onGitPull,
	onGitPush,
	onToggleGitHistory,
	isGitHistoryOpen,
	onOpenSettings,
	showDebugButton,
	onOpenDebugDialog,
	openTargetOptions,
	selectedOpenTargetId,
	onSelectOpenTarget,
	onOpenWorkspace,
	canOpenWorkspace,
	isOpeningWorkspace,
	hideRepoDependentActions = false,
}: {
	onToggleSidebar?: () => void;
	onBack?: () => void;
	workspacePath?: string;
	isWorkspacePathLoading?: boolean;
	workspaceHint?: string;
	runtimeHint?: string;
	selectedTaskId?: string | null;
	selectedTaskBaseRef?: string | null;
	showHomeGitSummary?: boolean;
	runningGitAction?: RuntimeGitSyncAction | null;
	onGitFetch?: () => void;
	onGitPull?: () => void;
	onGitPush?: () => void;
	onToggleGitHistory?: () => void;
	isGitHistoryOpen?: boolean;
	onOpenSettings?: () => void;
	showDebugButton?: boolean;
	onOpenDebugDialog?: () => void;
	openTargetOptions: readonly OpenTargetOption[];
	selectedOpenTargetId: OpenTargetId;
	onSelectOpenTarget: (targetId: OpenTargetId) => void;
	onOpenWorkspace: () => void;
	canOpenWorkspace: boolean;
	isOpeningWorkspace: boolean;
	hideRepoDependentActions?: boolean;
}): React.ReactElement {
	const isMobile = useIsMobile();
	const displayWorkspacePath = workspacePath ? formatPathForDisplay(workspacePath) : null;
	const workspaceSegments = displayWorkspacePath ? getWorkspacePathSegments(displayWorkspacePath) : [];
	const hasAbsoluteLeadingSlash = Boolean(displayWorkspacePath?.startsWith("/"));

	return (
		<nav
			className="kb-top-bar flex flex-nowrap items-center h-10 min-h-[40px] min-w-0 bg-surface-1"
			style={{
				paddingLeft: onBack ? 6 : 12,
				paddingRight: 8,
				borderBottom: "1px solid var(--color-divider)",
			}}
		>
			{/* ---- Left side: hamburger/back, path, hints, git ---- */}
			<div className="flex flex-nowrap items-center h-10 flex-1 min-w-0 overflow-hidden gap-1.5">
				{isMobile && onToggleSidebar ? (
					<Button
						variant="ghost"
						size="sm"
						icon={<Menu size={16} />}
						onClick={onToggleSidebar}
						aria-label="Toggle sidebar"
						className={cn("shrink-0", MOBILE_TOUCH_TARGET)}
					/>
				) : null}
				{onBack ? (
					<div className="flex items-center shrink-0 overflow-visible">
						<Button
							variant="ghost"
							size="sm"
							icon={<ArrowLeft size={16} />}
							onClick={onBack}
							aria-label="Back to board"
							className={cn("mr-1 shrink-0", isMobile && MOBILE_TOUCH_TARGET)}
						/>
					</div>
				) : null}

				{/* Workspace path */}
				{isWorkspacePathLoading ? (
					<span
						className="kb-skeleton inline-block"
						style={{ height: 14, width: isMobile ? 120 : 320, borderRadius: 3 }}
						aria-hidden
					/>
				) : displayWorkspacePath ? (
					<div className={cn("shrink min-w-0 overflow-hidden", isMobile ? "max-w-[180px]" : "max-w-[640px]")}>
						<span
							className="font-mono truncate block w-full min-w-0 text-xs max-w-full text-text-secondary"
							title={workspacePath}
							data-testid="workspace-path"
						>
							{isMobile ? (
								<span className="text-text-primary">{workspaceSegments[workspaceSegments.length - 1]}</span>
							) : (
								<>
									{hasAbsoluteLeadingSlash ? "/" : ""}
									{workspaceSegments.map((segment, index) => {
										const isLast = index === workspaceSegments.length - 1;
										return (
											<span key={`${segment}-${index}`}>
												{index === 0 ? "" : "/"}
												<span className={isLast ? "text-text-primary" : undefined}>{segment}</span>
											</span>
										);
									})}
								</>
							)}
						</span>
					</div>
				) : null}

				{/* Desktop-only: open-workspace button, hints, git status */}
				{!isMobile ? (
					<>
						{displayWorkspacePath && !isWorkspacePathLoading ? (
							<div className="ml-2 shrink-0">
								<OpenWorkspaceButton
									options={openTargetOptions}
									selectedOptionId={selectedOpenTargetId}
									disabled={!canOpenWorkspace || isOpeningWorkspace}
									loading={isOpeningWorkspace}
									onOpen={onOpenWorkspace}
									onSelectOption={onSelectOpenTarget}
								/>
							</div>
						) : null}
						{!hideRepoDependentActions && workspaceHint ? (
							<span className="kb-navbar-tag inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs text-text-secondary">
								{workspaceHint}
							</span>
						) : null}
						{!hideRepoDependentActions && runtimeHint ? (
							onOpenSettings ? (
								<button
									type="button"
									onClick={() => onOpenSettings()}
									className="kb-navbar-tag inline-flex items-center rounded border border-status-orange/30 bg-status-orange/10 px-1.5 py-0.5 text-xs text-status-orange transition-colors hover:bg-status-orange/15 focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-0"
								>
									{runtimeHint}
								</button>
							) : (
								<span className="kb-navbar-tag inline-flex items-center rounded border border-status-orange/30 bg-status-orange/10 px-1.5 py-0.5 text-xs text-status-orange">
									{runtimeHint}
								</span>
							)
						) : null}
						{!hideRepoDependentActions ? (
							<TopBarGitStatusSection
								showHomeGitSummary={showHomeGitSummary === true}
								selectedTaskId={selectedTaskId ?? null}
								selectedTaskBaseRef={selectedTaskBaseRef ?? null}
								onToggleGitHistory={onToggleGitHistory}
								isGitHistoryOpen={isGitHistoryOpen}
								runningGitAction={runningGitAction}
								onGitFetch={onGitFetch}
								onGitPull={onGitPull}
								onGitPush={onGitPush}
							/>
						) : null}
					</>
				) : null}
			</div>

			{/* ---- Right side: actions ---- */}
			<div className="flex flex-nowrap items-center h-10 pr-0.5 shrink-0">
				{!isMobile && showDebugButton && onOpenDebugDialog ? (
					<Button
						variant="ghost"
						size="sm"
						icon={<Bug size={16} />}
						onClick={onOpenDebugDialog}
						aria-label="Debug"
						data-testid="open-debug-dialog-button"
						className="ml-0.5 mr-0.5"
					/>
				) : null}

				{/* Settings: always visible */}
				<Button
					variant="ghost"
					size="sm"
					icon={<Settings size={16} />}
					onClick={() => onOpenSettings?.()}
					aria-label="Settings"
					data-testid="open-settings-button"
					className={cn("ml-0.5 mr-0.5", isMobile && MOBILE_TOUCH_TARGET)}
				/>
			</div>
		</nav>
	);
}
