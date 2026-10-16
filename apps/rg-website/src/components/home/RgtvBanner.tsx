import { Button, Card, CardContent } from "@rosegriffon/ui";
import Image from "next/image";

export interface RgtvBannerProps {
	title?: string;
	subtitle?: string;
	description?: string;
	image?: string;
	buttonText?: string;
	link?: string;
}

export function RgtvBanner({
	title = "RG TV",
	subtitle = "WebTV Rose Griffon",
	description = "Votre rendez-vous quotidien Inazuma Eleven ! Retrouvez nos streamers sur Twitch et YouTube pour des sessions de jeu, des tournois commentés et de la bonne humeur.",
	image = "/rgtv/affiche.webp",
	buttonText = "ACCÉDER À LA WEBTV",
	link = "/rose-griffon-tv",
}: RgtvBannerProps) {
	return (
		<div className="w-full">
			<Card className="overflow-hidden border-none shadow-xl bg-[#9bd771] relative group rounded-3xl p-0">
				{/* Background Pattern - Stripes matching the banner art style */}
				<div
					className="absolute inset-0 z-0 pointer-events-none opacity-10"
					style={{
						background: `repeating-linear-gradient(
              -45deg,
              #7ab850,
              #7ab850 20px,
              transparent 20px,
              transparent 40px
            )`,
					}}
				/>

				<div className="grid md:grid-cols-2 gap-0 relative z-20 md:min-h-[320px] lg:min-h-[360px]">
					{/* Left: Image */}
					<div className="relative h-52 sm:h-64 md:h-auto w-full overflow-hidden">
						<div className="absolute inset-0 bg-linear-to-t md:bg-linear-to-r from-[#9bd771] via-transparent to-transparent z-10" />
						<Image
							src={image}
							alt={title}
							fill
							className="object-cover object-top transition-transform duration-700 group-hover:scale-105"
							sizes="(max-width: 768px) 100vw, 50vw"
						/>
					</div>

					{/* Right: Text Content */}
					<CardContent className="px-6 pb-6 pt-0 sm:px-10 sm:pb-10 sm:pt-0 md:p-12 md:pt-0 flex flex-col justify-center gap-6 bg-transparent relative">
						<div className="flex flex-col gap-3">
							<div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#d63901] border-2 border-border text-white text-xs font-black uppercase tracking-wide shadow-lg transform -rotate-2">
								<Image
									src="/rgtv/rgtv.webp"
									alt="RGTV Logo"
									width={16}
									height={16}
									className="size-4"
								/>
								{subtitle}
							</div>
							<h2
								className="text-5xl md:text-6xl lg:text-7xl font-black text-white drop-shadow-sm leading-none"
								style={{
									fontFamily: '"Super Cartoon", system-ui',
									textShadow: "2px 2px 0px #000",
								}}
							>
								{title}
							</h2>
						</div>

						<p className="text-black/80 text-lg leading-relaxed max-w-md font-bold text-pretty">
							{description}
						</p>

						<div className="flex justify-start pt-2">
							<Button
								asChild
								size="lg"
								className="bg-[#d63901] hover:bg-[#b52f00] text-white font-black rounded-xl shadow-[4px_4px_0px_0px_#90310f] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#90310f] transition-all duration-200 border-2 border-[#90310f] w-full sm:w-auto px-8"
							>
								<a href={link}>
									<Image
										src="/rgtv/rgtv.webp"
										alt="RGTV Logo"
										width={20}
										height={20}
										className="mr-2 size-5"
									/>
									{buttonText}
								</a>
							</Button>
						</div>
					</CardContent>
				</div>
			</Card>
		</div>
	);
}
