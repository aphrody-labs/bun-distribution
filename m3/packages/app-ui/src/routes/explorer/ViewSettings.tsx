import { useState, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { clsx } from "clsx";
import { useExplorer } from "./context";
import { CircleButton, Slider, Switch } from "@aphrody/m3-primitives";

interface ViewSettingsPanelProps {
	viewSettings: any;
	setViewSettings: (settings: any) => void;
	viewMode: string;
	totalFileCount?: number;
}

function SliderSetting({
	label,
	valueLabel,
	min,
	max,
	step,
	value,
	onChange,
}: {
	label: string;
	valueLabel: string;
	min: number;
	max: number;
	step: number;
	value: number;
	onChange: (value: number) => void;
}) {
	const id = useId();
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<label id={id} className="text-body-small text-on-surface-variant">
					{label}
				</label>
				<span className="text-label-medium text-on-surface">{valueLabel}</span>
			</div>
			<Slider
				aria-labelledby={id}
				min={min}
				max={max}
				step={step}
				value={[value]}
				onValueChange={([next]) => {
					if (next !== undefined) onChange(next);
				}}
			/>
		</div>
	);
}

function SwitchSetting({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	const id = useId();
	return (
		<div className="flex items-center justify-between pt-1">
			<label htmlFor={id} className="text-body-small text-on-surface-variant">
				{label}
			</label>
			<Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
		</div>
	);
}

export function ViewSettingsPanel({
	viewSettings,
	setViewSettings,
	viewMode,
	totalFileCount,
}: ViewSettingsPanelProps) {
	const sizeViewLimit = Math.min(viewSettings.sizeViewItemLimit || 500, totalFileCount || 500);
	return (
		<div className="w-72 bg-surface-container rounded-medium shadow-md3-3 p-4 space-y-4 border border-outline-variant/50">
			<div className="text-title-small text-on-surface font-medium border-b border-outline-variant/60 pb-2">
				Paramètres d'affichage
			</div>

			{/* Column Width (Column View Only) */}
			{viewMode === "column" && (
				<SliderSetting
					label="Largeur de colonne"
					valueLabel={`${viewSettings.columnWidth}px`}
					min={200}
					max={400}
					step={8}
					value={viewSettings.columnWidth}
					onChange={(columnWidth) => setViewSettings({ columnWidth })}
				/>
			)}

			{/* Grid Size (Grid View and Media View) */}
			{(viewMode === "grid" || viewMode === "media") && (
				<SliderSetting
					label={viewMode === "media" ? "Taille des vignettes" : "Taille de grille"}
					valueLabel={`${viewSettings.gridSize}px`}
					min={80}
					max={400}
					step={10}
					value={viewSettings.gridSize}
					onChange={(gridSize) => setViewSettings({ gridSize })}
				/>
			)}

			{/* Gap Size (Grid View Only) */}
			{viewMode === "grid" && (
				<SliderSetting
					label="Espacement"
					valueLabel={`${viewSettings.gapSize}px`}
					min={1}
					max={32}
					step={1}
					value={viewSettings.gapSize}
					onChange={(gapSize) => setViewSettings({ gapSize })}
				/>
			)}

			{/* Item Limit (Size View Only) */}
			{viewMode === "size" && (
				<SliderSetting
					label="Éléments affichés"
					valueLabel={`${sizeViewLimit} / ${totalFileCount || 0}`}
					min={50}
					max={Math.max(50, totalFileCount || 500)}
					step={10}
					value={sizeViewLimit}
					onChange={(sizeViewItemLimit) => setViewSettings({ sizeViewItemLimit })}
				/>
			)}

			<SwitchSetting
				label="Afficher la taille des fichiers"
				checked={!!viewSettings.showFileSize}
				onChange={() => setViewSettings({ showFileSize: !viewSettings.showFileSize })}
			/>

			<SwitchSetting
				label="Dossiers en premier"
				checked={!!viewSettings.foldersFirst}
				onChange={() => setViewSettings({ foldersFirst: !viewSettings.foldersFirst })}
			/>
		</div>
	);
}

interface ViewSettingsProps {
	className?: string;
	totalFileCount?: number;
}

export function ViewSettings({ className, totalFileCount }: ViewSettingsProps) {
	const [isOpen, setIsOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState({ top: 0, right: 0 });
	const { viewSettings, setViewSettings, viewMode } = useExplorer();

	// Update position when opened
	useEffect(() => {
		if (isOpen && buttonRef.current) {
			const rect = buttonRef.current.getBoundingClientRect();
			setPosition({
				top: rect.bottom + 8, // 8px gap (mt-2)
				right: window.innerWidth - rect.right,
			});
		}
	}, [isOpen]);

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (
				panelRef.current &&
				buttonRef.current &&
				!panelRef.current.contains(e.target as Node) &&
				!buttonRef.current.contains(e.target as Node)
			) {
				setIsOpen(false);
			}
		};

		if (isOpen) {
			document.addEventListener("mousedown", handleClickOutside);
			return () => document.removeEventListener("mousedown", handleClickOutside);
		}
	}, [isOpen]);

	return (
		<>
			<div className={clsx(className)}>
				<CircleButton
					ref={buttonRef}
					icon="tune"
					onClick={() => setIsOpen(!isOpen)}
					active={isOpen}
					title="View settings"
				/>
			</div>

			{isOpen &&
				createPortal(
					<AnimatePresence>
						<motion.div
							ref={panelRef}
							initial={{ opacity: 0, y: -8 }}
							animate={{
								opacity: 1,
								y: 0,
								transition: { duration: m3Durations.medium1, ease: m3Easings.emphasizedDecelerate },
							}}
							exit={{
								opacity: 0,
								y: -8,
								transition: { duration: m3Durations.short3, ease: m3Easings.emphasizedAccelerate },
							}}
							style={{
								position: "fixed",
								top: `${position.top}px`,
								right: `${position.right}px`,
							}}
							className="z-50"
						>
							<ViewSettingsPanel
								viewSettings={viewSettings}
								setViewSettings={setViewSettings}
								viewMode={viewMode}
								totalFileCount={totalFileCount}
							/>
						</motion.div>
					</AnimatePresence>,
					document.body,
				)}
		</>
	);
}
