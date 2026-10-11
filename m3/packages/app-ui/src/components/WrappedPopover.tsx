"use client";

/**
 * Spacedrive-specific Popover wrapper that preserves the usePopover + trigger prop API.
 * Built on top of the M3 Base UI popover.
 *
 * Usage:
 *   const popover = usePopover();
 *   <WrappedPopover popover={popover} trigger={<button>Open</button>}>
 *     <div>Content</div>
 *   </WrappedPopover>
 */

import { Popover } from "@aphrody/m3-primitives";
import React, { useEffect, useRef } from "react";

import { usePopover } from "../hooks/usePopover";

interface WrappedPopoverProps {
	popover: ReturnType<typeof usePopover>;
	trigger: React.ReactNode;
	disabled?: boolean;
	children?: React.ReactNode;
	className?: string;
	side?: "top" | "right" | "bottom" | "left";
	align?: "start" | "center" | "end";
	sideOffset?: number;
	alignOffset?: number;
}

export function WrappedPopover({
	popover,
	trigger,
	disabled,
	children,
	className,
	...props
}: WrappedPopoverProps) {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const { setOpen } = popover;

	useEffect(() => {
		const onResize = () => {
			if (triggerRef.current && triggerRef.current.offsetWidth === 0) setOpen(false);
		};

		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [setOpen]);

	return (
		<Popover.Root open={popover.open} onOpenChange={popover.setOpen}>
			<Popover.Trigger ref={triggerRef} disabled={disabled} asChild>
				{trigger}
			</Popover.Trigger>
			<Popover.Content className={className} {...props}>
				{children}
			</Popover.Content>
		</Popover.Root>
	);
}

export { usePopover };
