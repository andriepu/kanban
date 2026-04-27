import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { RepoRow } from "@/components/repo-navigation-panel";
import type { RuntimeRepoSummary } from "@/runtime/types";

export function PrRepoList({
	repos,
	currentRepoId,
	removingRepoId,
	onSelect,
	onRemove,
}: {
	repos: RuntimeRepoSummary[];
	currentRepoId: string | null;
	removingRepoId: string | null;
	onSelect: (repoId: string, repoPath: string) => void;
	onRemove: (repoId: string) => void;
}): React.ReactElement {
	const sorted = [...repos].sort((a, b) => a.path.localeCompare(b.path));
	const activeRepos = sorted.filter((r) => r.pullRequestCount > 0);
	const inactiveRepos = sorted.filter((r) => r.pullRequestCount === 0);
	const allInactive = activeRepos.length === 0;
	const [inactiveExpanded, setInactiveExpanded] = useState(allInactive);

	return (
		<div className="flex flex-col gap-1">
			{activeRepos.length > 0 && (
				<>
					<div className="px-2 py-1 text-xs font-medium text-text-tertiary">Active ({activeRepos.length})</div>
					{activeRepos.map((repo) => (
						<RepoRow
							key={repo.id}
							repo={repo}
							isCurrent={currentRepoId === repo.id}
							removingRepoId={removingRepoId}
							onSelect={() => onSelect(repo.id, repo.path)}
							onRemove={onRemove}
						/>
					))}
				</>
			)}
			{inactiveRepos.length > 0 && (
				<>
					<button
						type="button"
						className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-text-tertiary cursor-pointer hover:text-text-secondary"
						onClick={() => setInactiveExpanded((prev) => !prev)}
					>
						{inactiveExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
						Inactive ({inactiveRepos.length})
					</button>
					{inactiveExpanded &&
						inactiveRepos.map((repo) => (
							<RepoRow
								key={repo.id}
								repo={repo}
								isCurrent={currentRepoId === repo.id}
								removingRepoId={removingRepoId}
								onSelect={() => onSelect(repo.id, repo.path)}
								onRemove={onRemove}
							/>
						))}
				</>
			)}
		</div>
	);
}
