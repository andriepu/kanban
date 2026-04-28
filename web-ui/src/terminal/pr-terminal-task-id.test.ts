import { describe, expect, it } from "vitest";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import {
	getPrTerminalTaskId,
	getStackedPrTerminalTaskIdMatcher,
	PR_TERMINAL_TASK_PREFIX,
	parseStackedPrTerminalCounter,
	selectActivePrTerminalSummary,
} from "@/terminal/pr-terminal-task-id";

function makeSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "running",
		agentId: null,
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: 1000,
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...overrides,
	};
}

describe("getPrTerminalTaskId", () => {
	it("returns prefixed id", () => {
		expect(getPrTerminalTaskId("abc-123")).toBe("__pr_terminal__:abc-123");
	});

	it("uses the exported prefix constant", () => {
		const prId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
		expect(getPrTerminalTaskId(prId)).toBe(`${PR_TERMINAL_TASK_PREFIX}${prId}`);
	});
});

describe("getStackedPrTerminalTaskIdMatcher", () => {
	const prId = "abc-123";
	const matcher = getStackedPrTerminalTaskIdMatcher(prId);

	it("matches stacked terminal task ids", () => {
		expect(matcher("__pr_terminal__:abc-123:stacked:1")).toBe(true);
		expect(matcher("__pr_terminal__:abc-123:stacked:10")).toBe(true);
	});

	it("does not match primary terminal task id", () => {
		expect(matcher("__pr_terminal__:abc-123")).toBe(false);
	});

	it("does not match other PR ids", () => {
		expect(matcher("__pr_terminal__:other-id:stacked:1")).toBe(false);
	});

	it("does not match unrelated task ids", () => {
		expect(matcher("__detail_terminal__:abc-123")).toBe(false);
	});
});

describe("parseStackedPrTerminalCounter", () => {
	it("returns counter for valid stacked id", () => {
		expect(parseStackedPrTerminalCounter("__pr_terminal__:abc-123:stacked:1", "abc-123")).toBe(1);
		expect(parseStackedPrTerminalCounter("__pr_terminal__:abc-123:stacked:10", "abc-123")).toBe(10);
	});

	it("returns null for primary terminal id", () => {
		expect(parseStackedPrTerminalCounter("__pr_terminal__:abc-123", "abc-123")).toBeNull();
	});

	it("returns null for other PR id", () => {
		expect(parseStackedPrTerminalCounter("__pr_terminal__:other:stacked:1", "abc-123")).toBeNull();
	});

	it("returns null for unrelated task id", () => {
		expect(parseStackedPrTerminalCounter("__detail_terminal__:abc-123", "abc-123")).toBeNull();
	});

	it("returns null for non-integer suffix", () => {
		expect(parseStackedPrTerminalCounter("__pr_terminal__:abc-123:stacked:foo", "abc-123")).toBeNull();
	});
});

describe("selectActivePrTerminalSummary", () => {
	it("returns null when no sessions match", () => {
		expect(selectActivePrTerminalSummary({}, "abc")).toBeNull();
	});

	it("returns primary terminal summary when present", () => {
		const summary = makeSummary({ taskId: "__pr_terminal__:abc", state: "running" });
		const result = selectActivePrTerminalSummary({ "__pr_terminal__:abc": summary }, "abc");
		expect(result).toBe(summary);
	});

	it("returns stacked terminal summary when primary absent", () => {
		const stacked = makeSummary({ taskId: "__pr_terminal__:abc:stacked:1", state: "running" });
		const result = selectActivePrTerminalSummary({ "__pr_terminal__:abc:stacked:1": stacked }, "abc");
		expect(result).toBe(stacked);
	});

	it("priority: failed wins over running", () => {
		const running = makeSummary({ taskId: "__pr_terminal__:abc", state: "running", updatedAt: 2000 });
		const failed = makeSummary({ taskId: "__pr_terminal__:abc:stacked:1", state: "failed", updatedAt: 1000 });
		const result = selectActivePrTerminalSummary(
			{ "__pr_terminal__:abc": running, "__pr_terminal__:abc:stacked:1": failed },
			"abc",
		);
		expect(result?.state).toBe("failed");
	});

	it("priority: awaiting_review wins over running", () => {
		const running = makeSummary({ taskId: "__pr_terminal__:abc", state: "running", updatedAt: 2000 });
		const awaiting = makeSummary({
			taskId: "__pr_terminal__:abc:stacked:1",
			state: "awaiting_review",
			updatedAt: 1000,
		});
		const result = selectActivePrTerminalSummary(
			{ "__pr_terminal__:abc": running, "__pr_terminal__:abc:stacked:1": awaiting },
			"abc",
		);
		expect(result?.state).toBe("awaiting_review");
	});

	it("tiebreaker: higher updatedAt wins among same priority", () => {
		const older = makeSummary({ taskId: "__pr_terminal__:abc", state: "running", updatedAt: 1000 });
		const newer = makeSummary({ taskId: "__pr_terminal__:abc:stacked:1", state: "running", updatedAt: 2000 });
		const result = selectActivePrTerminalSummary(
			{ "__pr_terminal__:abc": older, "__pr_terminal__:abc:stacked:1": newer },
			"abc",
		);
		expect(result?.updatedAt).toBe(2000);
	});

	it("ignores sessions for other PRs", () => {
		const otherSummary = makeSummary({ taskId: "__pr_terminal__:other", state: "running" });
		const result = selectActivePrTerminalSummary({ "__pr_terminal__:other": otherSummary }, "abc");
		expect(result).toBeNull();
	});
});
