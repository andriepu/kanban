import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/components/ui/cn";
import { Link } from "@/components/ui/link";

interface MarkdownTextProps {
	children: string;
	className?: string;
}

export function MarkdownText({ children, className }: MarkdownTextProps): React.ReactElement {
	return (
		<div
			className={cn(
				"text-sm text-text-secondary break-words",
				"[&_p]:my-2 first:[&_p]:mt-0 last:[&_p]:mb-0",
				"[&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-text-primary",
				"[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-text-primary",
				"[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-text-primary",
				"[&_strong]:font-semibold [&_strong]:text-text-primary",
				"[&_em]:italic",
				"[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
				"[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-surface-2 [&_pre]:p-2 [&_pre]:text-xs",
				"[&_pre_code]:bg-transparent [&_pre_code]:p-0",
				"[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
				"[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
				"[&_li]:my-0.5",
				"[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border-bright [&_blockquote]:pl-3 [&_blockquote]:text-text-tertiary",
				"[&_hr]:my-3 [&_hr]:border-border",
				className,
			)}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					a: ({ href, children: linkChildren, ...props }) => (
						<Link href={href} external {...props}>
							{linkChildren}
						</Link>
					),
				}}
			>
				{children}
			</ReactMarkdown>
		</div>
	);
}
