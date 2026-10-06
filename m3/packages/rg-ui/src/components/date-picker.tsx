"use client";

import * as React from "react";
import { Calendar as CalendarIcon } from "lucide-react";

import { cn } from "../lib/utils";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

const LOCALE = "fr-FR";
const formatLong = new Intl.DateTimeFormat(LOCALE, { dateStyle: "long" });

interface DatePickerProps {
	date?: Date;
	setDate: (date?: Date) => void;
	placeholder?: string;
	className?: string;
}

export function DatePicker({
	date,
	setDate,
	placeholder = "Choisir une date",
	className,
}: DatePickerProps) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant={"outline"}
					className={cn(
						"w-full justify-start text-left font-normal",
						!date && "text-muted-foreground",
						className
					)}
				>
					<CalendarIcon className="mr-2 h-4 w-4" />
					{date ? formatLong.format(date) : <span>{placeholder}</span>}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="start">
				<Calendar mode="single" selected={date} onSelect={setDate} locale={LOCALE} />
			</PopoverContent>
		</Popover>
	);
}
