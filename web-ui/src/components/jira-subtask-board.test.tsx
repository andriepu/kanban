import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JiraSubtaskBoard } from "@/components/jira-subtask-board";
import type { JiraSubtask } from "@/types/jira";

function makeSubtask(overrides: Partial<JiraSubtask> = {}): JiraSubtask {
  return {
    id: "subtask-1",
    jiraKey: "KAN-1",
    repoId: "repo-1",
    repoPath: "/projects/alpha",
    prompt: "Do the thing",
    title: "Implement feature",
    baseRef: "main",
    branchName: "feature/kan-1-implement-feature",
    worktreePath: "/worktrees/kan-1",
    status: "backlog",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("JiraSubtaskBoard", () => {
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

  it("renders all four columns", () => {
    act(() => {
      root.render(
        <JiraSubtaskBoard
          subtasks={[]}
          projectFilter={null}
          sessions={{}}
          onSubtaskClick={() => {}}
        />,
      );
    });
    const columns = Array.from(container.querySelectorAll("[data-column-id]")).map(
      (el) => el.getAttribute("data-column-id"),
    );
    expect(columns).toEqual(["backlog", "in_progress", "review", "done"]);
  });

  it("shows subtask in its status column", () => {
    const subtask = makeSubtask({ id: "s1", status: "in_progress", title: "My feature" });
    act(() => {
      root.render(
        <JiraSubtaskBoard subtasks={[subtask]} projectFilter={null} sessions={{}} onSubtaskClick={() => {}} />,
      );
    });
    expect(container.querySelector("[data-column-id='in_progress']")?.textContent).toContain("My feature");
    expect(container.querySelector("[data-column-id='backlog']")?.textContent).not.toContain("My feature");
  });

  it("filters subtasks by projectFilter", () => {
    const alpha = makeSubtask({ id: "s1", repoPath: "/projects/alpha", title: "Alpha task" });
    const beta = makeSubtask({ id: "s2", repoPath: "/projects/beta", title: "Beta task" });
    act(() => {
      root.render(
        <JiraSubtaskBoard subtasks={[alpha, beta]} projectFilter="/projects/alpha" sessions={{}} onSubtaskClick={() => {}} />,
      );
    });
    expect(container.textContent).toContain("Alpha task");
    expect(container.textContent).not.toContain("Beta task");
  });

  it("shows all subtasks when projectFilter is null", () => {
    const alpha = makeSubtask({ id: "s1", repoPath: "/projects/alpha", title: "Alpha task" });
    const beta = makeSubtask({ id: "s2", repoPath: "/projects/beta", title: "Beta task" });
    act(() => {
      root.render(
        <JiraSubtaskBoard subtasks={[alpha, beta]} projectFilter={null} sessions={{}} onSubtaskClick={() => {}} />,
      );
    });
    expect(container.textContent).toContain("Alpha task");
    expect(container.textContent).toContain("Beta task");
  });

  it("calls onSubtaskClick with the correct subtask on card click", () => {
    const subtask = makeSubtask({ id: "s1", title: "Click me" });
    const onClick = vi.fn();
    act(() => {
      root.render(
        <JiraSubtaskBoard subtasks={[subtask]} projectFilter={null} sessions={{}} onSubtaskClick={onClick} />,
      );
    });
    const card = container.querySelector("[data-subtask-id='s1']") as HTMLElement;
    act(() => { card.click(); });
    expect(onClick).toHaveBeenCalledWith(subtask);
  });

  it("hides repo name when projectFilter is set", () => {
    const subtask = makeSubtask({ id: "s1", repoPath: "/projects/alpha" });
    act(() => {
      root.render(
        <JiraSubtaskBoard subtasks={[subtask]} projectFilter="/projects/alpha" sessions={{}} onSubtaskClick={() => {}} />,
      );
    });
    expect(container.querySelector("[data-subtask-id='s1']")?.querySelector("[data-repo-name]")).toBeNull();
  });

  it("shows repo name when projectFilter is null", () => {
    const subtask = makeSubtask({ id: "s1", repoPath: "/projects/alpha" });
    act(() => {
      root.render(
        <JiraSubtaskBoard subtasks={[subtask]} projectFilter={null} sessions={{}} onSubtaskClick={() => {}} />,
      );
    });
    const repoNameEl = container.querySelector("[data-subtask-id='s1']")?.querySelector("[data-repo-name]");
    expect(repoNameEl).not.toBeNull();
    expect(repoNameEl?.textContent).toBe("alpha");
  });
});
