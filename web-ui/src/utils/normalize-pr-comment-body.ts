export function normalizePrCommentBody(body: string): string {
	let result = body;

	// Remove HTML comments (<!-- ... -->): machine-readable fences from Bugbot/CI bots
	result = result.replace(/<!--[\s\S]*?-->/g, "");

	// Remove <details>...</details> blocks (Bugbot "Additional Locations" duplication)
	result = result.replace(/<details>[\s\S]*?<\/details>/gi, "");

	// Remove <div> blocks containing cursor.com links (Fix-in-Cursor / Fix-in-Web buttons)
	result = result.replace(/<div>[\s\S]*?cursor\.com[\s\S]*?<\/div>/gi, "");

	// Remove raw media tags left behind by Cursor button blocks
	result = result.replace(/<\/?(picture|source|img)[^>]*>/gi, "");

	// Remove <sup>...</sup> footer attribution (Bugbot "Triggered by" / "Reviewed by" lines)
	result = result.replace(/<sup>[\s\S]*?<\/sup>/gi, "");

	// Collapse 3+ consecutive newlines to 2
	result = result.replace(/\n{3,}/g, "\n\n");

	return result.trim();
}
