import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GhPullRequest {
	number: number;
	title: string;
	url: string;
	headRefName: string;
	repository: { nameWithOwner: string };
}

// gh search prs doesn't expose headRefName; GraphQL does
export const GH_PR_GRAPHQL_QUERY = `{
  search(query: "is:pr is:open author:@me", type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        number
        title
        url
        headRefName
        repository {
          nameWithOwner
        }
      }
    }
  }
}`;

/**
 * Lists open GitHub pull requests authored by the current user via the `gh` CLI.
 * Throws a clear Error if `gh` is not found or exits non-zero.
 */
export async function listOpenAuthoredGhPullRequests(): Promise<GhPullRequest[]> {
	let stdout: string;

	try {
		const result = await execFileAsync("gh", ["api", "graphql", "-f", `query=${GH_PR_GRAPHQL_QUERY}`], {
			encoding: "utf8",
		});
		stdout = result.stdout;
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { code?: unknown }).code === "ENOENT"
		) {
			throw new Error("gh CLI not found. Install GitHub CLI (gh) to use PR scan.");
		}
		const stderr =
			typeof error === "object" && error !== null && "stderr" in error
				? String((error as { stderr?: unknown }).stderr ?? "")
				: String(error);
		throw new Error(stderr || String(error));
	}

	const trimmed = stdout.trim();
	if (!trimmed) return [];

	let parsed: { data: { search: { nodes: (GhPullRequest | null)[] } } };
	try {
		parsed = JSON.parse(trimmed) as { data: { search: { nodes: (GhPullRequest | null)[] } } };
	} catch {
		throw new Error(`gh returned malformed JSON: ${trimmed.slice(0, 200)}`);
	}

	return (parsed.data?.search?.nodes ?? []).filter((n): n is GhPullRequest => n !== null);
}
