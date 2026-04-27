import { ArrowLeft } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { JiraPullRequestDetailSidebar } from "@/components/jira-pull-request-detail-sidebar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { clampBetween } from "@/resize/resize-persistence";
import {
	loadResizePreference,
	persistResizePreference,
	type ResizeNumberPreference,
} from "@/resize/resize-preferences";
import { useResizeDrag } from "@/resize/use-resize-drag";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { LocalStorageKey } from "@/storage/local-storage-store";
import type { JiraPullRequest } from "@/types/jira";

const SIDEBAR_RATIO_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.JiraPullRequestDetailSidebarRatio,
	defaultValue: 0.35,
	normalize: (value) => clampBetween(value, 0.2, 0.6),
};

interface JiraPullRequestDetailViewProps {
	pullRequest: JiraPullRequest;
	onClose: () => void;
}

export function JiraPullRequestDetailView({ pullRequest, onClose }: JiraPullRequestDetailViewProps): React.ReactElement {
	const trpc = getRuntimeTrpcClient(null);

	const [activeSession, setActiveSession] = useState<{ workspaceId: string } | null>(null);
	const [isStartingSession, setIsStartingSession] = useState(false);
	const [sessionSummary, setSessionSummary] = useState<RuntimeTaskSessionSummary | null>(null);
	const [sidebarRatio, setSidebarRatioState] = useState(() => loadResizePreference(SIDEBAR_RATIO_PREFERENCE));

	const containerRef = useRef<HTMLDivElement>(null);
	const { startDrag } = useResizeDrag();

	useEffect(() => {
		setIsStartingSession(true);
		setActiveSession(null);
		setSessionSummary(null);
		trpc.jira.startPullRequestSession
			.mutate({ pullRequestId: pullRequest.id })
			.then((result) => {
				if (result.workspaceId) {
					setActiveSession({ workspaceId: result.workspaceId });
				}
			})
			.catch(() => {
				// Session start failed — terminal panel will show disconnected state
			})
			.finally(() => {
				setIsStartingSession(false);
			});
	}, [pullRequest.id, trpc]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	const setSidebarRatio = useCallback((ratio: number) => {
		setSidebarRatioState(persistResizePreference(SIDEBAR_RATIO_PREFERENCE, ratio));
	}, []);

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
		<div className="absolute inset-0 z-40 flex flex-col bg-surface-0">
			{/* Top bar */}
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
				<Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={onClose} />
				<span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-xs text-text-secondary">
					{pullRequest.jiraKey}
				</span>
				<span className="min-w-0 truncate text-sm text-text-primary">{pullRequest.title}</span>
			</div>

			{/* Body */}
			<div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
				{/* Sidebar */}
				<div className="min-w-0 overflow-hidden" style={{ flexBasis: `${sidebarRatio * 100}%`, flexShrink: 0 }}>
					<JiraPullRequestDetailSidebar pullRequestId={pullRequest.id} />
				</div>

				{/* Resize divider */}
				<div
					className="w-1 shrink-0 cursor-ew-resize bg-border hover:bg-border-bright"
					onMouseDown={handleDividerMouseDown}
				/>

				{/* Terminal */}
				<div className="min-w-0 flex-1 overflow-hidden">
					{isStartingSession ? (
						<div className="flex h-full items-center justify-center">
							<Spinner size={20} />
						</div>
					) : (
						<AgentTerminalPanel
							taskId={pullRequest.id}
							workspaceId={activeSession?.workspaceId ?? null}
							summary={sessionSummary}
							onSummary={setSessionSummary}
							showSessionToolbar={false}
							showMoveToTrash={false}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
