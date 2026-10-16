import Image from "next/image";

interface RGIconProps {
	width?: number;
	height?: number;
}

// Exporter l'image et la renommer RGicon
export default function RGIcon({ width, height }: RGIconProps) {
	return (
		<div className="flex items-center justify-center">
			<Image
				src="/RG_Logo_V2.5.webp"
				alt="Logo Rose Griffon"
				width={width ?? 24}
				height={height ?? 24}
			/>
		</div>
	);
}
