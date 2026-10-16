import {
  ArrowsClockwise,
  ArrowDown,
  CheckCircle,
  Warning,
  PlugsConnected,
  Circle,
} from "@phosphor-icons/react";
import { clsx } from "clsx";
import type { SyncActivity } from "../types";
import { timeAgo } from "../utils";

interface ActivityFeedProps {
  activities: SyncActivity[];
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <Circle className="size-8 text-outline mb-2" weight="duotone" />
        <p className="text-body-medium text-on-surface-variant text-center">
          No recent activity
        </p>
        <p className="text-body-small text-outline text-center mt-1">
          Activity will appear here when syncing
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col p-2">
      {activities.map((activity, index) => (
        <ActivityItem
          // oxlint-disable-next-line react/no-array-index-key -- the activity log is append-only and entries carry no id, so the index separates repeated timestamps
          key={`${activity.timestamp}-${index}`}
          activity={activity}
        />
      ))}
    </div>
  );
}

function ActivityItem({ activity }: { activity: SyncActivity }) {
  const getIcon = () => {
    switch (activity.eventType) {
      case "broadcast":
        return <ArrowsClockwise className="size-4" weight="bold" />;
      case "received":
        return <ArrowDown className="size-4" weight="bold" />;
      case "applied":
        return <CheckCircle className="size-4" weight="bold" />;
      case "backfill":
        return <ArrowsClockwise className="size-4" weight="bold" />;
      case "connection":
        return <PlugsConnected className="size-4" weight="bold" />;
      case "error":
        return <Warning className="size-4" weight="bold" />;
      default:
        return <Circle className="size-4" weight="bold" />;
    }
  };

  const getIconColor = () => {
    switch (activity.eventType) {
      case "broadcast":
        return "text-primary";
      case "received":
        return "text-primary";
      case "applied":
        return "text-success";
      case "backfill":
        return "text-tertiary";
      case "connection":
        return "text-on-surface-variant";
      case "error":
        return "text-error";
      default:
        return "text-outline";
    }
  };

  return (
    <div className="flex items-start gap-3 py-2 px-2 hover:bg-on-surface/8 rounded-small transition-colors">
      <div className={clsx("mt-0.5", getIconColor())}>{getIcon()}</div>
      <div className="flex-1 min-w-0">
        <p className="text-body-medium text-on-surface truncate">
          {activity.description}
        </p>
        <p className="text-body-small text-outline">
          {timeAgo(activity.timestamp)}
        </p>
      </div>
    </div>
  );
}
