import { describe, expect, it } from "vitest";

import { inferHookSourceFromPayload } from "../../src/commands/hooks";

describe("inferHookSourceFromPayload", () => {
	it("infers claude from unix transcript path", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "/Users/dev/.claude/projects/task/transcript.jsonl",
			}),
		).toBe("claude");
	});

	it("infers claude from windows transcript path", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "C:\\Users\\dev\\.claude\\projects\\task\\transcript.jsonl",
			}),
		).toBe("claude");
	});

	it("returns null when path does not contain .claude", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "/Users/dev/.factory/logs/session.jsonl",
			}),
		).toBeNull();
	});

	it("returns null when no source can be inferred", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "C:\\Users\\dev\\logs\\session.jsonl",
			}),
		).toBeNull();
	});

	it("returns null for null payload", () => {
		expect(inferHookSourceFromPayload(null)).toBeNull();
	});
});
