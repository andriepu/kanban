import { useRef } from "react";
import type { SessionActivity } from "@/components/shared/session-activity";
import { getSessionActivity, SESSION_ACTIVITY_COLOR } from "@/components/shared/session-activity";
import { cn } from "@/components/ui/cn";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";

export interface SessionActivityIndicatorProps {
	summary: RuntimeTaskSessionSummary | null | undefined;
	/** Stable id used to reset sticky last-known activity when caller swaps entities. */
	identityKey: string;
	/** Render compact two-line variant. Default: false (six-line). */
	compact?: boolean;
	/** Force muted color (e.g. when host card is in trash). */
	muted?: boolean;
	className?: string;
}

export function SessionActivityIndicator({
	summary,
	identityKey,
	compact = false,
	muted = false,
	className,
}: SessionActivityIndicatorProps): React.ReactElement | null {
	const rawActivity = getSessionActivity(summary ?? undefined);
	const lastActivityRef = useRef<SessionActivity | null>(null);
	const lastIdentityKeyRef = useRef<string | null>(null);

	// Reset sticky state when the caller swaps entities.
	if (lastIdentityKeyRef.current !== identityKey) {
		lastIdentityKeyRef.current = identityKey;
		lastActivityRef.current = null;
	}
	if (rawActivity) {
		lastActivityRef.current = rawActivity;
	}
	const activity = rawActivity ?? lastActivityRef.current;

	if (!activity) {
		return null;
	}

	const dotColor = muted ? SESSION_ACTIVITY_COLOR.muted : activity.dotColor;

	return (
		<div
			data-pull-request-activity=""
			className={cn("flex gap-1.5 items-start", className)}
			style={{ color: muted ? SESSION_ACTIVITY_COLOR.muted : undefined }}
		>
			<span
				className="inline-block shrink-0 rounded-full"
				style={{ width: 6, height: 6, backgroundColor: dotColor, marginTop: 4 }}
			/>
			<p
				className={cn("m-0 font-mono", compact ? "line-clamp-2" : "line-clamp-6")}
				style={{ fontSize: 12, whiteSpace: "normal", overflowWrap: "anywhere" }}
			>
				{activity.text}
			</p>
		</div>
	);
}
