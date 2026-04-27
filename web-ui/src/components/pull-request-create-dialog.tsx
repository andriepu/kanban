import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RepoOption } from "@/types/jira";
import { derivePullRequestBranchName } from "@/utils/jira-utils";

interface PullRequestCreateDialogProps {
	jiraKey: string;
	open: boolean;
	onClose: () => void;
	onCreated: () => void;
}

export function PullRequestCreateDialog({
	jiraKey,
	open,
	onClose,
	onCreated,
}: PullRequestCreateDialogProps): React.ReactElement {
	const trpc = getRuntimeTrpcClient(null);

	const [repos, setRepos] = useState<RepoOption[]>([]);
	const [repoId, setRepoId] = useState("");
	const [repoPath, setRepoPath] = useState("");
	const [title, setTitle] = useState("");
	const [branchName, setBranchName] = useState("");
	const [baseRef, setBaseRef] = useState("main");
	const [prompt, setPrompt] = useState("");
	const [branchEdited, setBranchEdited] = useState(false);
	const [isPending, setIsPending] = useState(false);

	useEffect(() => {
		if (!open) return;
		trpc.jira.scanRepos.query().then((data) => {
			setRepos(data.repos);
		});
	}, [open, trpc]);

	useEffect(() => {
		if (!branchEdited && jiraKey && title) {
			setBranchName(derivePullRequestBranchName(jiraKey, title));
		}
	}, [jiraKey, title, branchEdited]);

	const handleRepoChange = useCallback(
		(id: string) => {
			setRepoId(id);
			const repo = repos.find((r) => r.id === id);
			setRepoPath(repo?.path ?? "");
		},
		[repos],
	);

	const handleClose = useCallback(() => {
		setRepoId("");
		setRepoPath("");
		setTitle("");
		setBranchName("");
		setBaseRef("main");
		setPrompt("");
		setBranchEdited(false);
		onClose();
	}, [onClose]);

	const handleSubmit = useCallback(async () => {
		if (!repoId || !repoPath || !branchName || !prompt) return;
		setIsPending(true);
		try {
			await trpc.jira.createPullRequest.mutate({
				jiraKey,
				repoId,
				repoPath,
				prompt,
				title: title || branchName,
				baseRef,
				branchName,
			});
			onCreated();
			handleClose();
		} finally {
			setIsPending(false);
		}
	}, [trpc, jiraKey, repoId, repoPath, prompt, title, baseRef, branchName, onCreated, handleClose]);

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!o) handleClose();
			}}
		>
			<DialogHeader title={`Add Pull Request — ${jiraKey}`} />
			<DialogBody className="flex flex-col gap-4 p-4">
				<div className="flex flex-col gap-1.5">
					<label htmlFor="pull-request-title" className="text-xs font-medium text-text-secondary">
						Title
					</label>
					<input
						id="pull-request-title"
						type="text"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Short description…"
						className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<label htmlFor="pull-request-repo" className="text-xs font-medium text-text-secondary">
						Repository
					</label>
					<select
						id="pull-request-repo"
						value={repoId}
						onChange={(e) => handleRepoChange(e.target.value)}
						className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-text-primary focus:border-border-focus focus:outline-none"
					>
						<option value="">Select a repo…</option>
						{repos.map((r) => (
							<option key={r.id} value={r.id}>
								{r.id}
							</option>
						))}
					</select>
				</div>
				<div className="flex flex-col gap-1.5">
					<label htmlFor="pull-request-branch" className="text-xs font-medium text-text-secondary">
						Branch Name
					</label>
					<input
						id="pull-request-branch"
						type="text"
						value={branchName}
						onChange={(e) => {
							setBranchName(e.target.value);
							setBranchEdited(true);
						}}
						className="rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-sm text-text-primary focus:border-border-focus focus:outline-none"
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<label htmlFor="pull-request-baseref" className="text-xs font-medium text-text-secondary">
						Base Ref
					</label>
					<input
						id="pull-request-baseref"
						type="text"
						value={baseRef}
						onChange={(e) => setBaseRef(e.target.value)}
						className="w-40 rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-sm text-text-primary focus:border-border-focus focus:outline-none"
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<label htmlFor="pull-request-prompt" className="text-xs font-medium text-text-secondary">
						Prompt
					</label>
					<textarea
						id="pull-request-prompt"
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						rows={5}
						placeholder="Describe what the agent should do…"
						className="resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					/>
				</div>
			</DialogBody>
			<DialogFooter>
				<Button variant="ghost" size="sm" onClick={handleClose}>
					Cancel
				</Button>
				<Button
					variant="primary"
					size="sm"
					disabled={!repoId || !branchName || !prompt || isPending}
					onClick={() => void handleSubmit()}
				>
					{isPending ? "Creating…" : "Create Pull Request"}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
