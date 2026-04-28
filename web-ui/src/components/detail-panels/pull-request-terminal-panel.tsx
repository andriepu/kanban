import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { useRuntimeRepoConfig } from "@/runtime/use-runtime-repo-config";
import { sendShellTerminalInput, startShellTerminalSession } from "@/terminal/shell-session-flow";
import { useTerminalThemeColors } from "@/terminal/theme-colors";

const PR_TERMINAL_TASK_PREFIX = "__pr_terminal__:";
const PR_TERMINAL_INITIAL_COLS = 120;
const PR_TERMINAL_INITIAL_ROWS = 16;
const PR_TERMINAL_INITIAL_COMMAND = "claude";

interface ActiveShellSession {
	workspaceId: string;
	taskId: string;
}

export interface PullRequestTerminalPanelProps {
	pullRequestId: string;
	baseRef: string;
	onOpenExternalUrl: (url: string) => void;
}

export function PullRequestTerminalPanel({
	pullRequestId,
	baseRef,
	onOpenExternalUrl,
}: PullRequestTerminalPanelProps): ReactElement {
	const terminalThemeColors = useTerminalThemeColors();
	const [activeSession, setActiveSession] = useState<ActiveShellSession | null>(null);
	const [isStartingSession, setIsStartingSession] = useState(false);
	const [sessionError, setSessionError] = useState<string | null>(null);
	const [sessionSummary, setSessionSummary] = useState<RuntimeTaskSessionSummary | null>(null);
	const { config: runtimeRepoConfig } = useRuntimeRepoConfig(activeSession?.workspaceId ?? null);

	const onOpenExternalUrlRef = useRef(onOpenExternalUrl);
	onOpenExternalUrlRef.current = onOpenExternalUrl;

	useEffect(() => {
		let isCancelled = false;
		setIsStartingSession(true);
		setActiveSession(null);
		setSessionError(null);
		setSessionSummary(null);
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

				const taskId = `${PR_TERMINAL_TASK_PREFIX}${pullRequestId}`;
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

				setActiveSession({ workspaceId: result.workspaceId, taskId });
				setSessionSummary(shellResult.summary);

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
				flex: "1 1 0",
				minWidth: 0,
				paddingLeft: 12,
				paddingRight: 12,
			}}
		>
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
	);
}
