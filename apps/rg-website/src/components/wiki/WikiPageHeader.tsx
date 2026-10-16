import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

/** Barre de titre compacte partagée par les collections du wiki. */
export function WikiPageHeader({
	icon,
	title,
	description,
	count,
	className,
}: {
	icon: string;
	title: string;
	description: React.ReactNode;
	count?: React.ReactNode;
	className?: string;
}) {
	void description;

	return (
		<header
			className={cn(
				"flex min-h-16 items-center gap-3 border-b border-outline-variant/60 px-4 py-3 min-[600px]:px-6",
				className
			)}
		>
			<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
				<Icon name={icon} size={24} />
			</div>
			<h1 className="min-w-0 flex-1 truncate font-display text-xl font-extrabold tracking-tight text-on-surface min-[840px]:text-2xl">
				{title}
			</h1>
			{count != null && (
				<div className="shrink-0 rounded-full bg-surface-container px-3 py-1 text-xs font-semibold text-on-surface-variant">
					{count}
				</div>
			)}
		</header>
	);
}
