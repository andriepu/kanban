import { describe, expect, it } from "vitest";
import { normalizePrCommentBody } from "./normalize-pr-comment-body";

const BUGBOT_BODY = `
<!-- DESCRIPTION START -->
Two new console.log() calls were added to geminiService.js for instrumentation logging. The team convention requires that production service files not use console.log — structured logging via Sentry or similar is preferred. This was previously enforced on this exact file (PR #892 removed per-batch console.log).
<!-- DESCRIPTION END --> <!-- BUGBOT_BUG_ID: 1e28dd1b-d6f2-404a-8bb1-1e99d82a41ee --> <!-- LOCATIONS START src/services/v1/translations/geminiService.js#L213-L216 src/services/v1/translations/geminiService.js#L246-L249 LOCATIONS END --> <details> <summary>Additional Locations (1)</summary>
src/services/v1/translations/geminiService.js#L246-L249
</details> <div><a href="https://cursor.com/open?data=eyJhbGciOiJSUzI1NiIsInR5cCI6Ikg"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/fix-in-cursor-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/fix-in-cursor-light.png"><img alt="Fix in Cursor" width="115" height="28" src="https://cursor.com/assets/images/fix-in-cursor-dark.png"></picture></a></div>
<sup>Triggered by learned rule: <a href="https://cursor.com/dashboard/bugbot/rules/learned/207a947d-89cf-4952-a79b-f554048cd0a5">No console.log or console.error in service files</a></sup>

<sup>Reviewed by Cursor Bugbot for commit abc123. Configure here</sup>
`.trim();

describe("normalizePrCommentBody", () => {
	it("strips all bot cruft from a Bugbot comment, preserving prose", () => {
		const result = normalizePrCommentBody(BUGBOT_BODY);

		expect(result).toContain("Two new console.log() calls were added");
		expect(result).toContain("structured logging via Sentry or similar");
		expect(result).toContain("PR #892");

		expect(result).not.toContain("<!--");
		expect(result).not.toContain("-->");
		expect(result).not.toContain("BUGBOT_BUG_ID");
		expect(result).not.toContain("DESCRIPTION START");
		expect(result).not.toContain("LOCATIONS START");
		expect(result).not.toContain("<details>");
		expect(result).not.toContain("Additional Locations");
		expect(result).not.toContain("cursor.com");
		expect(result).not.toContain("<picture>");
		expect(result).not.toContain("<source");
		expect(result).not.toContain("<img");
		expect(result).not.toContain("<sup>");
		expect(result).not.toContain("Triggered by learned rule");
		expect(result).not.toContain("Reviewed by Cursor Bugbot");
	});

	it("passes through plain human markdown unchanged", () => {
		const plain = "Looks good — please rebase.";
		expect(normalizePrCommentBody(plain)).toBe(plain);
	});

	it("preserves code fences and lists", () => {
		const md = [
			"Consider changing this:",
			"```js",
			"console.log(data);",
			"```",
			"- Use structured logging",
			"- See CONTRIBUTING.md",
		].join("\n");
		expect(normalizePrCommentBody(md)).toBe(md);
	});

	it("is idempotent", () => {
		const once = normalizePrCommentBody(BUGBOT_BODY);
		const twice = normalizePrCommentBody(once);
		expect(once).toBe(twice);
	});

	it("returns empty string for empty or whitespace-only input", () => {
		expect(normalizePrCommentBody("")).toBe("");
		expect(normalizePrCommentBody("   \n\n  ")).toBe("");
	});

	it("removes HTML comments regardless of content", () => {
		const input = "Before <!-- arbitrary comment with\nmultiple lines --> after";
		expect(normalizePrCommentBody(input)).toBe("Before  after");
	});

	it("collapses excessive blank lines", () => {
		const input = "First\n\n\n\n\nSecond";
		expect(normalizePrCommentBody(input)).toBe("First\n\nSecond");
	});

	it("does not strip <div> blocks without cursor.com content", () => {
		const input = "<div>Some custom bot message without cursor links</div>";
		expect(normalizePrCommentBody(input)).toBe(input);
	});
});
