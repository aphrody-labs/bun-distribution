import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { AnimatePresence, motion } from "motion/react";

interface TabContentProps {
  id: string;
  activeTab: string;
  children: React.ReactNode;
}

export function TabContent({ id, activeTab, children }: TabContentProps) {
  if (id !== activeTab) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={id}
        initial={{ opacity: 0, y: 10 }}
        animate={{
          opacity: 1,
          y: 0,
          transition: {
            duration: m3Durations.medium1,
            ease: m3Easings.emphasizedDecelerate,
          },
        }}
        exit={{
          opacity: 0,
          y: -10,
          transition: {
            duration: m3Durations.short3,
            ease: m3Easings.emphasizedAccelerate,
          },
        }}
        className="flex-1 overflow-auto"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
