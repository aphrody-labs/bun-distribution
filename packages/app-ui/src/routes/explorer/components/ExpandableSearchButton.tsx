import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { CircleButton, SearchBar } from "@aphrody/m3-primitives";

interface ExpandableSearchButtonProps {
	value: string;
	onChange: (value: string) => void;
	onClear: () => void;
	placeholder?: string;
}

export function ExpandableSearchButton({
	value,
	onChange,
	onClear,
	placeholder = "Search...",
}: ExpandableSearchButtonProps) {
	const [isExpanded, setIsExpanded] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// Expand if there's a value
	useEffect(() => {
		if (value) {
			setIsExpanded(true);
		}
	}, [value]);

	// Collapse when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(event.target as Node) &&
				isExpanded &&
				!value
			) {
				setIsExpanded(false);
			}
		};

		if (isExpanded) {
			document.addEventListener("mousedown", handleClickOutside);
			return () => {
				document.removeEventListener("mousedown", handleClickOutside);
			};
		}
	}, [isExpanded, value]);

	// Handle button click
	const handleButtonClick = () => {
		setIsExpanded(true);
	};

	// Focus input after animation completes
	const handleAnimationComplete = () => {
		if (isExpanded && inputRef.current) {
			inputRef.current.focus();
		}
	};

	// Handle input blur - collapse if empty
	const handleBlur = () => {
		if (!value) {
			setIsExpanded(false);
		}
	};

	return (
		<div ref={containerRef}>
			<motion.div
				animate={{
					width: isExpanded ? 256 : 40, // w-64 = 256px, M3 icon button = 40px
				}}
				transition={{
					duration: m3Durations.medium2,
					ease: isExpanded ? m3Easings.emphasizedDecelerate : m3Easings.emphasizedAccelerate,
				}}
				className="overflow-hidden"
				onAnimationComplete={handleAnimationComplete}
			>
				<AnimatePresence mode="wait" initial={false}>
					{!isExpanded ? (
						<motion.div
							key="button"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: m3Durations.short3, ease: m3Easings.standard }}
						>
							<CircleButton icon="search" title="Search" onClick={handleButtonClick} />
						</motion.div>
					) : (
						<motion.div
							key="searchbar"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: m3Durations.short3, ease: m3Easings.standard }}
						>
							<SearchBar
								ref={inputRef}
								value={value}
								onChange={onChange}
								onClear={onClear}
								placeholder={placeholder}
								size="sm"
								className="w-64"
								onBlur={handleBlur}
								autoFocus
							/>
						</motion.div>
					)}
				</AnimatePresence>
			</motion.div>
		</div>
	);
}