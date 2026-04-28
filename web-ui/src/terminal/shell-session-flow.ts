import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";

export interface StartShellTerminalSessionInput {
	workspaceId: string;
	taskId: string;
	cols: number;
	rows: number;
	baseRef: string;
	workspaceTaskId?: string;
	customCwd?: string;
}

export interface StartShellTerminalSessionResult {
	ok: boolean;
	summary: RuntimeTaskSessionSummary | null;
	shellBinary: string | null;
	created: boolean;
	foregroundProcess: string | null;
	descendantCommands: string[];
	error?: string;
}

export async function startShellTerminalSession(
	input: StartShellTerminalSessionInput,
): Promise<StartShellTerminalSessionResult> {
	const trpcClient = getRuntimeTrpcClient(input.workspaceId);
	const result = await trpcClient.runtime.startShellSession.mutate({
		taskId: input.taskId,
		cols: input.cols,
		rows: input.rows,
		baseRef: input.baseRef,
		workspaceTaskId: input.workspaceTaskId,
		customCwd: input.customCwd,
	});
	return {
		...result,
		shellBinary: result.shellBinary ?? null,
		created: result.created ?? false,
		foregroundProcess: result.foregroundProcess ?? null,
		descendantCommands: result.descendantCommands ?? [],
	};
}

export async function sendShellTerminalInput(input: {
	workspaceId: string;
	taskId: string;
	text: string;
	appendNewline: boolean;
}): Promise<{ ok: boolean; message?: string }> {
	const trpcClient = getRuntimeTrpcClient(input.workspaceId);
	const result = await trpcClient.runtime.sendTaskSessionInput.mutate({
		taskId: input.taskId,
		text: input.text,
		appendNewline: input.appendNewline,
	});
	return {
		ok: result.ok,
		message: result.error,
	};
}
