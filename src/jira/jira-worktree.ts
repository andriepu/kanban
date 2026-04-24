import { execFile as execFileCb } from "node:child_process";
import { access, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export interface RepoInfo {
	id: string; // directory name
	path: string; // absolute path
}

/**
 * Derive a kebab branch name: "{jiraKey}-{slug}" — max 63 chars total.
 * The slug is lowercased, non-alphanumeric chars replaced with `-`,
 * and leading/trailing hyphens stripped.
 */
export function deriveSubtaskBranchName(jiraKey: string, title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const full = `${jiraKey}-${slug}`;
	return full.slice(0, 63);
}

/**
 * Build the worktree path: "{worktreesRoot}/{jiraKey}/{repoId}__{branchName}"
 */
export function buildSubtaskWorktreePath(
	worktreesRoot: string,
	jiraKey: string,
	repoId: string,
	branchName: string,
): string {
	return join(worktreesRoot, jiraKey, `${repoId}__${branchName}`);
}

/**
 * Scan `reposRoot` one level deep for directories that contain a `.git` subdirectory.
 * Returns repos sorted by id ascending.
 * Returns `[]` if `reposRoot` doesn't exist rather than throwing.
 */
export async function scanReposInRoot(
	reposRoot: string,
	options?: {
		readdir?: typeof readdir;
		access?: typeof access;
	},
): Promise<RepoInfo[]> {
	const readdirFn = options?.readdir ?? readdir;
	const accessFn = options?.access ?? access;

	let entries: Array<{ name: string; isDirectory: () => boolean }>;
	try {
		entries = (await readdirFn(reposRoot, { withFileTypes: true })) as Array<{
			name: string;
			isDirectory: () => boolean;
		}>;
	} catch (err) {
		const nodeErr = err as NodeJS.ErrnoException;
		if (nodeErr.code === "ENOENT") {
			return [];
		}
		throw err;
	}

	const dirs = entries.filter((e) => e.isDirectory());

	const results: RepoInfo[] = [];
	await Promise.all(
		dirs.map(async (dir) => {
			const dirPath = join(reposRoot, dir.name);
			const gitPath = join(dirPath, ".git");
			try {
				await accessFn(gitPath);
				results.push({ id: dir.name, path: dirPath });
			} catch {
				// not a git repo, skip
			}
		}),
	);

	results.sort((a, b) => a.id.localeCompare(b.id));
	return results;
}

/**
 * Create a git worktree for a Jira subtask.
 * - Fetches from origin (non-fatal if it fails)
 * - Creates the worktree on a new branch from baseRef
 * - Symlinks .env from the repo root if it exists
 */
export async function createSubtaskWorktree(options: {
	repoPath: string;
	worktreePath: string;
	branchName: string;
	baseRef: string;
}): Promise<void> {
	const { repoPath, worktreePath, branchName, baseRef } = options;

	// Fetch from origin — failure is non-fatal
	try {
		await execFile("git", ["-C", repoPath, "fetch", "origin"]);
	} catch {
		// Ignore: no remote, offline, etc.
	}

	// Create the worktree on a new branch
	await execFile("git", ["-C", repoPath, "worktree", "add", worktreePath, "-b", branchName, baseRef]);

	// Symlink .env if it exists in the repo root
	const repoEnvPath = join(repoPath, ".env");
	try {
		await access(repoEnvPath);
		await symlink(repoEnvPath, join(worktreePath, ".env"));
	} catch {
		// .env doesn't exist or symlink failed — ignore
	}
}

/**
 * Remove a git worktree for a Jira subtask.
 * Uses --force and swallows all errors (worktree may already be gone).
 */
export async function removeSubtaskWorktree(options: { repoPath: string; worktreePath: string }): Promise<void> {
	const { repoPath, worktreePath } = options;
	try {
		await execFile("git", ["-C", repoPath, "worktree", "remove", "--force", worktreePath]);
	} catch {
		// Worktree may already be removed or repo gone — ignore all errors
	}
}
