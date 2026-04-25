export interface JiraRestCredentials {
	baseUrl: string;
	email: string;
	apiToken: string;
}

export interface JiraIssueRaw {
	key: string;
	summary: string;
	status: string;
}

export class JiraRestAuthError extends Error {
	constructor(readonly statusCode: number) {
		super(`Jira REST auth failed (HTTP ${statusCode}). Check email and API token.`);
		this.name = "JiraRestAuthError";
	}
}

function buildBasicAuth(creds: JiraRestCredentials): string {
	return `Basic ${Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64")}`;
}

function normalizeBaseUrl(raw: string): string {
	return raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export async function searchJiraIssuesViaRest(
	jql: string,
	creds: JiraRestCredentials,
	fetchFn: typeof fetch = fetch,
): Promise<JiraIssueRaw[]> {
	const baseUrl = normalizeBaseUrl(creds.baseUrl);

	const response = await fetchFn(`https://${baseUrl}/rest/api/3/search/jql`, {
		method: "POST",
		headers: {
			Authorization: buildBasicAuth(creds),
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({
			jql,
			fields: ["summary", "status"],
			maxResults: 100,
		}),
	});

	if (response.status === 401 || response.status === 403) {
		throw new JiraRestAuthError(response.status);
	}

	if (!response.ok) {
		throw new Error(`Jira REST request failed (HTTP ${response.status})`);
	}

	const data = (await response.json()) as {
		issues?: Array<{
			key?: string;
			fields?: {
				summary?: string;
				status?: { name?: string };
			};
		}>;
	};

	const issues: JiraIssueRaw[] = [];
	for (const issue of data.issues ?? []) {
		const key = issue.key;
		const summary = issue.fields?.summary;
		const status = issue.fields?.status?.name;
		if (key && summary && status) {
			issues.push({ key, summary, status });
		}
	}
	return issues;
}

export async function fetchJiraIssueViaRest(
	issueKey: string,
	creds: JiraRestCredentials,
	fetchFn: typeof fetch = fetch,
): Promise<{ key: string; summary: string; description: string | null }> {
	const baseUrl = normalizeBaseUrl(creds.baseUrl);

	const response = await fetchFn(`https://${baseUrl}/rest/api/3/issue/${issueKey}?fields=summary,description`, {
		headers: {
			Authorization: buildBasicAuth(creds),
			Accept: "application/json",
		},
	});

	if (response.status === 401 || response.status === 403) {
		throw new JiraRestAuthError(response.status);
	}

	if (!response.ok) {
		throw new Error(`Jira REST request failed (HTTP ${response.status})`);
	}

	const data = (await response.json()) as {
		key?: string;
		fields?: {
			summary?: string;
			description?: unknown;
		};
	};

	const descriptionNode = data.fields?.description;
	const description =
		descriptionNode && typeof descriptionNode === "object" && "content" in descriptionNode
			? extractMarkdownFromAdf(descriptionNode as AdfNode).trim()
			: typeof descriptionNode === "string"
				? descriptionNode
				: null;

	return {
		key: data.key ?? issueKey,
		summary: data.fields?.summary ?? "",
		description,
	};
}

interface AdfMark {
	type?: string;
	attrs?: Record<string, string>;
}

interface AdfNode {
	type?: string;
	text?: string;
	attrs?: Record<string, string | number>;
	marks?: AdfMark[];
	content?: AdfNode[];
}

function extractMarkdownFromAdf(node: AdfNode, listIndex?: number): string {
	const type = node.type ?? "";

	if (type === "text") {
		const text = node.text ?? "";
		if (!text) return "";
		const marks = node.marks ?? [];
		let out = text;
		for (const mark of marks) {
			switch (mark.type) {
				case "strong":
					out = `**${out}**`;
					break;
				case "em":
					out = `*${out}*`;
					break;
				case "strike":
					out = `~~${out}~~`;
					break;
				case "code":
					out = `\`${out}\``;
					break;
				case "link": {
					const href = mark.attrs?.href ?? "";
					out = href ? `[${out}](${href})` : out;
					break;
				}
			}
		}
		return out;
	}

	if (type === "hardBreak") return "  \n";

	if (type === "inlineCard" || type === "mention") {
		const url = String(node.attrs?.url ?? "");
		return url ? `[${url}](${url})` : "";
	}

	if (type === "rule") return "\n---\n\n";

	const children = node.content ?? [];

	if (type === "paragraph") {
		const inline = children.map((c) => extractMarkdownFromAdf(c)).join("");
		return `${inline}\n\n`;
	}

	if (type === "heading") {
		const level = Number(node.attrs?.level ?? 1);
		const hashes = "#".repeat(Math.min(level, 6));
		const inline = children.map((c) => extractMarkdownFromAdf(c)).join("");
		return `${hashes} ${inline}\n\n`;
	}

	if (type === "bulletList") {
		return `${children.map((c) => extractMarkdownFromAdf(c, 0)).join("")}\n`;
	}

	if (type === "orderedList") {
		return `${children.map((c, i) => extractMarkdownFromAdf(c, i + 1)).join("")}\n`;
	}

	if (type === "listItem") {
		const prefix = listIndex === 0 ? "- " : `${listIndex ?? 1}. `;
		const inner = children
			.map((c) => extractMarkdownFromAdf(c))
			.join("")
			.trimEnd();
		return `${prefix}${inner}\n`;
	}

	if (type === "blockquote") {
		const inner = children.map((c) => extractMarkdownFromAdf(c)).join("");
		return `${inner
			.split("\n")
			.map((l) => `> ${l}`)
			.join("\n")}\n`;
	}

	if (type === "codeBlock") {
		const lang = String(node.attrs?.language ?? "");
		const inner = children.map((c) => extractMarkdownFromAdf(c)).join("");
		return `\`\`\`${lang}\n${inner}\n\`\`\`\n\n`;
	}

	return children.map((c) => extractMarkdownFromAdf(c)).join("");
}

export async function transitionJiraIssueViaRest(
	issueKey: string,
	targetName: string,
	creds: JiraRestCredentials,
	fetchFn: typeof fetch = fetch,
): Promise<void> {
	const baseUrl = normalizeBaseUrl(creds.baseUrl);
	const auth = buildBasicAuth(creds);

	const transitionsRes = await fetchFn(`https://${baseUrl}/rest/api/3/issue/${issueKey}/transitions`, {
		headers: { Authorization: auth, Accept: "application/json" },
	});
	if (!transitionsRes.ok) return;

	const transitionsData = (await transitionsRes.json()) as {
		transitions?: Array<{ id: string; name: string }>;
	};
	const match = transitionsData.transitions?.find((t) => t.name.toLowerCase() === targetName.toLowerCase());
	if (!match) return;

	await fetchFn(`https://${baseUrl}/rest/api/3/issue/${issueKey}/transitions`, {
		method: "POST",
		headers: { Authorization: auth, "Content-Type": "application/json" },
		body: JSON.stringify({ transition: { id: match.id } }),
	});
}
