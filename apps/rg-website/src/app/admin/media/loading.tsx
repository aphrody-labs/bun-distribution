import { Skeleton } from "@rosegriffon/ui";

export default function MediaLoading() {
  return (
    <div className="p-6 space-y-6">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-48 w-full rounded-xl" /> {/* Upload area */}
      <div className="flex items-center space-x-2">
        <Skeleton className="h-10 w-full max-w-sm" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {[...Array(12)].map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-md" />
        ))}
      </div>
    </div>
  );
}
