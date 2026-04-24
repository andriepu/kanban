import { cn } from "@/components/ui/cn";
import { ColumnIndicator } from "@/components/ui/column-indicator";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { JiraSubtask, JiraSubtaskStatus } from "@/types/jira";

const SUBTASK_COLUMNS: Array<{ id: JiraSubtaskStatus; label: string }> = [
  { id: "backlog", label: "Backlog" },
  { id: "in_progress", label: "In Progress" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

export function JiraSubtaskBoard({
  subtasks,
  projectFilter,
  sessions,
  onSubtaskClick,
}: {
  subtasks: JiraSubtask[];
  projectFilter: string | null;
  sessions: Record<string, RuntimeTaskSessionSummary>;
  onSubtaskClick: (subtask: JiraSubtask) => void;
}): React.ReactElement {
  const filtered =
    projectFilter === null ? subtasks : subtasks.filter((s) => s.repoPath === projectFilter);

  return (
    <div className="flex h-full flex-1 gap-2 overflow-x-auto p-2">
      {SUBTASK_COLUMNS.map((col) => {
        const colSubtasks = filtered.filter((s) => s.status === col.id);
        return (
          <SubtaskColumn
            key={col.id}
            columnId={col.id}
            label={col.label}
            subtasks={colSubtasks}
            sessions={sessions}
            showRepoName={projectFilter === null}
            onSubtaskClick={onSubtaskClick}
          />
        );
      })}
    </div>
  );
}

function SubtaskColumn({
  columnId,
  label,
  subtasks,
  sessions,
  showRepoName,
  onSubtaskClick,
}: {
  columnId: JiraSubtaskStatus;
  label: string;
  subtasks: JiraSubtask[];
  sessions: Record<string, RuntimeTaskSessionSummary>;
  showRepoName: boolean;
  onSubtaskClick: (subtask: JiraSubtask) => void;
}): React.ReactElement {
  return (
    <div
      data-column-id={columnId}
      className="flex flex-1 min-w-56 min-h-0 flex-col rounded-lg bg-surface-1 overflow-hidden border border-border"
    >
      <div className="flex h-10 items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <ColumnIndicator columnId={columnId} />
          <span className="font-semibold text-sm">{label}</span>
        </div>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-tertiary">{subtasks.length}</span>
      </div>
      <div className="flex flex-col gap-2 p-1.5 overflow-y-auto min-h-0">
        {subtasks.map((subtask) => (
          <SubtaskCard
            key={subtask.id}
            subtask={subtask}
            isRunning={Boolean(sessions[subtask.id])}
            showRepoName={showRepoName}
            onClick={onSubtaskClick}
          />
        ))}
      </div>
    </div>
  );
}

function SubtaskCard({
  subtask,
  isRunning,
  showRepoName,
  onClick,
}: {
  subtask: JiraSubtask;
  isRunning: boolean;
  showRepoName: boolean;
  onClick: (subtask: JiraSubtask) => void;
}): React.ReactElement {
  const repoName = subtask.repoPath.split("/").pop() ?? subtask.repoPath;

  return (
    <button
      type="button"
      data-subtask-id={subtask.id}
      onClick={() => onClick(subtask)}
      className="w-full cursor-pointer rounded-md bg-surface-2 p-3 text-left transition-colors hover:bg-surface-3"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-text-secondary shrink-0">
          {subtask.jiraKey}
        </span>
        {isRunning && (
          <span className="inline-flex size-2 rounded-full bg-status-green shrink-0" title="Running" />
        )}
      </div>
      <p className="text-sm text-text-primary font-medium truncate">{subtask.title}</p>
      <p className="font-mono text-[11px] text-text-tertiary truncate mt-0.5">{subtask.branchName}</p>
      {showRepoName && (
        <p
          data-repo-name=""
          className={cn(
            "font-mono text-[10px] mt-1 truncate",
            isRunning ? "text-status-green" : "text-text-tertiary",
          )}
        >
          {repoName}
        </p>
      )}
    </button>
  );
}
