import { execFile as execFileCb } from "node:child_process";
import { access, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export interface RepoInfo {
	id: string; // directory name
	path: string; // absolute path
}

type ReaddirWithFileTypes = (
	path: string,
	options: { withFileTypes: true },
) => Promise<Array<{ name: string; isDirectory(): boolean }>>;

/**
 * Derive a kebab branch name: "{jiraKey}-{slug}" — max 63 chars total.
 * The slug is lowercased, non-alphanumeric chars replaced with `-`,
 * and leading/trailing hyphens stripped.
 */
export function derivePullRequestBranchName(jiraKey: string, title: string): string {
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
export function buildPullRequestWorktreePath(
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
interface ScanReposOptions {
	readdir?: ReaddirWithFileTypes;
	access?: typeof access;
}

export async function scanReposInRoot(reposRoot: string, options?: ScanReposOptions): Promise<RepoInfo[]> {
	const readdirFn: ReaddirWithFileTypes =
		options?.readdir ?? ((p, opts) => readdir(p, opts) as ReturnType<ReaddirWithFileTypes>);
	const accessFn = options?.access ?? access;

	let entries: Array<{ name: string; isDirectory: () => boolean }>;
	try {
		entries = await readdirFn(reposRoot, { withFileTypes: true });
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
 * Create a git worktree for a Jira pull request.
 * - Fetches from origin (non-fatal if it fails)
 * - Creates the worktree on a new branch from baseRef
 * - Symlinks .env from the repo root if it exists
 */
export async function createPullRequestWorktree(options: {
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
	let envExists = false;
	try {
		await access(repoEnvPath);
		envExists = true;
	} catch {
		// .env does not exist — skip symlink
	}

	if (envExists) {
		await symlink(repoEnvPath, join(worktreePath, ".env"));
		// Note: let symlink errors propagate — a failed .env symlink leaves
		// the worktree in an inconsistent state that the caller must handle.
	}
}

/**
 * Remove a git worktree for a Jira pull request.
 * Uses --force and swallows all errors (worktree may already be gone).
 */
export async function removePullRequestWorktree(options: { repoPath: string; worktreePath: string }): Promise<void> {
	const { repoPath, worktreePath } = options;
	try {
		await execFile("git", ["-C", repoPath, "worktree", "remove", "--force", worktreePath]);
	} catch {
		// Worktree may already be removed or repo gone — ignore all errors
	}
}
