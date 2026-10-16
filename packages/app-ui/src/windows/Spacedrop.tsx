import { motion } from "motion/react";
import { X, ShareNetwork, Users } from "@phosphor-icons/react";
import { useState } from "react";
import { CircleButton } from "@aphrody/m3-primitives";

interface Person {
  id: string;
  name: string;
  initials: string;
  status: "online" | "offline";
}

interface SpacedropProps {
  onClose?: () => void;
  people?: Person[];
}

const NO_PEOPLE: Person[] = [];

export function Spacedrop({ onClose, people = NO_PEOPLE }: SpacedropProps) {
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [starSpeed, setStarSpeed] = useState(1);

  // Generate star positions once per mount
  const [stars] = useState(() =>
    Array.from({ length: 50 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 1,
      duration: Math.random() * 3 + 2,
    })),
  );

  const handlePersonSelect = (id: string) => {
    setSelectedPerson(id);
    setStarSpeed(3);
    setTimeout(() => setStarSpeed(1), 2000);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-large border border-outline-variant bg-black">
      {/* Animated Stars Background */}
      <div className="absolute inset-0">
        {stars.map((star) => (
          <motion.div
            key={star.id}
            className="absolute rounded-full bg-white"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: star.size,
              height: star.size,
            }}
            animate={{
              opacity: [0.2, 1, 0.2],
              scale: [1, 1.2, 1],
            }}
            transition={{
              duration: star.duration / starSpeed,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>

      {/* Top Bar */}
      <div className="relative z-10 flex items-center justify-between border-b border-outline-variant/30 bg-surface/80 p-3 backdrop-blur-xl">
        <div className="flex gap-2">
          <CircleButton icon={X} onClick={onClose}>
            Close
          </CircleButton>
        </div>

        <div className="flex items-center gap-2">
          <CircleButton icon={Users}>
            {people.length} {people.length === 1 ? "Device" : "Devices"}
          </CircleButton>
          <CircleButton icon={ShareNetwork}>Share</CircleButton>
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-1 items-center justify-center p-8">
        {people.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            <div className="mb-4 flex justify-center">
              <div className="rounded-full bg-surface-container/40 p-6 backdrop-blur-lg">
                <Users className="size-12 text-sidebar-inkFaint" />
              </div>
            </div>
            <h2 className="mb-2 text-title-medium font-semibold text-on-surface">
              No devices found
            </h2>
            <p className="text-body-medium text-sidebar-inkFaint">
              Waiting for nearby devices...
            </p>
          </motion.div>
        ) : (
          <div className="grid max-w-4xl grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
            {people.map((person, index) => (
              <motion.button
                key={person.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  duration: 0.3,
                  delay: index * 0.08,
                  ease: [0.25, 1, 0.5, 1],
                }}
                onClick={() => handlePersonSelect(person.id)}
                className="group relative flex flex-col items-center gap-3 rounded-medium border border-outline-variant/30 bg-surface-container/40 p-4 backdrop-blur-lg transition-all hover:border-primary/50 hover:bg-surface-container/60"
              >
                {/* Selection Indicator */}
                {selectedPerson === person.id && (
                  <motion.div
                    layoutId="selection"
                    className="absolute inset-0 rounded-medium border-2 border-primary bg-primary/10"
                    transition={{
                      duration: 0.2,
                      ease: [0.25, 1, 0.5, 1],
                    }}
                  />
                )}

                {/* Avatar */}
                <div className="relative">
                  <div className="flex size-16 items-center justify-center rounded-full bg-primary/20 text-title-large font-bold text-primary">
                    {person.initials}
                  </div>

                  {/* Status Badge */}
                  <div className="absolute -bottom-1 -right-1">
                    {person.status === "online" ? (
                      <div className="relative">
                        <div className="size-4 rounded-full border-2 border-surface-container bg-success" />
                        <motion.div
                          animate={{
                            scale: [1, 1.4, 1],
                            opacity: [0.6, 0, 0.6],
                          }}
                          transition={{
                            duration: 2,
                            repeat: Infinity,
                          }}
                          className="absolute inset-0 rounded-full bg-success"
                        />
                      </div>
                    ) : (
                      <div className="size-4 rounded-full border-2 border-surface-container bg-sidebar-inkFaint" />
                    )}
                  </div>
                </div>

                {/* Name */}
                <div className="text-center">
                  <p className="text-label-large font-medium text-on-surface group-hover:text-primary">
                    {person.name}
                  </p>
                  <p className="text-body-small text-sidebar-inkFaint">
                    {person.status === "online" ? "Online" : "Offline"}
                  </p>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
