import { KintoUnLoader } from "@/components/KintoUn";

export default function Loading() {
	return (
		<div className="container mx-auto px-4 py-32 flex flex-col items-center justify-center min-h-[60vh]">
			<KintoUnLoader size={56} />
			<p className="mt-8 font-scouter text-xs tracking-[0.5em] text-dbz-orange/90 ki-pulse">
				❯ CHARGEMENT ❮
			</p>
		</div>
	);
}
