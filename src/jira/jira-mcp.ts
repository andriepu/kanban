import { spawn } from "node:child_process";

const MAX_STDOUT = 10 * 1024 * 1024; // 10 MB

export type SpawnClaudeResult = {
	stdout: string;
	exitCode: number;
	stderr?: string;
};

export type SpawnClaudeFn = (args: string[]) => Promise<SpawnClaudeResult>;

function defaultSpawnClaude(args: string[]): Promise<SpawnClaudeResult> {
	return new Promise((resolve) => {
		const child = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] });

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk: Buffer) => {
			if (stdout.length < MAX_STDOUT) stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on("close", (code) => {
			resolve({ stdout, exitCode: code ?? 1, stderr });
		});

		child.on("error", (err) => {
			resolve({ stdout: "", exitCode: 1, stderr: String(err) });
		});
	});
}

/**
 * Calls Jira via the MCP Atlassian integration by spawning `claude -p <prompt>`.
 * Dependency-injected spawn function for testability.
 */
export async function callJiraMcp(prompt: string, options?: { spawnClaude?: SpawnClaudeFn }): Promise<unknown> {
	const spawnClaude = options?.spawnClaude ?? defaultSpawnClaude;

	const args = ["-p", prompt, "--output-format", "json", "--max-turns", "5"];
	const result = await spawnClaude(args);

	let parsed: unknown;
	try {
		parsed = JSON.parse(result.stdout) as unknown;
	} catch {
		// parsed stays undefined
	}

	if (result.exitCode !== 0) {
		if (parsed && typeof parsed === "object") {
			const p = parsed as Record<string, unknown>;
			if (p.is_error && Array.isArray(p.errors)) {
				throw new Error(`claude -p failed: ${(p.errors as string[]).join(", ")}`);
			}
		}
		const detail = result.stderr || result.stdout.slice(0, 200);
		throw new Error(`claude -p exited with code ${result.exitCode}: ${detail}`);
	}

	if (parsed === undefined) {
		throw new Error(`Failed to parse claude -p output as JSON: ${result.stdout.slice(0, 200)}`);
	}

	return parsed;
}
