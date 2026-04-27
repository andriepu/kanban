import { useHotkeys } from "react-hotkeys-hook";

import type { CardSelection } from "@/types";

function isEventInsideDialog(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest("[role='dialog']") !== null;
}

interface UseAppHotkeysInput {
	selectedCard: CardSelection | null;
	isHomeGitHistoryOpen: boolean;
	canUseCreateTaskShortcut: boolean;
	handleToggleDetailTerminal: () => void;
	handleToggleHomeTerminal: () => void;
	handleOpenCreateTask: () => void;
	handleOpenSettings: () => void;
	handleToggleGitHistory: () => void;
	handleCloseGitHistory: () => void;
	onStartAllTasks: () => void;
}

export function useAppHotkeys({
	selectedCard,
	isHomeGitHistoryOpen,
	canUseCreateTaskShortcut,
	handleToggleDetailTerminal,
	handleToggleHomeTerminal,
	handleOpenCreateTask,
	handleOpenSettings,
	handleToggleGitHistory,
	handleCloseGitHistory,
	onStartAllTasks,
}: UseAppHotkeysInput): void {
	useHotkeys(
		"mod+j",
		() => {
			if (selectedCard) {
				handleToggleDetailTerminal();
				return;
			}
			handleToggleHomeTerminal();
		},
		{
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[handleToggleDetailTerminal, handleToggleHomeTerminal, selectedCard],
	);

	useHotkeys(
		"mod+b",
		onStartAllTasks,
		{
			enableOnContentEditable: false,
			enableOnFormTags: false,
			preventDefault: true,
		},
		[onStartAllTasks],
	);

	useHotkeys(
		"c",
		() => {
			if (!canUseCreateTaskShortcut) {
				return;
			}
			handleOpenCreateTask();
		},
		{ preventDefault: true },
		[canUseCreateTaskShortcut, handleOpenCreateTask],
	);

	useHotkeys(
		"mod+g",
		() => {
			handleToggleGitHistory();
		},
		{
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[handleToggleGitHistory],
	);

	useHotkeys(
		"mod+shift+s",
		() => {
			handleOpenSettings();
		},
		{
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[handleOpenSettings],
	);

	useHotkeys(
		"escape",
		(event) => {
			if (selectedCard || !isHomeGitHistoryOpen || isEventInsideDialog(event.target)) {
				return;
			}
			event.preventDefault();
			handleCloseGitHistory();
		},
		{
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[handleCloseGitHistory, isHomeGitHistoryOpen, selectedCard],
	);
}
