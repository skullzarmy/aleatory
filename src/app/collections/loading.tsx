import { SkeletonGrid, LoadingLabel } from "@/components/Skeleton";

export default function Loading() {
    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <LoadingLabel what="collections" />
            <div className="pending-shimmer mb-6 h-7 w-40 rounded" aria-hidden />
            <SkeletonGrid count={6} />
        </div>
    );
}
