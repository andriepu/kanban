import * as RadixDialog from "@radix-ui/react-dialog";
import { FolderOpen, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { pickDirectoryOnHost, setJiraApiToken as saveJiraApiTokenRequest } from "@/runtime/runtime-config-query";
import type { RuntimeConfigResponse } from "@/runtime/types";

interface StartupOnboardingDialogProps {
	open: boolean;
	config: RuntimeConfigResponse | null;
	isSaving: boolean;
	onSave: (patch: {
		reposRoot: string | null;
		worktreesRoot: string | null;
		jiraBaseUrl: string | null;
		jiraEmail: string | null;
	}) => Promise<void>;
	onRefreshConfig: () => void;
}

export function StartupOnboardingDialog({
	open,
	config,
	isSaving,
	onSave,
	onRefreshConfig,
}: StartupOnboardingDialogProps): React.ReactElement {
	const [worktreesRoot, setWorktreesRoot] = useState(config?.worktreesRoot ?? "");
	const [reposRoot, setReposRoot] = useState(config?.reposRoot ?? "");
	const [jiraBaseUrl, setJiraBaseUrl] = useState(config?.jiraBaseUrl ?? "");
	const [jiraEmail, setJiraEmail] = useState(config?.jiraEmail ?? "");
	const [jiraApiToken, setJiraApiToken] = useState("");

	useEffect(() => {
		setWorktreesRoot(config?.worktreesRoot ?? "");
		setReposRoot(config?.reposRoot ?? "");
		setJiraBaseUrl(config?.jiraBaseUrl ?? "");
		setJiraEmail(config?.jiraEmail ?? "");
	}, [config?.worktreesRoot, config?.reposRoot, config?.jiraBaseUrl, config?.jiraEmail]);

	const controlsDisabled = config === null || isSaving;

	const canSave =
		worktreesRoot.trim().length > 0 &&
		reposRoot.trim().length > 0 &&
		jiraBaseUrl.trim().length > 0 &&
		jiraEmail.trim().length > 0 &&
		(config?.jiraApiTokenConfigured === true || jiraApiToken.trim().length > 0);

	const handlePickWorktreesRoot = useCallback(() => {
		void pickDirectoryOnHost(null).then((result) => {
			if (result) setWorktreesRoot(result);
		});
	}, []);

	const handlePickReposRoot = useCallback(() => {
		void pickDirectoryOnHost(null).then((result) => {
			if (result) setReposRoot(result);
		});
	}, []);

	const handleSave = useCallback(() => {
		void (async () => {
			if (jiraApiToken.trim()) {
				try {
					await saveJiraApiTokenRequest(null, jiraApiToken.trim());
					onRefreshConfig();
				} catch {
					toast.error("Failed to save Jira API token");
					return;
				}
			}
			await onSave({
				worktreesRoot: worktreesRoot.trim() || null,
				reposRoot: reposRoot.trim() || null,
				jiraBaseUrl: jiraBaseUrl.trim() || null,
				jiraEmail: jiraEmail.trim() || null,
			});
		})();
	}, [onSave, onRefreshConfig, jiraApiToken, worktreesRoot, reposRoot, jiraBaseUrl, jiraEmail]);

	return (
		<Dialog
			open={open}
			onOpenChange={() => {}}
			contentClassName="!max-w-[640px]"
			onEscapeKeyDown={(e) => e.preventDefault()}
		>
			<div className="flex items-center gap-2 px-2 py-2 bg-surface-2 border-b border-[#5A6572] shrink-0 rounded-t-lg">
				<RadixDialog.Title className="flex items-center gap-2 text-sm font-semibold text-text-primary">
					<span className="text-text-secondary">
						<Sparkles size={16} />
					</span>
					Welcome to Kanban
				</RadixDialog.Title>
			</div>

			<div className="px-5 py-5 overflow-y-auto flex-1 min-h-0 bg-surface-1">
				<p className="text-sm text-text-secondary mb-5 m-0">
					Finish configuring Kanban to start using it. All fields below are required.
				</p>

				{/* Repos & Worktrees */}
				<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
					<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-4">
						Repos &amp; Worktrees
					</h6>

					<div className="flex flex-col gap-1.5 mb-4">
						<label htmlFor="onboarding-worktrees-root" className="text-xs font-medium text-text-secondary">
							Worktrees Root
						</label>
						<p className="text-xs text-text-tertiary m-0">
							Directory where git worktrees are created for subtasks.
						</p>
						<div className="flex gap-2">
							<input
								id="onboarding-worktrees-root"
								type="text"
								value={worktreesRoot}
								onChange={(e) => setWorktreesRoot(e.target.value)}
								placeholder="e.g. ~/Workspace/poliigon/work"
								disabled={controlsDisabled}
								className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
							/>
							<Button
								variant="ghost"
								size="sm"
								icon={<FolderOpen size={14} />}
								disabled={controlsDisabled}
								onClick={handlePickWorktreesRoot}
							/>
						</div>
					</div>

					<div className="flex flex-col gap-1.5">
						<label htmlFor="onboarding-repos-root" className="text-xs font-medium text-text-secondary">
							Repos Root
						</label>
						<p className="text-xs text-text-tertiary m-0">Parent directory scanned 1 level deep for git repos.</p>
						<div className="flex gap-2">
							<input
								id="onboarding-repos-root"
								type="text"
								value={reposRoot}
								onChange={(e) => setReposRoot(e.target.value)}
								placeholder="e.g. ~/Workspace/poliigon"
								disabled={controlsDisabled}
								className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
							/>
							<Button
								variant="ghost"
								size="sm"
								icon={<FolderOpen size={14} />}
								disabled={controlsDisabled}
								onClick={handlePickReposRoot}
							/>
						</div>
					</div>
				</div>

				{/* Jira Credentials */}
				<div className="rounded-lg border border-border bg-surface-0 px-4 py-3">
					<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-4">
						Jira Credentials
					</h6>

					<div className="flex flex-col gap-1.5 mb-4">
						<label htmlFor="onboarding-jira-base-url" className="text-xs font-medium text-text-secondary">
							Jira Base URL
						</label>
						<p className="text-xs text-text-tertiary m-0">
							Your Atlassian domain (e.g. your-company.atlassian.net).
						</p>
						<input
							id="onboarding-jira-base-url"
							type="text"
							value={jiraBaseUrl}
							onChange={(e) => setJiraBaseUrl(e.target.value)}
							placeholder="your-company.atlassian.net"
							disabled={controlsDisabled}
							className="w-72 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
						/>
					</div>

					<div className="flex flex-col gap-1.5 mb-4">
						<label htmlFor="onboarding-jira-email" className="text-xs font-medium text-text-secondary">
							Jira Email
						</label>
						<input
							id="onboarding-jira-email"
							type="email"
							value={jiraEmail}
							onChange={(e) => setJiraEmail(e.target.value)}
							placeholder="you@company.com"
							disabled={controlsDisabled}
							className="w-72 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<label htmlFor="onboarding-jira-api-token" className="text-xs font-medium text-text-secondary">
							Jira API Token
						</label>
						<p className="text-xs text-text-tertiary m-0">
							{config?.jiraApiTokenConfigured ? (
								<span className="text-status-green">Token configured ✓</span>
							) : (
								"No token configured."
							)}{" "}
							<a
								href="https://id.atlassian.com/manage-profile/security/api-tokens"
								target="_blank"
								rel="noreferrer"
								className="text-accent hover:text-accent-hover underline"
							>
								Generate token
							</a>
						</p>
						<input
							id="onboarding-jira-api-token"
							type="password"
							value={jiraApiToken}
							onChange={(e) => setJiraApiToken(e.target.value)}
							placeholder="Paste token here"
							disabled={controlsDisabled}
							className="w-72 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
						/>
					</div>
				</div>
			</div>

			<DialogFooter>
				<Button variant="primary" disabled={!canSave || isSaving} onClick={handleSave}>
					Save &amp; continue
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
