import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GhPullRequest {
	number: number;
	title: string;
	url: string;
	headRefName: string;
	isDraft: boolean;
	state: "OPEN" | "MERGED" | "CLOSED";
	repository: { nameWithOwner: string };
}

const PR_FIELDS = `
  ... on PullRequest {
    number
    title
    url
    headRefName
    isDraft
    state
    repository {
      nameWithOwner
    }
  }
`;

function buildProjectKeyQuery(projectKey: string): string {
	return `{
  open: search(query: "is:pr is:open author:@me in:title ${projectKey}", type: ISSUE, first: 100) {
    nodes { ${PR_FIELDS} }
  }
  closed: search(query: "is:pr is:closed author:@me in:title ${projectKey}", type: ISSUE, first: 100) {
    nodes { ${PR_FIELDS} }
  }
}`;
}

type GraphqlResponse = {
	data: {
		open: { nodes: (GhPullRequest | null)[] };
		closed: { nodes: (GhPullRequest | null)[] };
	};
};

/**
 * Lists GitHub pull requests (open + recently closed) authored by the current
 * user whose title contains the given Jira project key. Scoped to project key
 * to keep result counts bounded. Returns a deduplicated flat list by PR URL.
 */
export async function listAuthoredGhPullRequestsForProject(projectKey: string): Promise<GhPullRequest[]> {
	if (!/^[A-Z][A-Z0-9_]+$/.test(projectKey)) {
		throw new Error(`Invalid Jira project key: "${projectKey}"`);
	}

	let stdout: string;

	try {
		const result = await execFileAsync("gh", ["api", "graphql", "-f", `query=${buildProjectKeyQuery(projectKey)}`], {
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

	let parsed: GraphqlResponse;
	try {
		parsed = JSON.parse(trimmed) as GraphqlResponse;
	} catch {
		throw new Error(`gh returned malformed JSON: ${trimmed.slice(0, 200)}`);
	}

	const openNodes = (parsed.data?.open?.nodes ?? []).filter((n): n is GhPullRequest => n !== null);
	const closedNodes = (parsed.data?.closed?.nodes ?? []).filter((n): n is GhPullRequest => n !== null);

	// Dedupe by URL — open bucket takes precedence over closed for same URL
	const seen = new Map<string, GhPullRequest>();
	for (const pr of [...openNodes, ...closedNodes]) {
		if (!seen.has(pr.url)) seen.set(pr.url, pr);
	}
	return Array.from(seen.values());
}
