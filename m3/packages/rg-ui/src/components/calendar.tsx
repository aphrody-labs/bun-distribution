"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import * as React from "react";

import {
	addDays,
	addMonths,
	type DayRange,
	dayLabel,
	firstDayOfWeek,
	inRange,
	isoWeekNumber,
	isSameDay,
	isSameMonth,
	monthGrid,
	monthLabel,
	nextRange,
	startOfDay,
	startOfMonth,
	weekdayLabels,
} from "../lib/calendar-grid";
import { cn } from "../lib/utils";
import { Button, buttonVariants } from "./button";

type DayMatcher = Date | Date[] | ((date: Date) => boolean) | { before?: Date; after?: Date };

type CalendarCommon = {
	className?: string;
	/** Locale BCP 47 (noms de mois et de jours, début de semaine). Défaut : fr-FR. */
	locale?: string;
	/** 0 = dimanche. Défaut : celui de la locale. */
	weekStartsOn?: number;
	showOutsideDays?: boolean;
	showWeekNumber?: boolean;
	numberOfMonths?: number;
	month?: Date;
	defaultMonth?: Date;
	onMonthChange?: (month: Date) => void;
	disabled?: DayMatcher;
	buttonVariant?: React.ComponentProps<typeof Button>["variant"];
	/** Surcharges de classes par emplacement (root, month, day, today…). */
	classNames?: Partial<Record<CalendarSlot, string>>;
};

type CalendarSlot =
	| "root"
	| "months"
	| "month"
	| "nav"
	| "button_previous"
	| "button_next"
	| "month_caption"
	| "caption_label"
	| "month_grid"
	| "weekdays"
	| "weekday"
	| "week"
	| "week_number_header"
	| "week_number"
	| "day"
	| "today"
	| "outside"
	| "disabled";

export type CalendarProps = CalendarCommon &
	(
		| { mode?: "single"; selected?: Date; onSelect?: (date?: Date) => void }
		| { mode: "multiple"; selected?: Date[]; onSelect?: (dates?: Date[]) => void }
		| { mode: "range"; selected?: DayRange; onSelect?: (range?: DayRange) => void }
	);

function matches(matcher: DayMatcher | undefined, date: Date): boolean {
	if (!matcher) return false;
	if (typeof matcher === "function") return matcher(date);
	if (matcher instanceof Date) return isSameDay(matcher, date);
	if (Array.isArray(matcher)) return matcher.some((entry) => isSameDay(entry, date));
	const day = startOfDay(date).getTime();
	return (
		(matcher.before !== undefined && day < startOfDay(matcher.before).getTime()) ||
		(matcher.after !== undefined && day > startOfDay(matcher.after).getTime())
	);
}

function selectedOf(props: CalendarProps, date: Date) {
	if (props.mode === "multiple") {
		return { selected: props.selected?.some((entry) => isSameDay(entry, date)) ?? false };
	}
	if (props.mode === "range") {
		const range = props.selected;
		const inside = inRange(date, range);
		const from = range?.from;
		const to = range?.to ?? range?.from;
		const start = Boolean(from && to && isSameDay(date, from < to ? from : to));
		const end = Boolean(from && to && isSameDay(date, from < to ? to : from));
		return {
			selected: inside,
			rangeStart: inside && start,
			rangeEnd: inside && end,
			rangeMiddle: inside && !start && !end,
		};
	}
	return { selected: props.selected ? isSameDay(props.selected, date) : false };
}

function Calendar(props: CalendarProps) {
	const {
		className,
		locale = "fr-FR",
		showOutsideDays = true,
		showWeekNumber = false,
		numberOfMonths = 1,
		disabled,
		buttonVariant = "ghost",
		classNames = {},
	} = props;
	const weekStartsOn = props.weekStartsOn ?? firstDayOfWeek(locale);

	const initial = React.useMemo(() => {
		const anchor =
			props.defaultMonth ??
			(props.mode === "range"
				? props.selected?.from
				: props.mode === "multiple"
					? props.selected?.[0]
					: props.selected) ??
			new Date();
		return startOfMonth(anchor);
		// Mois initial uniquement.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	const [innerMonth, setInnerMonth] = React.useState(initial);
	const month = startOfMonth(props.month ?? innerMonth);
	const [focused, setFocused] = React.useState<Date | undefined>();
	const rootRef = React.useRef<HTMLDivElement>(null);

	const goTo = (target: Date) => {
		const next = startOfMonth(target);
		if (!props.month) setInnerMonth(next);
		props.onMonthChange?.(next);
	};

	const pick = (date: Date) => {
		if (matches(disabled, date)) return;
		if (props.mode === "multiple") {
			const current = props.selected ?? [];
			const exists = current.some((entry) => isSameDay(entry, date));
			const next = exists ? current.filter((entry) => !isSameDay(entry, date)) : [...current, date];
			props.onSelect?.(next.length ? next : undefined);
		} else if (props.mode === "range") {
			props.onSelect?.(nextRange(props.selected, date));
		} else {
			props.onSelect?.(props.selected && isSameDay(props.selected, date) ? undefined : date);
		}
	};

	const onKeyDown = (event: React.KeyboardEvent, date: Date) => {
		const moves: Record<string, Date> = {
			ArrowLeft: addDays(date, -1),
			ArrowRight: addDays(date, 1),
			ArrowUp: addDays(date, -7),
			ArrowDown: addDays(date, 7),
			PageUp: addMonths(date, -1),
			PageDown: addMonths(date, 1),
			Home: addDays(date, -((date.getDay() - weekStartsOn + 7) % 7)),
			End: addDays(date, 6 - ((date.getDay() - weekStartsOn + 7) % 7)),
		};
		const target = moves[event.key];
		if (!target) return;
		event.preventDefault();
		setFocused(target);
		const visibleStart = month;
		const visibleEnd = addMonths(month, numberOfMonths - 1);
		if (!isSameMonth(target, visibleStart) && target < visibleStart) goTo(target);
		else if (!isSameMonth(target, visibleEnd) && target > visibleEnd) goTo(addMonths(target, 1 - numberOfMonths));
	};

	React.useEffect(() => {
		if (!focused) return;
		const key = focused.toDateString();
		rootRef.current
			?.querySelector<HTMLButtonElement>(`button[data-date="${CSS.escape(key)}"]`)
			?.focus();
	}, [focused, month]);

	const today = new Date();
	const rovingTarget =
		focused ??
		(props.mode === "single" && props.selected && isSameMonth(props.selected, month)
			? props.selected
			: isSameMonth(today, month)
				? today
				: month);

	return (
		<div
			ref={rootRef}
			data-slot="calendar"
			className={cn(
				"group/calendar relative w-fit bg-background p-3 [--cell-size:--spacing(8)] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
				className,
				classNames.root
			)}
		>
			<div className={cn("relative flex flex-col gap-4 md:flex-row", classNames.months)}>
				<div
					className={cn(
						"absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
						classNames.nav
					)}
				>
					<button
						type="button"
						aria-label="Mois précédent"
						className={cn(
							buttonVariants({ variant: buttonVariant }),
							"size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
							classNames.button_previous
						)}
						onClick={() => goTo(addMonths(month, -1))}
					>
						<ChevronLeftIcon className="size-4 rtl:rotate-180" />
					</button>
					<button
						type="button"
						aria-label="Mois suivant"
						className={cn(
							buttonVariants({ variant: buttonVariant }),
							"size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
							classNames.button_next
						)}
						onClick={() => goTo(addMonths(month, 1))}
					>
						<ChevronRightIcon className="size-4 rtl:rotate-180" />
					</button>
				</div>
				{Array.from({ length: numberOfMonths }, (_, offset) => {
					const shown = addMonths(month, offset);
					return (
						<div
							key={shown.getTime()}
							className={cn("flex w-full flex-col gap-4", classNames.month)}
						>
							<div
								className={cn(
									"flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
									classNames.month_caption
								)}
							>
								<span
									aria-live="polite"
									className={cn("text-sm font-medium select-none", classNames.caption_label)}
								>
									{monthLabel(locale, shown)}
								</span>
							</div>
							<table
								role="grid"
								aria-label={monthLabel(locale, shown)}
								className={cn("w-full border-collapse", classNames.month_grid)}
							>
								<thead>
									<tr className={cn("flex", classNames.weekdays)}>
										{showWeekNumber ? (
											<th
												className={cn("w-(--cell-size) select-none", classNames.week_number_header)}
											/>
										) : null}
										{weekdayLabels(locale, weekStartsOn, "short").map((label, index) => (
											<th
												key={label}
												scope="col"
												aria-label={weekdayLabels(locale, weekStartsOn, "long")[index]}
												className={cn(
													"flex-1 rounded-md text-[0.8rem] font-normal text-muted-foreground select-none",
													classNames.weekday
												)}
											>
												{label}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{monthGrid(shown, weekStartsOn).map((week) => (
										<tr key={week[0]!.date.getTime()} className={cn("mt-2 flex w-full", classNames.week)}>
											{showWeekNumber ? (
												<td
													className={cn(
														"text-[0.8rem] text-muted-foreground select-none",
														classNames.week_number
													)}
												>
													<div className="flex size-(--cell-size) items-center justify-center text-center">
														{isoWeekNumber(week[0]!.date)}
													</div>
												</td>
											) : null}
											{week.map(({ date, outside }) => {
												if (outside && (!showOutsideDays || numberOfMonths > 1)) {
													return (
														<td
															key={date.getTime()}
															role="gridcell"
															className={cn("invisible aspect-square h-full w-full p-0")}
														/>
													);
												}
												const state = selectedOf(props, date);
												const isDisabled = matches(disabled, date);
												const isToday = isSameDay(date, today);
												return (
													<td
														key={date.getTime()}
														role="gridcell"
														aria-selected={state.selected || undefined}
														data-selected={state.selected || undefined}
														className={cn(
															"group/day relative aspect-square h-full w-full p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-md",
															showWeekNumber
																? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-md"
																: "[&:first-child[data-selected=true]_button]:rounded-l-md",
															state.rangeStart && "rounded-l-md bg-accent",
															state.rangeMiddle && "rounded-none",
															state.rangeEnd && "rounded-r-md bg-accent",
															isToday &&
																"rounded-md bg-accent text-accent-foreground data-[selected=true]:rounded-none",
															outside && "text-muted-foreground aria-selected:text-muted-foreground",
															isDisabled && "text-muted-foreground opacity-50",
															classNames.day,
															isToday && classNames.today,
															outside && classNames.outside,
															isDisabled && classNames.disabled
														)}
													>
														<Button
															type="button"
															variant="ghost"
															size="icon"
															data-date={date.toDateString()}
															data-day={date.toLocaleDateString()}
															data-selected-single={
																state.selected &&
																!state.rangeStart &&
																!state.rangeEnd &&
																!state.rangeMiddle
															}
															data-range-start={state.rangeStart}
															data-range-end={state.rangeEnd}
															data-range-middle={state.rangeMiddle}
															aria-label={dayLabel(locale, date)}
															aria-pressed={state.selected}
															aria-current={isToday ? "date" : undefined}
															disabled={isDisabled}
															tabIndex={isSameDay(date, rovingTarget) ? 0 : -1}
															className="flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 leading-none font-normal data-[range-end=true]:rounded-md data-[range-end=true]:rounded-r-md data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:rounded-md data-[range-start=true]:rounded-l-md data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground dark:hover:text-accent-foreground [&>span]:text-xs [&>span]:opacity-70"
															onClick={() => {
																pick(date);
																setFocused(date);
															}}
															onKeyDown={(event) => onKeyDown(event, date)}
														>
															{date.getDate()}
														</Button>
													</td>
												);
											})}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					);
				})}
			</div>
		</div>
	);
}

export { Calendar };
