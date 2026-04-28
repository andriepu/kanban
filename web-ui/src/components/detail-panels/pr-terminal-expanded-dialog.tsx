import * as RadixDialog from "@radix-ui/react-dialog";
import { Minimize2 } from "lucide-react";
import type { ReactElement } from "react";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { ThemeTerminalColors } from "@/hooks/use-theme";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";

interface PrTerminalExpandedDialogProps {
	taskId: string;
	workspaceId: string;
	summary: RuntimeTaskSessionSummary | null;
	onSummary: (summary: RuntimeTaskSessionSummary) => void;
	onCollapse: () => void;
	terminalThemeColors: ThemeTerminalColors;
	terminalFontFamily: string | null;
}

export function PrTerminalExpandedDialog({
	taskId,
	workspaceId,
	summary,
	onSummary,
	onCollapse,
	terminalThemeColors,
	terminalFontFamily,
}: PrTerminalExpandedDialogProps): ReactElement {
	return (
		<RadixDialog.Root open>
			<RadixDialog.Portal>
				<RadixDialog.Overlay className="fixed inset-0 z-[60] bg-black/70 touch-none" />
				<RadixDialog.Content
					className="fixed inset-0 z-[60] flex flex-col bg-surface-0 focus:outline-none"
					style={{ transform: "none" }}
					onEscapeKeyDown={(e) => e.preventDefault()}
					onPointerDownOutside={(e) => e.preventDefault()}
					aria-describedby={undefined}
				>
					<RadixDialog.Title className="sr-only">Expanded terminal</RadixDialog.Title>

					<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
						<span className="text-sm text-text-secondary">Terminal</span>
						<span className="font-mono text-xs text-text-tertiary truncate">{taskId}</span>
						<div className="ml-auto shrink-0">
							<Tooltip content="Collapse">
								<Button
									variant="ghost"
									size="sm"
									icon={<Minimize2 size={16} />}
									onClick={onCollapse}
									aria-label="Collapse terminal"
								/>
							</Tooltip>
						</div>
					</div>

					<div
						className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-1"
						style={{ paddingLeft: 12, paddingRight: 12 }}
					>
						<AgentTerminalPanel
							taskId={taskId}
							workspaceId={workspaceId}
							summary={summary}
							onSummary={onSummary}
							showSessionToolbar={false}
							showMoveToTrash={false}
							panelBackgroundColor="var(--color-surface-1)"
							terminalBackgroundColor={terminalThemeColors.surfaceRaised}
							cursorColor={terminalThemeColors.textPrimary}
							terminalFontFamily={terminalFontFamily}
							autoFocus
						/>
					</div>
				</RadixDialog.Content>
			</RadixDialog.Portal>
		</RadixDialog.Root>
	);
}
