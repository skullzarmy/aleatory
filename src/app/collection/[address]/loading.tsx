import { SkeletonGrid, LoadingLabel } from "@/components/Skeleton";

export default function Loading() {
    return (
        <div className="mx-auto max-w-6xl px-4 py-8">
            <LoadingLabel what="this collection" />
            <div className="pending-shimmer mb-2 h-7 w-56 rounded" aria-hidden />
            <div className="pending-shimmer mb-8 h-4 w-40 rounded" aria-hidden />
            <SkeletonGrid count={4} />
        </div>
    );
}
