import { Skeleton } from "@rosegriffon/ui";

export default function HomeLoading() {
  return (
    <div className="min-h-screen space-y-6 px-4 py-4 min-[600px]:space-y-8 min-[600px]:px-6">
      <Skeleton className="h-12 w-full rounded-2xl min-[600px]:hidden" />
      {[1, 2].map(index => (
        <section key={index} className="space-y-4 rounded-3xl border p-4 min-[600px]:p-6">
          <div className="flex items-center gap-3">
            <Skeleton className="size-11 rounded-xl" />
            <Skeleton className="h-7 w-40" />
          </div>
          <div className="grid gap-3 min-[840px]:grid-cols-2">
            <Skeleton className="h-64 w-full rounded-2xl" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        </section>
      ))}
    </div>
  );
}
