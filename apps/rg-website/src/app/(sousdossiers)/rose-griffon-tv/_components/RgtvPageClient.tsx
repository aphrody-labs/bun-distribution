"use client";

import {
	Button,
	Card,
	CardContent,
	CardFooter,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@rosegriffon/ui";
import { motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { RgtvScheduleClient } from "@/components/RgtvScheduleClient";

import { useTheme } from "@/contexts/theme-context";
import { Monitor, Radio, Users, Youtube } from "@/lib/icons-config";
import type { StreamSchedule } from "@rosegriffon/types";


import { TwitchProvider, useTwitch } from "../_context/twitch-context";
import type { TwitchChannel } from "../_context/twitch-context";
import { RgtvAppShell } from "./RgtvAppShell";
import { TwitchChat } from "./TwitchChat";
import { CommentsSection } from "@/components/shared/CommentsSection";
import { TwitchEnrichedInfo } from "./TwitchEnrichedInfo";
import { TwitchPlayer } from "./TwitchPlayer";

interface RgtvPageClientProps {
	scheduleByDay: Record<string, StreamSchedule[]>;
	scheduleError: unknown;
	isStreamer?: boolean;
}

const TWITCH_CHANNELS: { id: TwitchChannel; label: string; url: string }[] = [
	{ id: "rose_griffontv", label: "Rose Griffon TV", url: "https://twitch.tv/rose_griffontv" },
	{ id: "achillea_ie", label: "Achilléa", url: "https://twitch.tv/achillea_ie" },
];

export function RgtvPageClient(props: RgtvPageClientProps) {
	const [twitchChannel, setTwitchChannel] = useState<TwitchChannel>("rose_griffontv");
	return (
		<TwitchProvider channel={twitchChannel}>
			<RgtvPageInner {...props} twitchChannel={twitchChannel} setTwitchChannel={setTwitchChannel} />
		</TwitchProvider>
	);
}

function RgtvPageInner({
	scheduleByDay,
	scheduleError,
	isStreamer,
	twitchChannel,
	setTwitchChannel,
}: RgtvPageClientProps & {
	twitchChannel: TwitchChannel;
	setTwitchChannel: (c: TwitchChannel) => void;
}) {
	const { colors } = useTheme();
	const { data: twitchData } = useTwitch();
	const [activeTab, setActiveTab] = useState("stream");
	const currentChannel = TWITCH_CHANNELS.find((c) => c.id === twitchChannel) ?? TWITCH_CHANNELS[0];

	return (
		<RgtvAppShell
			isLive={twitchData?.isLive}
			viewerCount={twitchData?.streamInfo?.viewer_count}
			activeTab={activeTab}
			onTabChange={setActiveTab}
		>
			<div className="container mx-auto px-4 max-w-7xl">
				{/* Modern Tabs Navigation */}
				<Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
					<TabsList
						className={`grid w-full grid-cols-3 ${isStreamer ? "lg:grid-cols-4" : ""} mb-6`}
					>
						<TabsTrigger value="stream" className="flex items-center gap-2">
							<Radio className="size-4" />
							<span className="hidden sm:inline">Stream</span>
						</TabsTrigger>
						<TabsTrigger value="planning" className="flex items-center gap-2">
							<Monitor className="size-4" />
							<span className="hidden sm:inline">Planning</span>
						</TabsTrigger>
						<TabsTrigger value="community" className="flex items-center gap-2">
							<Users className="size-4" />
							<span className="hidden sm:inline">Communauté</span>
						</TabsTrigger>
					</TabsList>

					{/* Stream Tab */}
					<TabsContent value="stream" className="space-y-6">
						{/* Channel switcher (RGTV / Achilléa) */}
						<div
							className="inline-flex rounded-lg border-2 p-1 bg-card"
							style={{ borderColor: `${colors.primary}30` }}
						>
							{TWITCH_CHANNELS.map((c) => (
								<button
									key={c.id}
									type="button"
									onClick={() => setTwitchChannel(c.id)}
									className={`px-4 py-2 rounded-md text-sm font-semibold transition-all ${
										twitchChannel === c.id
											? "text-white shadow-md"
											: "text-muted-foreground hover:text-foreground"
									}`}
									style={twitchChannel === c.id ? { backgroundColor: colors.primary } : undefined}
									aria-pressed={twitchChannel === c.id}
								>
									<Radio className="inline-block size-4 mr-1.5 -mt-0.5" />
									{c.label}
								</button>
							))}
						</div>

						{/* Player Grid */}
						<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
							{/* Main Player - 2 cols */}
							<div className="lg:col-span-2">
								<motion.div
									initial={{ opacity: 0, y: 20 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ duration: 0.3 }}
								>
									<Card
										className="border-2 overflow-hidden"
										style={{ borderColor: `${colors.primary}40` }}
									>
										<CardContent className="p-0">
											<TwitchPlayer />
										</CardContent>
										{twitchData?.streamInfo && (
											<CardFooter className="flex flex-col items-start gap-3 p-4">
												<h2 className="font-bold text-lg line-clamp-2">
													{twitchData.streamInfo.title}
												</h2>
												<div className="flex items-center gap-4 text-sm">
													<div className="flex items-center gap-2">
														<Users className="size-4" style={{ color: colors.primary }} />
														<span>{twitchData.streamInfo.viewer_count} viewers</span>
													</div>
													{twitchData.streamInfo.game_name && (
														<div className="flex items-center gap-2">
															<Monitor className="size-4" style={{ color: colors.primary }} />
															<span>{twitchData.streamInfo.game_name}</span>
														</div>
													)}
												</div>
												<div className="flex gap-2 w-full">
													<Button asChild className="flex-1">
														<Link
															href={currentChannel?.url ?? "https://twitch.tv/rose_griffontv"}
															target="_blank"
															rel="noopener noreferrer"
														>
															<Monitor className="mr-2 size-4" />
															Ouvrir Twitch
														</Link>
													</Button>
													<Button asChild variant="outline" className="flex-1">
														<Link
															href="https://youtube.com/@rose-griffon"
															target="_blank"
															rel="noopener noreferrer"
														>
															<Youtube className="mr-2 size-4" />
															YouTube
														</Link>
													</Button>
												</div>
											</CardFooter>
										)}
									</Card>
								</motion.div>
							</div>

							{/* Chat Sidebar - 1 col */}
							<div className="lg:col-span-1">
								<motion.div
									initial={{ opacity: 0, x: 20 }}
									animate={{ opacity: 1, x: 0 }}
									transition={{ delay: 0.1, duration: 0.3 }}
								>
									<Tabs defaultValue="twitch" className="w-full">
										<TabsList className="grid grid-cols-2 mb-2">
											<TabsTrigger value="twitch">Tchat Twitch</TabsTrigger>
											<TabsTrigger value="site">Tchat Site</TabsTrigger>
										</TabsList>
										<TabsContent value="twitch">
											<TwitchChat channelName={twitchChannel} />
										</TabsContent>
										<TabsContent value="site">
											<CommentsSection targetId={twitchChannel} targetType="stream" className="h-[600px]" />
										</TabsContent>
									</Tabs>
								</motion.div>
							</div>
						</div>
					</TabsContent>

					{/* Planning Tab */}
					<TabsContent value="planning" className="space-y-6">
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.3 }}
						>
							<RgtvScheduleClient scheduleByDay={scheduleByDay} error={scheduleError} />
						</motion.div>
					</TabsContent>

					{/* Community Tab */}
					<TabsContent value="community" className="space-y-6">
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.3 }}
						>
							<TwitchEnrichedInfo />
						</motion.div>
					</TabsContent>
				</Tabs>

				{/* Streamer Grid Block */}
				<motion.section
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.2, duration: 0.3 }}
					className="mt-12 sm:mt-16 md:mt-20 relative overflow-hidden"
					aria-labelledby="streamers-heading-rgtv"
				>
					<div className="absolute inset-0 -z-10 bg-linear-to-br from-primary/5 via-transparent to-secondary/5 rounded-3xl blur-3xl" />

					<div className="space-y-6 sm:space-y-8">
						<div className="text-center space-y-3 sm:space-y-4">
							<div className="inline-block">
								<h2
									id="streamers-heading-rgtv"
									className="text-2xl sm:text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-linear-to-r from-[#345182] via-[#d63901] to-[#345182]"
								>
									Nos Streameurs
								</h2>
							</div>
							<p className="text-sm sm:text-base md:text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed">
								Découvrez les passionnés qui font vivre la communauté Rose Griffon en direct.
							</p>
						</div>

						<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3 md:gap-4">
							{[
								{ file: "bri.webp", name: "Bri" },
								{ file: "ethan.webp", name: "Éthan" },
								{ file: "huzby.webp", name: "Huzby" },
								{ file: "ishido.webp", name: "Ishido" },
								{ file: "mathuze.webp", name: "Mathuze" },
								{ file: "shozuma.webp", name: "Shozuma" },
							].map((streamer) => (
								<div key={streamer.name} className="group flex justify-center">
									<div className="relative w-full aspect-square flex items-center justify-center">
										<div className="absolute -inset-2 bg-linear-to-r from-[#345182] to-[#d63901] rounded-full opacity-0 group-hover:opacity-50 blur-2xl transition-all duration-300 group-hover:animate-pulse scale-75 group-hover:scale-100" />
										<div className="relative w-full h-full rounded-2xl overflow-hidden border-2 border-[#345182] shadow-lg group-hover:shadow-2xl group-hover:border-[#d63901] transition-all duration-300 transform group-hover:scale-110 group-hover:-translate-y-2">
											<Image
												src={`/rgtv/${streamer.file}`}
												alt={`${streamer.name} - Streamer RGTV`}
												className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
												fill
												sizes="(max-width: 360px) 120px, (max-width: 640px) 160px, (max-width: 768px) 192px, 224px"
											/>
											<div className="absolute inset-0 bg-linear-to-t from-[#345182]/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
											<div className="absolute inset-0 flex flex-col items-center justify-end pb-2 sm:pb-3 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
												<span className="text-white font-bold text-xs sm:text-sm tracking-wider drop-shadow-lg">
													{streamer.name}
												</span>
												<div className="flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full bg-[#d63901] text-white text-[10px] font-semibold">
													<span className="size-1 bg-white rounded-full animate-pulse" />
													Live
												</div>
											</div>
										</div>
									</div>
								</div>
							))}
						</div>
					</div>
				</motion.section>
			</div>
		</RgtvAppShell>
	);
}
