import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { lockedFileSystem } from "../fs/locked-file-system.js";
import type { GhPullRequest } from "./jira-pr-scan.js";

export interface JiraPrLink {
	id: string; // randomUUID
	jiraKey: string; // parent Jira card key, e.g. "POL-1234"
	prUrl: string; // GitHub PR URL
	prNumber: number; // PR number
	title: string; // PR title
	repoName: string; // e.g. "org/repo-name"  (repository.nameWithOwner from gh)
	headRefName: string; // branch name on PR
	addedAt: number; // Date.now() when first scanned
}

function getKanbanDataDir(): string {
	return join(homedir(), ".kanban", "kanban");
}

function getPrLinksFilePath(): string {
	return join(getKanbanDataDir(), "jira-pr-links.json");
}

export async function loadJiraPrLinks(): Promise<Record<string, JiraPrLink[]>> {
	try {
		const content = await readFile(getPrLinksFilePath(), "utf8");
		return JSON.parse(content) as Record<string, JiraPrLink[]>;
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { code?: unknown }).code === "ENOENT"
		) {
			return {};
		}
		throw new Error(`Failed to read jira-pr-links.json: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export async function saveJiraPrLinks(links: Record<string, JiraPrLink[]>): Promise<void> {
	await lockedFileSystem.writeJsonFileAtomic(getPrLinksFilePath(), links, {
		lock: { path: getPrLinksFilePath(), type: "file" },
	});
}

export function mergeScannedPrLinks(
	existing: Record<string, JiraPrLink[]>,
	scanned: Array<{ jiraKey: string; pr: GhPullRequest }>,
): Record<string, JiraPrLink[]> {
	// Build the full set of scanned prUrls to use for pruning
	const scannedPrUrls = new Set(scanned.map((entry) => entry.pr.url));

	// Start from a deep copy of existing, pruning links not in current scan
	const result: Record<string, JiraPrLink[]> = {};
	for (const [jiraKey, links] of Object.entries(existing)) {
		const kept = links.filter((link) => scannedPrUrls.has(link.prUrl));
		if (kept.length > 0) {
			result[jiraKey] = kept;
		}
	}

	// Add new links from scan (dedupe by prUrl under same jiraKey)
	for (const { jiraKey, pr } of scanned) {
		const existingLinks = result[jiraKey] ?? [];
		const alreadyExists = existingLinks.some((link) => link.prUrl === pr.url);
		if (!alreadyExists) {
			const newLink: JiraPrLink = {
				id: randomUUID(),
				jiraKey,
				prUrl: pr.url,
				prNumber: pr.number,
				title: pr.title,
				repoName: pr.repository.nameWithOwner,
				headRefName: pr.headRefName,
				addedAt: Date.now(),
			};
			result[jiraKey] = [...existingLinks, newLink];
		}
	}

	return result;
}
