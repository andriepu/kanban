import { describe, expect, it } from "vitest";

import { extractJiraKey } from "../../../src/jira/jira-key-extract";

describe("extractJiraKey", () => {
	it("extracts a key from mid-sentence text", () => {
		expect(extractJiraKey("Fix POL-1234 login bug", "POL")).toBe("POL-1234");
	});

	it("extracts a key when the key starts the string", () => {
		expect(extractJiraKey("POL-99 should be fixed", "POL")).toBe("POL-99");
	});

	it("returns null when no key is present", () => {
		expect(extractJiraKey("No issue key here", "POL")).toBeNull();
	});

	it("returns null when the project key does not match", () => {
		expect(extractJiraKey("Fix ABC-123 login bug", "POL")).toBeNull();
	});

	it("returns the first match when multiple keys are present", () => {
		expect(extractJiraKey("POL-1 and POL-2", "POL")).toBe("POL-1");
	});

	it("does not match when the project key is a suffix of a longer prefix (word boundary)", () => {
		expect(extractJiraKey("XPOL-123 some task", "POL")).toBeNull();
	});

	it("is case-sensitive and does not match lowercase keys", () => {
		expect(extractJiraKey("pol-123 some task", "POL")).toBeNull();
	});
});
