import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// We override HOME so lockedFileSystem writes to a temp dir
let tempHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(async () => {
	tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-jira-pr-links-test-"));
	originalHome = process.env.HOME;
	originalUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
});

afterEach(async () => {
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	if (originalUserProfile === undefined) {
		delete process.env.USERPROFILE;
	} else {
		process.env.USERPROFILE = originalUserProfile;
	}
	await fs.rm(tempHome, { recursive: true, force: true });
});

// Path resolution calls homedir() lazily at invocation time, so the HOME override
// set in beforeEach is always in effect when any exported function runs.
import {
	type JiraPrLink,
	loadJiraPrLinks,
	mergeScannedPrLinks,
	saveJiraPrLinks,
} from "../../../src/jira/jira-pr-links";

describe("loadJiraPrLinks", () => {
	it("returns {} when file does not exist", async () => {
		const links = await loadJiraPrLinks();
		expect(links).toEqual({});
	});
});

describe("saveJiraPrLinks + loadJiraPrLinks", () => {
	it("round-trips a map with one key and one link", async () => {
		const link: JiraPrLink = {
			id: "test-uuid-1",
			jiraKey: "POL-1",
			prUrl: "https://github.com/org/repo/pull/42",
			prNumber: 42,
			title: "Fix login bug",
			repoName: "org/repo",
			headRefName: "POL-1-fix-login",
			addedAt: 1234567890,
		};
		const map: Record<string, JiraPrLink[]> = { "POL-1": [link] };

		await saveJiraPrLinks(map);
		const loaded = await loadJiraPrLinks();

		expect(loaded["POL-1"]).toHaveLength(1);
		const loadedLink = loaded["POL-1"]?.[0];
		expect(loadedLink?.id).toBe("test-uuid-1");
		expect(loadedLink?.jiraKey).toBe("POL-1");
		expect(loadedLink?.prUrl).toBe("https://github.com/org/repo/pull/42");
		expect(loadedLink?.prNumber).toBe(42);
		expect(loadedLink?.title).toBe("Fix login bug");
		expect(loadedLink?.repoName).toBe("org/repo");
		expect(loadedLink?.headRefName).toBe("POL-1-fix-login");
		expect(loadedLink?.addedAt).toBe(1234567890);
	});
});

describe("mergeScannedPrLinks", () => {
	it("returns {} for empty existing + empty scan", () => {
		const result = mergeScannedPrLinks({}, []);
		expect(result).toEqual({});
	});

	it("adds one link from empty existing + one scan entry", () => {
		const result = mergeScannedPrLinks({}, [
			{
				jiraKey: "POL-1",
				pr: {
					number: 10,
					title: "My PR",
					url: "https://github.com/org/repo/pull/10",
					headRefName: "POL-1-my-pr",
					repository: { nameWithOwner: "org/repo" },
					isDraft: false,
				},
			},
		]);

		expect(Object.keys(result)).toEqual(["POL-1"]);
		const links = result["POL-1"];
		expect(links).toHaveLength(1);
		const link = links?.[0];
		expect(link?.id).toBeTruthy();
		expect(link?.addedAt).toBeGreaterThan(0);
		expect(link?.prUrl).toBe("https://github.com/org/repo/pull/10");
		expect(link?.prNumber).toBe(10);
		expect(link?.title).toBe("My PR");
		expect(link?.repoName).toBe("org/repo");
		expect(link?.headRefName).toBe("POL-1-my-pr");
		expect(link?.jiraKey).toBe("POL-1");
	});

	it("does not duplicate when same prUrl appears again for same jiraKey", () => {
		const existingLink: JiraPrLink = {
			id: "existing-id",
			jiraKey: "POL-1",
			prUrl: "https://github.com/org/repo/pull/10",
			prNumber: 10,
			title: "My PR",
			repoName: "org/repo",
			headRefName: "POL-1-my-pr",
			addedAt: 9999,
		};
		const existing: Record<string, JiraPrLink[]> = { "POL-1": [existingLink] };

		const result = mergeScannedPrLinks(existing, [
			{
				jiraKey: "POL-1",
				pr: {
					number: 10,
					title: "My PR",
					url: "https://github.com/org/repo/pull/10",
					headRefName: "POL-1-my-pr",
					repository: { nameWithOwner: "org/repo" },
					isDraft: false,
				},
			},
		]);

		expect(result["POL-1"]).toHaveLength(1);
		expect(result["POL-1"]?.[0]?.id).toBe("existing-id");
	});

	it("keeps links for separate jiraKeys", () => {
		const existingLink: JiraPrLink = {
			id: "existing-id",
			jiraKey: "POL-1",
			prUrl: "https://github.com/org/repo/pull/10",
			prNumber: 10,
			title: "My PR",
			repoName: "org/repo",
			headRefName: "POL-1-my-pr",
			addedAt: 9999,
		};
		const existing: Record<string, JiraPrLink[]> = { "POL-1": [existingLink] };

		const result = mergeScannedPrLinks(existing, [
			{
				jiraKey: "POL-1",
				pr: {
					number: 10,
					title: "My PR",
					url: "https://github.com/org/repo/pull/10",
					headRefName: "POL-1-my-pr",
					repository: { nameWithOwner: "org/repo" },
					isDraft: false,
				},
			},
			{
				jiraKey: "POL-2",
				pr: {
					number: 20,
					title: "Second PR",
					url: "https://github.com/org/repo/pull/20",
					headRefName: "POL-2-second-pr",
					repository: { nameWithOwner: "org/repo" },
					isDraft: false,
				},
			},
		]);

		expect(result["POL-1"]).toHaveLength(1);
		expect(result["POL-2"]).toHaveLength(1);
		expect(result["POL-2"]?.[0]?.prNumber).toBe(20);
	});

	it("prunes links whose prUrl is not in the current scan (full prune)", () => {
		const existingLink: JiraPrLink = {
			id: "existing-id",
			jiraKey: "POL-1",
			prUrl: "https://github.com/a/b/pull/1",
			prNumber: 1,
			title: "Old PR",
			repoName: "a/b",
			headRefName: "POL-1-old",
			addedAt: 1000,
		};
		const existing: Record<string, JiraPrLink[]> = { "POL-1": [existingLink] };

		// Scan has no entries → all existing links should be pruned
		const result = mergeScannedPrLinks(existing, []);

		expect(result).toEqual({});
	});

	it("prunes only links not in scan when multiple links exist under same jiraKey", () => {
		const linkA: JiraPrLink = {
			id: "id-a",
			jiraKey: "POL-1",
			prUrl: "https://github.com/org/repo/pull/1",
			prNumber: 1,
			title: "PR A",
			repoName: "org/repo",
			headRefName: "POL-1-a",
			addedAt: 1000,
		};
		const linkB: JiraPrLink = {
			id: "id-b",
			jiraKey: "POL-1",
			prUrl: "https://github.com/org/repo/pull/2",
			prNumber: 2,
			title: "PR B",
			repoName: "org/repo",
			headRefName: "POL-1-b",
			addedAt: 1001,
		};
		const existing: Record<string, JiraPrLink[]> = { "POL-1": [linkA, linkB] };

		// Only scan includes pull/1 — pull/2 should be pruned
		const result = mergeScannedPrLinks(existing, [
			{
				jiraKey: "POL-1",
				pr: {
					number: 1,
					title: "PR A",
					url: "https://github.com/org/repo/pull/1",
					headRefName: "POL-1-a",
					repository: { nameWithOwner: "org/repo" },
					isDraft: false,
				},
			},
		]);

		expect(result["POL-1"]).toHaveLength(1);
		expect(result["POL-1"]?.[0]?.id).toBe("id-a");
	});
});
