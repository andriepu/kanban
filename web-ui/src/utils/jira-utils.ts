export function derivePullRequestBranchName(jiraKey: string, title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const prefix = `${jiraKey}-`;
	const maxSlugLength = 63 - prefix.length;
	return `${prefix}${slug.slice(0, maxSlugLength)}`;
}
