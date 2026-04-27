import { describe, expect, it } from "vitest";
import type { Route } from "@/hooks/app-utils";
import { buildDetailTaskUrl, buildPathname, parseDetailTaskIdFromSearch, parseRoute } from "@/hooks/app-utils";

describe("parseDetailTaskIdFromSearch", () => {
	it("returns the selected task id when present", () => {
		expect(parseDetailTaskIdFromSearch("?task=task-123")).toBe("task-123");
	});

	it("returns null when the task id is missing or blank", () => {
		expect(parseDetailTaskIdFromSearch("")).toBeNull();
		expect(parseDetailTaskIdFromSearch("?task=")).toBeNull();
		expect(parseDetailTaskIdFromSearch("?task=%20%20")).toBeNull();
	});
});

describe("parseRoute", () => {
	it("parses /task", () => {
		expect(parseRoute("/task")).toEqual({ kind: "task" });
	});

	it("parses /pr with no repo", () => {
		expect(parseRoute("/pr")).toEqual({ kind: "pr", repoName: null });
	});

	it("parses /pr/<name>", () => {
		expect(parseRoute("/pr/my-repo")).toEqual({ kind: "pr", repoName: "my-repo" });
	});

	it("decodes encoded repo names", () => {
		expect(parseRoute("/pr/my%20repo")).toEqual({ kind: "pr", repoName: "my repo" });
	});

	it("returns null for root", () => {
		expect(parseRoute("/")).toBeNull();
	});

	it("returns null for unknown segments", () => {
		expect(parseRoute("/unknown")).toBeNull();
	});

	it("returns null for /pr with extra segments", () => {
		expect(parseRoute("/pr/foo/bar")).toBeNull();
	});
});

describe("buildPathname", () => {
	it("builds /task route", () => {
		const route: Route = { kind: "task" };
		expect(buildPathname(route)).toBe("/task");
	});

	it("builds /pr route with no repo", () => {
		const route: Route = { kind: "pr", repoName: null };
		expect(buildPathname(route)).toBe("/pr");
	});

	it("builds /pr/<name> route", () => {
		const route: Route = { kind: "pr", repoName: "my-repo" };
		expect(buildPathname(route)).toBe("/pr/my-repo");
	});

	it("encodes repo names with special characters", () => {
		const route: Route = { kind: "pr", repoName: "my repo" };
		expect(buildPathname(route)).toBe("/pr/my%20repo");
	});
});

describe("buildDetailTaskUrl", () => {
	it("adds the task id while preserving other query params and hash", () => {
		expect(
			buildDetailTaskUrl({
				pathname: "/project-1",
				search: "?view=board",
				hash: "#panel",
				taskId: "task-123",
			}),
		).toBe("/project-1?view=board&task=task-123#panel");
	});

	it("removes the task id while preserving other query params", () => {
		expect(
			buildDetailTaskUrl({
				pathname: "/project-1",
				search: "?view=board&task=task-123",
				hash: "",
				taskId: null,
			}),
		).toBe("/project-1?view=board");
	});
});
