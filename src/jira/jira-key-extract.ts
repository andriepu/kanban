/**
 * Extracts the first Jira issue key matching the given project key from a text string.
 * Pure function — no IO.
 */
export function extractJiraKey(text: string, projectKey: string): string | null {
	const pattern = new RegExp(`\\b${projectKey}-\\d+\\b`);
	const match = pattern.exec(text);
	return match ? match[0] : null;
}
