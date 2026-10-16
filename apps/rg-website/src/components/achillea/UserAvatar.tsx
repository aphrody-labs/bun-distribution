"use client";

import { useState } from "react";
import Image from "next/image";
import { resolveDiscordAvatarUrl } from "@rosegriffon/achillea-core";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
	userId?: string | null;
	avatar?: string | null;
	name?: string | null;
	displayName?: string | null;
	size?: "sm" | "md" | "lg" | "xl";
	className?: string;
}

export function UserAvatar({
	userId,
	avatar,
	name,
	displayName,
	size = "md",
	className,
}: UserAvatarProps) {
	const [broken, setBroken] = useState(false);

	const resolvedName = (name ?? displayName ?? "Joueur").trim();
	const initial = resolvedName.charAt(0).toUpperCase() || "?";
	const effectiveUserId =
		userId?.trim() ||
		(typeof avatar === "string" ? avatar.match(/\/avatars\/(\d+)\//)?.[1] : undefined) ||
		"0";
	const defaultAvatarIndex = (() => {
		try {
			return Number((BigInt(effectiveUserId) >> 22n) % 6n);
		} catch {
			return 0;
		}
	})();
	const resolvedUrl = broken
		? `https://cdn.discordapp.com/embed/avatars/${Math.abs(defaultAvatarIndex)}.png`
		: resolveDiscordAvatarUrl(effectiveUserId, avatar);

	const sizeClasses = {
		sm: "size-7 text-xs",
		md: "size-9 text-sm",
		lg: "size-12 text-base",
		xl: "size-16 text-xl",
	}[size];

	const sizePixels = {
		sm: 28,
		md: 36,
		lg: 48,
		xl: 64,
	}[size];

	if (!resolvedUrl) {
		return (
			<div
				className={cn(
					"rounded-full bg-surface-variant flex items-center justify-center font-bold text-on-surface-variant shrink-0 border border-outline/30",
					sizeClasses,
					className
				)}
			>
				{initial}
			</div>
		);
	}

	return (
		<div
			className={cn(
				"relative rounded-full overflow-hidden shrink-0 bg-surface-variant border border-outline/30",
				sizeClasses,
				className
			)}
		>
			<Image
				src={resolvedUrl}
				alt={name || "Avatar"}
				width={sizePixels}
				height={sizePixels}
				unoptimized
				className="object-cover size-full"
				onError={() => setBroken(true)}
			/>
		</div>
	);
}
