import * as RadixPopover from "@radix-ui/react-popover";
import { Check, ChevronDown, Play, Plus } from "lucide-react";
import { useState } from "react";
import {
	getRuntimeShortcutIconComponent,
	getRuntimeShortcutPickerOption,
	RUNTIME_SHORTCUT_ICON_OPTIONS,
	type RuntimeShortcutPickerIconId,
} from "@/components/shared/runtime-shortcut-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/use-is-mobile";
import type { RuntimeRepoShortcut } from "@/runtime/types";

type CreateShortcutResult = { ok: boolean; message?: string };

const MOBILE_TOUCH_TARGET = "min-w-[44px] min-h-[44px]";

function FirstShortcutIconPicker({
	value,
	onSelect,
}: {
	value: RuntimeShortcutPickerIconId;
	onSelect: (icon: RuntimeShortcutPickerIconId) => void;
}): React.ReactElement {
	const [open, setOpen] = useState(false);
	const selectedOption = getRuntimeShortcutPickerOption(value);
	const SelectedIconComponent = getRuntimeShortcutIconComponent(value);

	return (
		<RadixPopover.Root open={open} onOpenChange={setOpen}>
			<RadixPopover.Trigger asChild>
				<button
					type="button"
					aria-label={`Shortcut icon: ${selectedOption.label}`}
					className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-border bg-surface-2 text-text-primary hover:bg-surface-3"
				>
					<SelectedIconComponent size={14} />
					<ChevronDown size={12} />
				</button>
			</RadixPopover.Trigger>
			<RadixPopover.Portal>
				<RadixPopover.Content
					side="bottom"
					align="start"
					sideOffset={4}
					className="z-50 rounded-md border border-border bg-surface-2 p-1 shadow-lg"
					style={{ animation: "kb-tooltip-show 100ms ease" }}
				>
					<div className="flex gap-0.5">
						{RUNTIME_SHORTCUT_ICON_OPTIONS.map((option) => {
							const IconComponent = getRuntimeShortcutIconComponent(option.value);
							return (
								<button
									key={option.value}
									type="button"
									aria-label={option.label}
									className={cn(
										"p-1.5 rounded hover:bg-surface-3",
										selectedOption.value === option.value && "bg-surface-3",
									)}
									onClick={() => {
										onSelect(option.value);
										setOpen(false);
									}}
								>
									<IconComponent size={14} />
								</button>
							);
						})}
					</div>
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}

export interface ShortcutRunButtonProps {
	shortcuts: RuntimeRepoShortcut[];
	selectedShortcutLabel?: string | null;
	runningShortcutLabel?: string | null;
	onRunShortcut: (label: string) => void;
	onSelectShortcutLabel?: (label: string) => void;
	onCreateFirstShortcut?: (shortcut: RuntimeRepoShortcut) => Promise<CreateShortcutResult>;
	onAddShortcut?: () => void;
}

export function ShortcutRunButton({
	shortcuts,
	selectedShortcutLabel,
	runningShortcutLabel,
	onRunShortcut,
	onSelectShortcutLabel,
	onCreateFirstShortcut,
	onAddShortcut,
}: ShortcutRunButtonProps): React.ReactElement | null {
	const isMobile = useIsMobile();

	const shortcutItems = shortcuts;
	const selectedShortcutIndex =
		selectedShortcutLabel === null || selectedShortcutLabel === undefined
			? 0
			: shortcutItems.findIndex((shortcut) => shortcut.label === selectedShortcutLabel);
	const selectedShortcut = shortcutItems[selectedShortcutIndex >= 0 ? selectedShortcutIndex : 0] ?? null;
	const SelectedShortcutIcon = selectedShortcut ? getRuntimeShortcutIconComponent(selectedShortcut.icon) : Play;

	const [isCreateShortcutDialogOpen, setIsCreateShortcutDialogOpen] = useState(false);
	const [isCreateShortcutSaving, setIsCreateShortcutSaving] = useState(false);
	const [createShortcutError, setCreateShortcutError] = useState<string | null>(null);
	const [newShortcutIcon, setNewShortcutIcon] = useState<RuntimeShortcutPickerIconId>("play");
	const [newShortcutLabel, setNewShortcutLabel] = useState("Run");
	const [newShortcutCommand, setNewShortcutCommand] = useState("");
	const canSaveNewShortcut = newShortcutCommand.trim().length > 0;

	const handleOpenCreateShortcutDialog = () => {
		setCreateShortcutError(null);
		setNewShortcutIcon("play");
		setNewShortcutLabel("Run");
		setNewShortcutCommand("");
		setIsCreateShortcutDialogOpen(true);
	};

	const handleSaveFirstShortcut = async () => {
		if (!onCreateFirstShortcut || !canSaveNewShortcut || isCreateShortcutSaving) {
			return;
		}
		setCreateShortcutError(null);
		setIsCreateShortcutSaving(true);
		const result = await onCreateFirstShortcut({
			label: newShortcutLabel.trim(),
			command: newShortcutCommand.trim(),
			icon: newShortcutIcon,
		});
		setIsCreateShortcutSaving(false);
		if (!result.ok) {
			setCreateShortcutError(result.message ?? "Could not save shortcut.");
			return;
		}
		setIsCreateShortcutDialogOpen(false);
	};

	if (!selectedShortcut && !onCreateFirstShortcut) {
		return null;
	}

	return (
		<>
			{isMobile ? (
				selectedShortcut ? (
					<Button
						variant="ghost"
						size="sm"
						icon={runningShortcutLabel ? <Spinner size={14} /> : <SelectedShortcutIcon size={14} />}
						disabled={Boolean(runningShortcutLabel)}
						onClick={() => onRunShortcut(selectedShortcut.label)}
						aria-label={selectedShortcut.label}
						className={MOBILE_TOUCH_TARGET}
					/>
				) : null
			) : (
				<>
					{selectedShortcut ? (
						<div className="flex">
							<Button
								variant="default"
								size="sm"
								icon={runningShortcutLabel ? <Spinner size={12} /> : <SelectedShortcutIcon size={14} />}
								disabled={Boolean(runningShortcutLabel)}
								onClick={() => onRunShortcut(selectedShortcut.label)}
								className="text-xs rounded-r-none kb-navbar-btn"
							>
								{selectedShortcut.label}
							</Button>
							<RadixPopover.Root>
								<RadixPopover.Trigger asChild>
									<Button
										size="sm"
										variant="default"
										icon={<ChevronDown size={12} />}
										aria-label="Select shortcut"
										disabled={Boolean(runningShortcutLabel)}
										className="rounded-l-none border-l-0 kb-navbar-btn"
										style={{ width: 24, paddingLeft: 0, paddingRight: 0 }}
									/>
								</RadixPopover.Trigger>
								<RadixPopover.Portal>
									<RadixPopover.Content
										className="z-50 rounded-lg border border-border bg-surface-2 p-1 shadow-xl"
										style={{ animation: "kb-tooltip-show 100ms ease" }}
										sideOffset={5}
										align="end"
									>
										<div className="min-w-[180px]">
											{shortcutItems.map((shortcut, shortcutIndex) => {
												const ShortcutIcon = getRuntimeShortcutIconComponent(shortcut.icon);
												const isActive =
													shortcutIndex === (selectedShortcutIndex >= 0 ? selectedShortcutIndex : 0);
												return (
													<button
														type="button"
														key={`${shortcut.label}:${shortcut.command}:${shortcutIndex}`}
														className={cn(
															"flex w-full items-center gap-2 px-2.5 py-1.5 text-[13px] text-text-primary rounded-md hover:bg-surface-3 text-left",
															isActive && "bg-surface-3",
														)}
														onClick={() => onSelectShortcutLabel?.(shortcut.label)}
													>
														<ShortcutIcon size={14} />
														<span className="flex-1">{shortcut.label}</span>
														{isActive ? <Check size={14} className="text-text-secondary" /> : null}
													</button>
												);
											})}
											<div className="h-px bg-border my-1" />
											<button
												type="button"
												className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[13px] text-text-primary rounded-md hover:bg-surface-3 text-left"
												onClick={onAddShortcut}
											>
												<Plus size={14} />
												<span>Add shortcut</span>
											</button>
										</div>
									</RadixPopover.Content>
								</RadixPopover.Portal>
							</RadixPopover.Root>
						</div>
					) : onCreateFirstShortcut ? (
						<Button
							variant="default"
							size="sm"
							icon={<Play size={14} />}
							onClick={handleOpenCreateShortcutDialog}
							className="text-xs kb-navbar-btn"
						>
							Run
						</Button>
					) : null}
				</>
			)}
			<Dialog
				open={isCreateShortcutDialogOpen}
				contentAriaDescribedBy={undefined}
				onOpenChange={(nextOpen) => {
					if (isCreateShortcutSaving) {
						return;
					}
					setIsCreateShortcutDialogOpen(nextOpen);
					if (!nextOpen) {
						setCreateShortcutError(null);
					}
				}}
			>
				<DialogHeader title="Set up your first script shortcut" icon={<Play size={16} />} />
				<DialogBody>
					<p className="text-text-secondary text-[13px] mt-0 mb-2">
						Script shortcuts run a command in the bottom terminal so you can quickly run and test your project.
					</p>
					<p className="text-text-secondary text-[13px] mt-0 mb-3">
						You can always open Settings to add and manage more shortcuts later.
					</p>
					<div className="grid gap-2" style={{ gridTemplateColumns: "max-content 1fr 2fr" }}>
						<FirstShortcutIconPicker value={newShortcutIcon} onSelect={setNewShortcutIcon} />
						<input
							value={newShortcutLabel}
							onChange={(event) => setNewShortcutLabel(event.target.value)}
							placeholder="Label"
							disabled={isCreateShortcutSaving}
							className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-60"
						/>
						<input
							value={newShortcutCommand}
							onChange={(event) => setNewShortcutCommand(event.target.value)}
							placeholder="npm run dev"
							disabled={isCreateShortcutSaving}
							className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-60"
						/>
					</div>
					{createShortcutError ? (
						<p className="text-status-red text-[13px] mt-3 mb-0">{createShortcutError}</p>
					) : null}
				</DialogBody>
				<DialogFooter>
					<Button
						onClick={() => {
							if (!isCreateShortcutSaving) {
								setIsCreateShortcutDialogOpen(false);
								setCreateShortcutError(null);
							}
						}}
						disabled={isCreateShortcutSaving}
					>
						Cancel
					</Button>
					<Button
						variant="primary"
						onClick={() => {
							void handleSaveFirstShortcut();
						}}
						disabled={!canSaveNewShortcut || isCreateShortcutSaving}
					>
						{isCreateShortcutSaving ? (
							<>
								<Spinner size={12} />
								Saving...
							</>
						) : (
							"Save"
						)}
					</Button>
				</DialogFooter>
			</Dialog>
		</>
	);
}
