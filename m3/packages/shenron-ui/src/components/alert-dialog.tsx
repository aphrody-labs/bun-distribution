"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import type * as React from "react";

import { cn } from "../lib/utils";

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
const AlertDialogPortal = AlertDialogPrimitive.Portal;
const AlertDialogClose = AlertDialogPrimitive.Close;

function AlertDialogBackdrop({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Backdrop>) {
	return (
		<AlertDialogPrimitive.Backdrop
			className={cn(
				"fixed inset-0 z-50 bg-black/85 backdrop-blur-md transition-all duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
				className
			)}
			{...props}
		/>
	);
}

function AlertDialogPopup({
	className,
	children,
	variant = "shenron",
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Popup> & {
	variant?: "shenron" | "danger" | "saiyan";
}) {
	const variants = {
		shenron:
			"border-3 border-black bg-[#0d0d14] shadow-[8px_8px_0px_#000] text-gray-100",
		danger:
			"border-3 border-red-600/90 bg-[#140608] shadow-[0_0_30px_rgba(220,38,38,0.4)] text-red-200",
		saiyan:
			"border-3 border-dbz-orange bg-[#120a04] shadow-[0_0_30px_rgba(255,107,0,0.4)] text-amber-100",
	};

	return (
		<AlertDialogPortal>
			<AlertDialogBackdrop />
			<AlertDialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 sm:p-6">
				<AlertDialogPrimitive.Popup
					className={cn(
						"relative w-full max-w-md rounded-2xl p-6 sm:p-8 transition-all duration-200 outline-none",
						"data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
						variants[variant],
						className
					)}
					{...props}
				>
					{variant === "shenron" && (
						<div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-green-500 via-emerald-400 to-green-500 rounded-t-xl" />
					)}
					{variant === "danger" && (
						<div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-red-600 via-rose-500 to-red-600 rounded-t-xl" />
					)}
					{children}
				</AlertDialogPrimitive.Popup>
			</AlertDialogPrimitive.Viewport>
		</AlertDialogPortal>
	);
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("flex flex-col space-y-2 text-center sm:text-left mb-6", className)}
			{...props}
		/>
	);
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-3 gap-2 mt-6 pt-4 border-t border-black/40",
				className
			)}
			{...props}
		/>
	);
}

function AlertDialogTitle({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
	return (
		<AlertDialogPrimitive.Title
			className={cn(
				"font-saiyan text-2xl sm:text-3xl font-bold uppercase tracking-wider text-white drop-shadow-[0_2px_8px_rgba(255,107,0,0.3)]",
				className
			)}
			{...props}
		/>
	);
}

function AlertDialogDescription({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
	return (
		<AlertDialogPrimitive.Description
			className={cn("text-sm text-gray-300 leading-relaxed font-sans", className)}
			{...props}
		/>
	);
}

export {
	AlertDialog,
	AlertDialogTrigger,
	AlertDialogPortal,
	AlertDialogClose,
	AlertDialogBackdrop,
	AlertDialogPopup,
	AlertDialogHeader,
	AlertDialogFooter,
	AlertDialogTitle,
	AlertDialogDescription,
};
