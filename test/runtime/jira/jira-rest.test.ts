import { describe, expect, it } from "vitest";
import type { JiraRestCredentials } from "../../../src/jira/jira-rest.js";
import { fetchJiraIssueViaRest, JiraRestAuthError, searchJiraIssuesViaRest } from "../../../src/jira/jira-rest.js";

const CREDS: JiraRestCredentials = {
	baseUrl: "company.atlassian.net",
	email: "user@company.com",
	apiToken: "token123",
};

function makeSearchFetch(body: unknown, status = 200) {
	return async (url: URL | string, init?: RequestInit) => {
		expect(String(url)).toBe("https://company.atlassian.net/rest/api/3/search/jql");
		expect(init?.method).toBe("POST");
		const authHeader = (init?.headers as Record<string, string>)?.Authorization;
		expect(authHeader).toBe(`Basic ${Buffer.from("user@company.com:token123").toString("base64")}`);
		const requestBody = JSON.parse(init?.body as string) as { jql: string; fields: string[]; maxResults: number };
		expect(requestBody.jql).toBe("assignee = currentUser()");
		expect(requestBody.fields).toContain("summary");
		expect(requestBody.fields).toContain("status");
		return new Response(JSON.stringify(body), { status });
	};
}

describe("searchJiraIssuesViaRest", () => {
	it("sends correct URL, method, auth header, and body", async () => {
		const fetchFn = makeSearchFetch({ issues: [] });
		const result = await searchJiraIssuesViaRest("assignee = currentUser()", CREDS, fetchFn as typeof fetch);
		expect(result).toEqual([]);
	});

	it("strips scheme from baseUrl", async () => {
		const creds = { ...CREDS, baseUrl: "https://company.atlassian.net/" };
		const fetchFn = makeSearchFetch({ issues: [] });
		const result = await searchJiraIssuesViaRest("assignee = currentUser()", creds, fetchFn as typeof fetch);
		expect(result).toEqual([]);
	});

	it("parses issues array correctly", async () => {
		const fetchFn = makeSearchFetch({
			issues: [
				{ key: "POL-1", fields: { summary: "Fix bug", status: { name: "In Progress" } } },
				{ key: "POL-2", fields: { summary: "Add feature", status: { name: "To Do" } } },
			],
		});
		const result = await searchJiraIssuesViaRest("assignee = currentUser()", CREDS, fetchFn as typeof fetch);
		expect(result).toEqual([
			{ key: "POL-1", summary: "Fix bug", status: "In Progress" },
			{ key: "POL-2", summary: "Add feature", status: "To Do" },
		]);
	});

	it("skips issues missing key, summary, or status", async () => {
		const fetchFn = makeSearchFetch({
			issues: [
				{ key: "POL-1", fields: { summary: "ok", status: { name: "Done" } } },
				{ key: null, fields: { summary: "no key", status: { name: "Done" } } },
				{ key: "POL-3", fields: { summary: null, status: { name: "Done" } } },
			],
		});
		const result = await searchJiraIssuesViaRest("assignee = currentUser()", CREDS, fetchFn as typeof fetch);
		expect(result).toHaveLength(1);
		expect(result[0]?.key).toBe("POL-1");
	});

	it("throws JiraRestAuthError on 401", async () => {
		const fetchFn = async () => new Response(null, { status: 401 });
		await expect(
			searchJiraIssuesViaRest("assignee = currentUser()", CREDS, fetchFn as typeof fetch),
		).rejects.toBeInstanceOf(JiraRestAuthError);
	});

	it("throws JiraRestAuthError on 403", async () => {
		const fetchFn = async () => new Response(null, { status: 403 });
		await expect(
			searchJiraIssuesViaRest("assignee = currentUser()", CREDS, fetchFn as typeof fetch),
		).rejects.toBeInstanceOf(JiraRestAuthError);
	});

	it("throws generic error on other non-ok status", async () => {
		const fetchFn = async () => new Response(null, { status: 500 });
		await expect(searchJiraIssuesViaRest("assignee = currentUser()", CREDS, fetchFn as typeof fetch)).rejects.toThrow(
			"HTTP 500",
		);
	});
});

describe("fetchJiraIssueViaRest", () => {
	it("returns key, summary, and text description from ADF", async () => {
		const fetchFn = async () =>
			new Response(
				JSON.stringify({
					key: "POL-1",
					fields: {
						summary: "Fix login",
						description: {
							type: "doc",
							content: [{ type: "text", text: "Detailed description" }],
						},
					},
				}),
				{ status: 200 },
			);
		const result = await fetchJiraIssueViaRest("POL-1", CREDS, fetchFn as typeof fetch);
		expect(result.key).toBe("POL-1");
		expect(result.summary).toBe("Fix login");
		expect(result.description).toBe("Detailed description");
	});

	it("renders link marks as markdown links", async () => {
		const fetchFn = async () =>
			new Response(
				JSON.stringify({
					key: "POL-1",
					fields: {
						summary: "Fix login",
						description: {
							type: "doc",
							content: [
								{
									type: "paragraph",
									content: [
										{
											type: "text",
											text: "See docs",
											marks: [{ type: "link", attrs: { href: "https://example.com" } }],
										},
									],
								},
							],
						},
					},
				}),
				{ status: 200 },
			);
		const result = await fetchJiraIssueViaRest("POL-1", CREDS, fetchFn as typeof fetch);
		expect(result.description).toContain("[See docs](https://example.com)");
	});

	it("renders bullet list as markdown list", async () => {
		const fetchFn = async () =>
			new Response(
				JSON.stringify({
					key: "POL-1",
					fields: {
						summary: "Fix login",
						description: {
							type: "doc",
							content: [
								{
									type: "bulletList",
									content: [
										{ type: "listItem", content: [{ type: "text", text: "First" }] },
										{ type: "listItem", content: [{ type: "text", text: "Second" }] },
									],
								},
							],
						},
					},
				}),
				{ status: 200 },
			);
		const result = await fetchJiraIssueViaRest("POL-1", CREDS, fetchFn as typeof fetch);
		expect(result.description).toContain("- First");
		expect(result.description).toContain("- Second");
	});

	it("separates paragraphs with blank lines", async () => {
		const fetchFn = async () =>
			new Response(
				JSON.stringify({
					key: "POL-1",
					fields: {
						summary: "Fix login",
						description: {
							type: "doc",
							content: [
								{ type: "paragraph", content: [{ type: "text", text: "First para" }] },
								{ type: "paragraph", content: [{ type: "text", text: "Second para" }] },
							],
						},
					},
				}),
				{ status: 200 },
			);
		const result = await fetchJiraIssueViaRest("POL-1", CREDS, fetchFn as typeof fetch);
		expect(result.description).toContain("First para\n\nSecond para");
	});

	it("returns null description when field is absent", async () => {
		const fetchFn = async () =>
			new Response(JSON.stringify({ key: "POL-1", fields: { summary: "Fix login" } }), { status: 200 });
		const result = await fetchJiraIssueViaRest("POL-1", CREDS, fetchFn as typeof fetch);
		expect(result.description).toBeNull();
	});

	it("throws JiraRestAuthError on 401", async () => {
		const fetchFn = async () => new Response(null, { status: 401 });
		await expect(fetchJiraIssueViaRest("POL-1", CREDS, fetchFn as typeof fetch)).rejects.toBeInstanceOf(
			JiraRestAuthError,
		);
	});
});
