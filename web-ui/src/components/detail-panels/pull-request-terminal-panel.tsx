import type { ReactElement } from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { notifyError } from "@/components/app-toaster";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { useRuntimeRepoConfig } from "@/runtime/use-runtime-repo-config";
import {
	getPrTerminalTaskId,
	PR_TERMINAL_TASK_PREFIX,
	parseStackedPrTerminalCounter,
} from "@/terminal/pr-terminal-task-id";
import { sendShellTerminalInput, startShellTerminalSession } from "@/terminal/shell-session-flow";
import { useTerminalThemeColors } from "@/terminal/theme-colors";

const PR_TERMINAL_INITIAL_COLS = 120;
const PR_TERMINAL_INITIAL_ROWS = 16;
const PR_TERMINAL_INITIAL_COMMAND = "claude";

interface ActiveShellSession {
	workspaceId: string;
	taskId: string;
}

interface StackedSession {
	taskId: string;
	summary: RuntimeTaskSessionSummary | null;
}

export interface PullRequestTerminalPanelHandle {
	addStackedTerminal: () => Promise<void>;
}

export interface PullRequestTerminalPanelProps {
	pullRequestId: string;
	baseRef: string;
	initialStackedTaskIds?: string[];
	sessions?: Record<string, RuntimeTaskSessionSummary>;
	onOpenExternalUrl: (url: string) => void;
	onReadyChange?: (ready: boolean) => void;
}

export const PullRequestTerminalPanel = forwardRef<PullRequestTerminalPanelHandle, PullRequestTerminalPanelProps>(
	function PullRequestTerminalPanel(
		{ pullRequestId, baseRef, initialStackedTaskIds, sessions, onOpenExternalUrl, onReadyChange },
		ref,
	): ReactElement {
		const terminalThemeColors = useTerminalThemeColors();
		const [activeSession, setActiveSession] = useState<ActiveShellSession | null>(null);
		const [isStartingSession, setIsStartingSession] = useState(false);
		const [sessionError, setSessionError] = useState<string | null>(null);
		const [sessionSummary, setSessionSummary] = useState<RuntimeTaskSessionSummary | null>(null);
		const [stackedSessions, setStackedSessions] = useState<StackedSession[]>([]);
		const { config: runtimeRepoConfig } = useRuntimeRepoConfig(activeSession?.workspaceId ?? null);

		const stackedCounterRef = useRef(0);
		const sessionContextRef = useRef<{ workspaceId: string; worktreePath: string | undefined } | null>(null);
		const sessionsRef = useRef(sessions);
		sessionsRef.current = sessions;
		const onOpenExternalUrlRef = useRef(onOpenExternalUrl);
		onOpenExternalUrlRef.current = onOpenExternalUrl;
		const onReadyChangeRef = useRef(onReadyChange);
		onReadyChangeRef.current = onReadyChange;

		useImperativeHandle(
			ref,
			() => ({
				addStackedTerminal: async () => {
					const ctx = sessionContextRef.current;
					if (!ctx) {
						return;
					}
					const counter = ++stackedCounterRef.current;
					const taskId = `${PR_TERMINAL_TASK_PREFIX}${pullRequestId}:stacked:${counter}`;
					try {
						const shellResult = await startShellTerminalSession({
							workspaceId: ctx.workspaceId,
							taskId,
							cols: PR_TERMINAL_INITIAL_COLS,
							rows: PR_TERMINAL_INITIAL_ROWS,
							baseRef,
							customCwd: ctx.worktreePath,
						});
						if (!shellResult.ok || !shellResult.summary) {
							notifyError(shellResult.error ?? "Could not start stacked terminal session.");
							return;
						}
						setStackedSessions((prev) => [...prev, { taskId, summary: shellResult.summary! }]);
					} catch (err: unknown) {
						notifyError(err instanceof Error ? err.message : "Failed to start stacked terminal.");
					}
				},
			}),
			[pullRequestId, baseRef],
		);

		useEffect(() => {
			let isCancelled = false;
			setIsStartingSession(true);
			setActiveSession(null);
			setSessionError(null);
			setSessionSummary(null);
			sessionContextRef.current = null;
			onReadyChangeRef.current?.(false);

			// Rehydrate stacked terminals from sessions already alive on the server.
			if (initialStackedTaskIds && initialStackedTaskIds.length > 0) {
				const snapshot = sessionsRef.current ?? {};
				const rehydrated: StackedSession[] = initialStackedTaskIds.map((taskId) => ({
					taskId,
					summary: snapshot[taskId] ?? null,
				}));
				setStackedSessions(rehydrated);
				const maxCounter = initialStackedTaskIds.reduce<number>((max, id) => {
					const n = parseStackedPrTerminalCounter(id, pullRequestId);
					return n !== null && n > max ? n : max;
				}, 0);
				stackedCounterRef.current = maxCounter;
			} else {
				setStackedSessions([]);
				stackedCounterRef.current = 0;
			}

			const trpc = getRuntimeTrpcClient(null);
			void (async () => {
				try {
					const result = await trpc.jira.startPullRequestSession.mutate({ pullRequestId });
					if (isCancelled) {
						return;
					}
					if (result.openUrl) {
						onOpenExternalUrlRef.current(result.openUrl);
						return;
					}
					if (!result.workspaceId) {
						setSessionError("Session not available — no workspace or PR URL was returned.");
						return;
					}

					const taskId = getPrTerminalTaskId(pullRequestId);
					const shellResult = await startShellTerminalSession({
						workspaceId: result.workspaceId,
						taskId,
						cols: PR_TERMINAL_INITIAL_COLS,
						rows: PR_TERMINAL_INITIAL_ROWS,
						baseRef,
						customCwd: result.worktreePath,
					});
					if (isCancelled) {
						return;
					}
					if (!shellResult.ok || !shellResult.summary) {
						setSessionError(shellResult.error ?? "Could not start terminal session.");
						return;
					}

					sessionContextRef.current = {
						workspaceId: result.workspaceId,
						worktreePath: result.worktreePath ?? undefined,
					};
					setActiveSession({ workspaceId: result.workspaceId, taskId });
					setSessionSummary(shellResult.summary);
					onReadyChangeRef.current?.(true);

					// Bootstrap the agent CLI when no claude process is running under this
					// shell. We scan the PTY's descendant process tree because IPty.process
					// reports COMM (e.g. "node" for Node-based CLIs), which doesn't reliably
					// identify claude. Argv-based matching catches `node /path/claude/cli.js`.
					const needle = PR_TERMINAL_INITIAL_COMMAND.toLowerCase();
					const agentRunning = shellResult.descendantCommands.some((cmd) => cmd.toLowerCase().includes(needle));
					if (!agentRunning) {
						await sendShellTerminalInput({
							workspaceId: result.workspaceId,
							taskId,
							text: PR_TERMINAL_INITIAL_COMMAND,
							appendNewline: true,
						});
					}
				} catch (err: unknown) {
					if (isCancelled) {
						return;
					}
					setSessionError(err instanceof Error ? err.message : "Failed to start session.");
				} finally {
					if (!isCancelled) {
						setIsStartingSession(false);
					}
				}
			})();
			return () => {
				isCancelled = true;
				onReadyChangeRef.current?.(false);
			};
		}, [pullRequestId, baseRef]);

		if (isStartingSession) {
			return (
				<div className="flex h-full items-center justify-center">
					<Spinner size={20} />
				</div>
			);
		}

		if (sessionError) {
			return (
				<div className="flex h-full items-center justify-center p-6">
					<p className="max-w-sm text-center text-sm text-status-red">{sessionError}</p>
				</div>
			);
		}

		if (!activeSession) {
			return <div className="flex h-full" />;
		}

		return (
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					flex: "1 1 0",
					minWidth: 0,
					paddingLeft: 12,
					paddingRight: 12,
				}}
			>
				<div style={{ display: "flex", flex: "1 1 0", minHeight: 0 }}>
					<AgentTerminalPanel
						taskId={activeSession.taskId}
						workspaceId={activeSession.workspaceId}
						summary={sessionSummary}
						onSummary={setSessionSummary}
						showSessionToolbar={false}
						showMoveToTrash={false}
						panelBackgroundColor="var(--color-surface-1)"
						terminalBackgroundColor={terminalThemeColors.surfaceRaised}
						cursorColor={terminalThemeColors.textPrimary}
						terminalFontFamily={runtimeRepoConfig?.terminalFontFamily ?? null}
					/>
				</div>
				{stackedSessions.map(({ taskId, summary }) => (
					<div key={taskId} style={{ display: "flex", flexDirection: "column", flex: "1 1 0", minHeight: 0 }}>
						<div className="h-px bg-border" />
						<AgentTerminalPanel
							taskId={taskId}
							workspaceId={activeSession.workspaceId}
							summary={summary}
							onSummary={(updated) => {
								setStackedSessions((prev) =>
									prev.map((s) => (s.taskId === taskId ? { ...s, summary: updated } : s)),
								);
							}}
							showSessionToolbar={false}
							showMoveToTrash={false}
							panelBackgroundColor="var(--color-surface-1)"
							terminalBackgroundColor={terminalThemeColors.surfaceRaised}
							cursorColor={terminalThemeColors.textPrimary}
							terminalFontFamily={runtimeRepoConfig?.terminalFontFamily ?? null}
							onClose={() => {
								setStackedSessions((prev) => prev.filter((s) => s.taskId !== taskId));
							}}
						/>
					</div>
				))}
			</div>
		);
	},
);
