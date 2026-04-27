import { runGit } from "./git-utils";

interface InitializeRepoResult {
	ok: boolean;
	error: string | null;
}

export async function initializeGitRepository(repoPath: string): Promise<InitializeRepoResult> {
	const result = await runGit(repoPath, ["init"]);
	if (!result.ok) {
		return {
			ok: false,
			error: result.error ?? "Failed to initialize git repository.",
		};
	}

	return ensureInitialCommit(repoPath);
}

export async function ensureInitialCommit(repoPath: string): Promise<InitializeRepoResult> {
	const headCheck = await runGit(repoPath, ["rev-parse", "--verify", "HEAD"]);
	if (headCheck.ok) {
		return { ok: true, error: null };
	}

	const addResult = await runGit(repoPath, ["add", "-A"]);
	if (!addResult.ok) {
		return {
			ok: false,
			error: addResult.error ?? "Failed to stage files for initial commit.",
		};
	}

	const commitResult = await runGit(repoPath, ["commit", "--allow-empty", "-m", "Initial commit through Kanban"]);

	if (!commitResult.ok) {
		return {
			ok: false,
			error: commitResult.error ?? "Failed to create initial commit.",
		};
	}

	return { ok: true, error: null };
}
