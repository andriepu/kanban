import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

export type SpawnClaudeResult = {
	stdout: string;
	exitCode: number;
	stderr?: string;
};

export type SpawnClaudeFn = (args: string[]) => Promise<SpawnClaudeResult>;

async function defaultSpawnClaude(args: string[]): Promise<SpawnClaudeResult> {
	try {
		const { stdout, stderr } = await execFile("claude", args, { maxBuffer: MAX_BUFFER });
		return { stdout, exitCode: 0, stderr };
	} catch (err) {
		// execFile rejects on non-zero exit; the error carries stdout/stderr/code
		const execErr = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
		return {
			stdout: execErr.stdout ?? "",
			exitCode: typeof execErr.code === "number" ? execErr.code : 1,
			stderr: execErr.stderr ?? String(err),
		};
	}
}

/**
 * Calls Jira via the MCP Atlassian integration by spawning `claude -p <prompt>`.
 * Dependency-injected spawn function for testability.
 */
export async function callJiraMcp(prompt: string, options?: { spawnClaude?: SpawnClaudeFn }): Promise<unknown> {
	const spawnClaude = options?.spawnClaude ?? defaultSpawnClaude;

	const args = ["-p", prompt, "--output-format", "json", "--max-turns", "1"];
	const result = await spawnClaude(args);

	if (result.exitCode !== 0) {
		throw new Error(`claude -p exited with code ${result.exitCode}: ${result.stderr ?? ""}`);
	}

	try {
		return JSON.parse(result.stdout) as unknown;
	} catch {
		throw new Error(`Failed to parse claude -p output as JSON: ${result.stdout.slice(0, 200)}`);
	}
}
