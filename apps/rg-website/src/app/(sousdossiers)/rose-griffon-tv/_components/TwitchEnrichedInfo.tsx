"use client";

import { Badge, Card, CardContent, Tabs, TabsContent, TabsList, TabsTrigger } from "@rosegriffon/ui";
import { motion } from "motion/react";
import { Calendar, Clock, Eye, Gamepad2, TrendingUp, Users } from "lucide-react";
import { useEffect, useState } from "react";
import Image from "next/image";

import { useTheme } from "@/contexts/theme-context";

import { useTwitch } from "../_context/twitch-context";

export function TwitchEnrichedInfo() {
  const { colors } = useTheme();
  const { data: twitchData, isLoading } = useTwitch();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (isLoading) {
    return (
      <Card className="h-full border-none shadow-none bg-transparent">
        <CardContent className="p-0 space-y-4">
          <div className="h-20 bg-slate-800/50 rounded-lg animate-pulse" />
          <div className="h-40 bg-slate-800/50 rounded-lg animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (!twitchData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-muted-foreground mb-2">Impossible de charger les données Twitch</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm underline"
            style={{ color: colors.primary }}
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  // Format duration (ISO 8601 duration to readable)
  const formatDuration = (duration: string) => {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) {
      return duration;
    }
    const hours = match[1] ? `${match[1]}h` : "";
    const minutes = match[2] ? `${match[2]}m` : "";
    return `${hours}${minutes}`.trim() || "< 1m";
  };

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const diff = now - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return "Aujourd'hui";
    }
    if (days === 1) {
      return "Hier";
    }
    if (days < 7) {
      return `Il y a ${days} jours`;
    }
    if (days < 30) {
      return `Il y a ${Math.floor(days / 7)} semaines`;
    }
    return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  };

  // Format views
  const formatViews = (count: number): string => {
    if (count >= 1_000_000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return `${count}`;
  };

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="border-2" style={{ borderColor: `${colors.primary}40` }}>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full" style={{ backgroundColor: `${colors.primary}20` }}>
                  <Users className="size-6" style={{ color: colors.primary }} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Abonnés</p>
                  <p className="text-2xl font-bold">{formatViews(twitchData.followers)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="border-2" style={{ borderColor: `${colors.primary}40` }}>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full" style={{ backgroundColor: `${colors.primary}20` }}>
                  <Eye className="size-6" style={{ color: colors.primary }} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Vues totales</p>
                  <p className="text-2xl font-bold">{formatViews(twitchData.channelInfo?.totalViews || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="border-2" style={{ borderColor: `${colors.primary}40` }}>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full" style={{ backgroundColor: `${colors.primary}20` }}>
                  <TrendingUp className="size-6" style={{ color: colors.primary }} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Contenus</p>
                  <p className="text-2xl font-bold">
                    {(twitchData.recentVideos?.length || 0) + (twitchData.topClips?.length || 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Content Tabs */}
      <Tabs defaultValue="vods" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="vods">🎬 VODs ({twitchData.recentVideos?.length || 0})</TabsTrigger>
          <TabsTrigger value="clips">✂️ Clips ({twitchData.topClips?.length || 0})</TabsTrigger>
        </TabsList>

        {/* VODs Tab */}
        <TabsContent value="vods" className="space-y-4 mt-6">
          {twitchData.recentVideos && twitchData.recentVideos.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {twitchData.recentVideos.map((video, index) => (
                <motion.a
                  key={video.id}
                  href={video.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="group"
                >
                  <Card
                    className="overflow-hidden transition-all duration-300 hover:scale-105 border-2"
                    style={{ borderColor: `${colors.primary}40` }}
                  >
                    <div className="aspect-video relative overflow-hidden bg-black">
                      <Image
                        src={video.thumbnail_url.replace("%{width}", "480").replace("%{height}", "270")}
                        alt={video.title}
                        fill
                        className="object-cover group-hover:scale-110 transition-transform duration-300"
                      />
                      <div className="absolute bottom-2 right-2 px-2 py-1 rounded bg-black/80 text-white text-xs font-semibold flex items-center gap-1">
                        <Clock className="size-3" />
                        {formatDuration(video.duration)}
                      </div>
                      <div className="absolute top-2 left-2">
                        <Badge variant="secondary" className="bg-red-600 text-white">
                          VOD
                        </Badge>
                      </div>
                    </div>
                    <CardContent className="p-4">
                      <h4 className="font-semibold line-clamp-2 mb-2" style={{ color: colors.text }}>
                        {video.title}
                      </h4>
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Eye className="size-3" />
                          {formatViews(video.view_count)} vues
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="size-3" />
                          {formatDate(video.created_at)}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.a>
              ))}
            </div>
          ) : (
            <Card className="border-2 relative overflow-hidden" style={{ borderColor: `${colors.primary}20` }}>
              <div
                className="absolute inset-0 opacity-10 bg-cover bg-center"
                style={{
                  backgroundImage: "url(/rgtv/axel.webp)",
                  filter: "blur(2px)",
                }}
              />
              <CardContent className="p-12 text-center relative z-10">
                <Gamepad2 className="size-12 mx-auto mb-4 opacity-50" style={{ color: colors.primary }} />
                <h3 className="font-bold text-lg mb-2">Aucun VOD disponible</h3>
                <p className="text-muted-foreground">Les derniers streams apparaîtront ici</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Clips Tab */}
        <TabsContent value="clips" className="space-y-4 mt-6">
          {twitchData.topClips && twitchData.topClips.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {twitchData.topClips.map((clip, index) => (
                <motion.a
                  key={clip.id}
                  href={clip.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="group"
                >
                  <Card
                    className="overflow-hidden transition-all duration-300 hover:scale-105 border-2"
                    style={{ borderColor: `${colors.primary}40` }}
                  >
                    <div className="aspect-video relative overflow-hidden bg-black">
                      <Image
                        src={clip.thumbnail_url}
                        alt={clip.title}
                        fill
                        className="object-cover group-hover:scale-110 transition-transform duration-300"
                      />
                      <div className="absolute top-2 left-2">
                        <Badge variant="secondary" className="bg-purple-600 text-white">
                          CLIP
                        </Badge>
                      </div>
                      <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="text-white text-4xl">▶</div>
                      </div>
                    </div>
                    <CardContent className="p-4">
                      <h4 className="font-semibold line-clamp-2 mb-2" style={{ color: colors.text }}>
                        {clip.title}
                      </h4>
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Eye className="size-3" />
                          {formatViews(clip.view_count)} vues
                        </div>
                        <div className="flex items-center gap-1">
                          <Users className="size-3" />
                          {clip.creator_name}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                        <Calendar className="size-3" />
                        {formatDate(clip.created_at)}
                      </div>
                    </CardContent>
                  </Card>
                </motion.a>
              ))}
            </div>
          ) : (
            <Card className="border-2 relative overflow-hidden" style={{ borderColor: `${colors.primary}20` }}>
              <div
                className="absolute inset-0 opacity-10 bg-cover bg-center"
                style={{
                  backgroundImage: "url(/rgtv/jude.webp)",
                  filter: "blur(2px)",
                }}
              />
              <CardContent className="p-12 text-center relative z-10">
                <TrendingUp className="size-12 mx-auto mb-4 opacity-50" style={{ color: colors.primary }} />
                <h3 className="font-bold text-lg mb-2">Aucun clip cette semaine</h3>
                <p className="text-muted-foreground">Les meilleurs moments seront capturés ici</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
