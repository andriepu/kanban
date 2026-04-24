import { useCallback, useState } from "react";

import { notifyError } from "@/components/app-toaster";
import { resetRuntimeDebugState } from "@/runtime/runtime-config-query";
import type { RuntimeConfigResponse } from "@/runtime/types";

interface UseDebugToolsParams {
	runtimeProjectConfig: RuntimeConfigResponse | null;
	settingsRuntimeProjectConfig: RuntimeConfigResponse | null;
}

interface UseDebugToolsResult {
	debugModeEnabled: boolean;
	isDebugDialogOpen: boolean;
	isResetAllStatePending: boolean;
	handleOpenDebugDialog: () => void;
	handleDebugDialogOpenChange: (nextOpen: boolean) => void;
	handleResetAllState: () => void;
}

export function useDebugTools({
	runtimeProjectConfig,
	settingsRuntimeProjectConfig,
}: UseDebugToolsParams): UseDebugToolsResult {
	const [isDebugDialogOpen, setIsDebugDialogOpen] = useState(false);
	const [isResetAllStatePending, setIsResetAllStatePending] = useState(false);
	const debugModeEnabled =
		(settingsRuntimeProjectConfig?.debugModeEnabled ?? runtimeProjectConfig?.debugModeEnabled ?? false) === true;

	const handleOpenDebugDialog = useCallback(() => {
		setIsDebugDialogOpen(true);
	}, []);

	const handleDebugDialogOpenChange = useCallback((nextOpen: boolean) => {
		setIsDebugDialogOpen(nextOpen);
	}, []);

	const handleResetAllState = useCallback(() => {
		if (isResetAllStatePending) {
			return;
		}
		void (async () => {
			setIsResetAllStatePending(true);
			try {
				await resetRuntimeDebugState(null);
				window.localStorage.clear();
				window.sessionStorage.clear();
				window.location.reload();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				notifyError(`Could not reset all state: ${message}`);
				setIsResetAllStatePending(false);
			}
		})();
	}, [isResetAllStatePending]);

	return {
		debugModeEnabled,
		isDebugDialogOpen,
		isResetAllStatePending,
		handleOpenDebugDialog,
		handleDebugDialogOpenChange,
		handleResetAllState,
	};
}
