import { clsx } from "clsx";
import { motion } from "motion/react";
import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { getDeviceIcon } from "../../../contexts/SpacedriveContext";
import LaptopIcon from "@aphrody/assets/icons/Laptop.png";
import type { VirtualView } from "../context";

interface VirtualPathBarProps {
  view: VirtualView;
  devices: Map<string, any>;
}

/**
 * PathBar for virtual views (device listings, all devices, etc.)
 * Shows the view name with an appropriate icon instead of file path breadcrumbs
 */
export function VirtualPathBar({ view, devices }: VirtualPathBarProps) {
  const device = view.id ? devices.get(view.id) : null;

  // Determine label and icon based on view type
  const label = (() => {
    if (view.view === "device" && device) {
      return device.name;
    }
    if (view.view === "devices") {
      return "All Devices";
    }
    return "Virtual View";
  })();

  const icon = (() => {
    if (view.view === "device" && device) {
      return getDeviceIcon(device);
    }
    return LaptopIcon;
  })();

  return (
    <motion.div
      initial={{ width: 150 }}
      animate={{ width: Math.min(label.length * 8.5 + 70, 400) }}
      transition={{ duration: m3Durations.short4, ease: m3Easings.standard }}
      className={clsx(
        "flex items-center gap-2 h-10 px-4 rounded-full",
        "bg-surface-container-high transition-colors ease-standard",
      )}
    >
      <img src={icon} alt="" className="size-5 opacity-60 flex-shrink-0" />
      <span className="text-label-large text-on-surface whitespace-nowrap">{label}</span>
    </motion.div>
  );
}
