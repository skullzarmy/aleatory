import { SkeletonPiece, LoadingLabel } from "@/components/Skeleton";

export default function Loading() {
    return (
        <div className="mx-auto max-w-6xl px-4 py-8">
            <LoadingLabel what="this piece" />
            <SkeletonPiece />
        </div>
    );
}
