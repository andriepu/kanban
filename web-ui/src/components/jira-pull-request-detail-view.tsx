import * as RadixDialog from "@radix-ui/react-dialog";
import { ArrowLeft, Columns2, LayoutGrid, Rows2, Terminal } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import type {
	PrTerminalLayout,
	PullRequestTerminalPanelHandle,
} from "@/components/detail-panels/pull-request-terminal-panel";
import { PullRequestTerminalPanel } from "@/components/detail-panels/pull-request-terminal-panel";
import { JiraPullRequestDetailSidebar } from "@/components/jira-pull-request-detail-sidebar";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { Tooltip } from "@/components/ui/tooltip";
import { clampBetween } from "@/resize/resize-persistence";
import {
	loadResizePreference,
	persistResizePreference,
	type ResizeNumberPreference,
} from "@/resize/resize-preferences";
import { useResizeDrag } from "@/resize/use-resize-drag";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";
import { getStackedPrTerminalTaskIdMatcher, parseStackedPrTerminalCounter } from "@/terminal/pr-terminal-task-id";
import type { JiraPullRequest } from "@/types/jira";

const LAYOUT_CYCLE: PrTerminalLayout[] = ["vertical", "tiled", "horizontal"];

const LAYOUT_ICONS: Record<PrTerminalLayout, React.ReactElement> = {
	vertical: <Rows2 size={16} />,
	horizontal: <Columns2 size={16} />,
	tiled: <LayoutGrid size={16} />,
};

function loadTerminalLayout(): PrTerminalLayout {
	const stored = readLocalStorageItem(LocalStorageKey.JiraPullRequestDetailTerminalLayout);
	if (stored === "vertical" || stored === "horizontal" || stored === "tiled") {
		return stored;
	}
	return "vertical";
}

const SIDEBAR_RATIO_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.JiraPullRequestDetailSidebarRatio,
	defaultValue: 0.35,
	normalize: (value) => clampBetween(value, 0.2, 0.6),
};

interface JiraPullRequestDetailViewProps {
	pullRequest: JiraPullRequest;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	onClose: () => void;
}

export function JiraPullRequestDetailView({
	pullRequest,
	sessions,
	onClose,
}: JiraPullRequestDetailViewProps): React.ReactElement {
	const [sidebarRatio, setSidebarRatioState] = useState(() => loadResizePreference(SIDEBAR_RATIO_PREFERENCE));
	const [canAddTerminal, setCanAddTerminal] = useState(false);
	const [terminalLayout, setTerminalLayout] = useState<PrTerminalLayout>(loadTerminalLayout);
	const terminalPanelRef = useRef<PullRequestTerminalPanelHandle>(null);

	const cycleLayout = useCallback(() => {
		setTerminalLayout((current) => {
			const idx = LAYOUT_CYCLE.indexOf(current);
			const next = LAYOUT_CYCLE[(idx + 1) % LAYOUT_CYCLE.length] ?? "vertical";
			writeLocalStorageItem(LocalStorageKey.JiraPullRequestDetailTerminalLayout, next);
			return next;
		});
	}, []);

	// Compute once on mount — captures which stacked PTYs are currently alive for this PR.
	const initialStackedTaskIds = useMemo(() => {
		const isStacked = getStackedPrTerminalTaskIdMatcher(pullRequest.id);
		return Object.keys(sessions)
			.filter((taskId) => isStacked(taskId) && sessions[taskId]?.exitCode === null)
			.sort((a, b) => {
				const na = parseStackedPrTerminalCounter(a, pullRequest.id) ?? 0;
				const nb = parseStackedPrTerminalCounter(b, pullRequest.id) ?? 0;
				return na - nb;
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pullRequest.id]); // intentional: snapshot at mount, not reactive to sessions changes

	const containerRef = useRef<HTMLDivElement>(null);
	const { startDrag } = useResizeDrag();

	const setSidebarRatio = useCallback((ratio: number) => {
		setSidebarRatioState(persistResizePreference(SIDEBAR_RATIO_PREFERENCE, ratio));
	}, []);

	const handleOpenExternalUrl = useCallback(
		(url: string) => {
			window.open(url, "_blank", "noopener,noreferrer");
			onClose();
		},
		[onClose],
	);

	const handleDividerMouseDown = useCallback(
		(e: ReactMouseEvent) => {
			const container = containerRef.current;
			if (!container) return;
			startDrag(e, {
				axis: "x",
				cursor: "ew-resize",
				onMove: (pointer) => {
					const rect = container.getBoundingClientRect();
					const ratio = (pointer - rect.left) / rect.width;
					setSidebarRatio(ratio);
				},
			});
		},
		[startDrag, setSidebarRatio],
	);

	return (
		<RadixDialog.Root
			open
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<RadixDialog.Portal>
				<RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/60 touch-none" />
				<RadixDialog.Content
					className="fixed inset-0 z-50 flex flex-col bg-surface-0 focus:outline-none"
					style={{ transform: "none" }}
					onEscapeKeyDown={(event) => event.preventDefault()}
					aria-describedby={undefined}
				>
					<RadixDialog.Title className="sr-only">{pullRequest.title}</RadixDialog.Title>

					{/* Top bar */}
					<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
						<Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={onClose} />
						<span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-xs text-text-secondary">
							{pullRequest.jiraKey}
						</span>
						<span className="min-w-0 truncate text-sm text-text-primary">{pullRequest.title}</span>
						{pullRequest.prUrl != null && pullRequest.prNumber != null && (
							<Link href={pullRequest.prUrl} external className="shrink-0 text-sm">
								#{pullRequest.prNumber}
							</Link>
						)}
						<div className="ml-auto flex shrink-0 items-center gap-1">
							<Tooltip content={`Layout: ${terminalLayout}`}>
								<Button
									variant="ghost"
									size="sm"
									icon={LAYOUT_ICONS[terminalLayout]}
									onClick={cycleLayout}
									aria-label="Cycle terminal layout"
								/>
							</Tooltip>
							<Tooltip content="Add stacked terminal">
								<Button
									variant="ghost"
									size="sm"
									icon={<Terminal size={16} />}
									onClick={() => void terminalPanelRef.current?.addStackedTerminal()}
									disabled={!canAddTerminal}
									aria-label="Add stacked terminal"
								/>
							</Tooltip>
						</div>
					</div>

					{/* Body */}
					<div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
						{/* Sidebar */}
						<div
							className="min-w-0 overflow-hidden"
							style={{ flexBasis: `${sidebarRatio * 100}%`, flexShrink: 0 }}
						>
							<JiraPullRequestDetailSidebar pullRequestId={pullRequest.id} />
						</div>

						{/* Resize divider */}
						<div
							className="w-1 shrink-0 cursor-ew-resize bg-border hover:bg-border-bright"
							onMouseDown={handleDividerMouseDown}
						/>

						{/* Terminal */}
						<div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-1">
							<PullRequestTerminalPanel
								ref={terminalPanelRef}
								pullRequestId={pullRequest.id}
								baseRef={pullRequest.baseRef}
								layout={terminalLayout}
								initialStackedTaskIds={initialStackedTaskIds}
								sessions={sessions}
								onOpenExternalUrl={handleOpenExternalUrl}
								onReadyChange={setCanAddTerminal}
								onClose={onClose}
							/>
						</div>
					</div>
				</RadixDialog.Content>
			</RadixDialog.Portal>
		</RadixDialog.Root>
	);
}
