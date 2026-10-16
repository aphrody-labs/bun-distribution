"use client";
import { useNotificationPermission, refreshNotificationPermission } from "../_context/notification-permission";

import { Badge, Button, Card, CardContent, CardHeader, Avatar, AvatarFallback, AvatarImage } from "@rosegriffon/ui";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useTheme } from "@/contexts/theme-context";
import { authClient } from "@/lib/auth-client";
import type { ClientSession } from "@/lib/auth-client";
import { Bell, BellOff, LogIn, LogOut, MessageSquare } from "@/lib/icons-config";
import { SITE_URL } from "@/lib/site-url";

const SITE_HOSTNAME = new URL(SITE_URL).hostname;

type SessionUser = ClientSession["user"];

interface TwitchChatProps {
  channelName?: string;
}

interface TwitchUserData {
  id: string;
  login: string;
  display_name: string;
  type: string;
  broadcaster_type: string;
  description: string;
  profile_image_url: string;
  offline_image_url: string;
  view_count: number;
  email?: string;
  created_at: string;
}

export function TwitchChat({ channelName = "rose_griffontv" }: TwitchChatProps) {
  const { colors } = useTheme();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [twitchUsername, setTwitchUsername] = useState<string | null>(null);
  const [twitchUserData, setTwitchUserData] = useState<TwitchUserData | null>(null);
  const permission = useNotificationPermission();
  const [notificationsPreference, setNotificationsEnabled] = useState<boolean | null>(null);
  const notificationsEnabled = notificationsPreference ?? permission === "granted";
  const [isSubscribed, setIsSubscribed] = useState(false);

  // Declared before the effects that reference it (TDZ fix for Turbopack prod build)
  const checkSubscriptionStatus = useCallback((userId: string) => {
    try {
      const subscribed = localStorage.getItem(`twitch_subscribed_${userId}`) === "true";
      setIsSubscribed(subscribed);
    } catch (error) {
      console.error("Error checking subscription:", error);
    }
  }, []);

  // Récupère la session Better Auth + résout les infos Twitch via l'account lié
  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const { data } = await authClient.getSession();
        const sessionUser = data?.user ?? null;
        if (cancelled) {
          return;
        }
        setUser(sessionUser);

        if (sessionUser) {
          // Better Auth expose name / image / email — on les utilise pour le UI minimal.
          // Pour les vraies infos Twitch (follows, sub) on appellera l'API Twitch côté serveur
          // Avec le token stocké dans `account` quand nécessaire.
          const username = (sessionUser.name as string | undefined) ?? sessionUser.email?.split("@")[0] ?? "user";
          setTwitchUsername(username);
          setTwitchUserData({
            broadcaster_type: "",
            created_at: sessionUser.createdAt ? new Date(sessionUser.createdAt).toISOString() : "",
            description: "",
            display_name: (sessionUser.name as string | undefined) ?? username,
            email: sessionUser.email ?? undefined,
            id: sessionUser.id,
            login: username,
            offline_image_url: "",
            profile_image_url: (sessionUser.image as string | undefined) ?? "",
            type: "",
            view_count: 0,
          });
          checkSubscriptionStatus(sessionUser.id);
        } else {
          setTwitchUsername(null);
          setTwitchUserData(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    refresh();
    // Re-poll au focus de l'onglet (Better Auth n'a pas de `onAuthStateChange` natif).
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [checkSubscriptionStatus]);

  const handleTwitchLogin = async () => {
    try {
      await authClient.signIn.social({
        callbackURL: "/rose-griffon-tv",
        provider: "twitch",
      });
    } catch (error) {
      console.error("Error logging in:", error);
      toast.error("❌ Erreur lors de la connexion Twitch");
    }
  };

  const handleLogout = async () => {
    try {
      await authClient.signOut();
      setUser(null);
      setTwitchUsername(null);
      setTwitchUserData(null);
      setIsSubscribed(false);
      setNotificationsEnabled(false);
      toast.success("✅ Déconnecté");
    } catch (error) {
      console.error("Error logging out:", error);
      toast.error("❌ Erreur lors de la déconnexion");
    }
  };

  const handleNotifications = async () => {
    if (!("Notification" in window)) {
      toast.error("❌ Les notifications ne sont pas supportées");
      return;
    }

    try {
      if (Notification.permission === "granted") {
        setNotificationsEnabled(false);
        toast.info("🔕 Notifications désactivées");
      } else {
        const permission = await Notification.requestPermission();
        refreshNotificationPermission();
        if (permission === "granted") {
          setNotificationsEnabled(true);

          // Send welcome notification
          new Notification("🎮 Rose Griffon TV", {
            badge: "/rgtv/rgtv.webp",
            body: `Bienvenue ${twitchUsername} ! Vous serez notifié des streams.`,
            icon: twitchUserData?.profile_image_url || "/rgtv/rgtv.webp",
          });

          toast.success("🔔 Notifications activées !");
        } else {
          toast.error("❌ Notifications refusées");
        }
      }
    } catch (error) {
      console.error("Error with notifications:", error);
      toast.error("❌ Erreur notifications");
    }
  };

  const handleSubscribe = async () => {
    if (!twitchUserData) {
      return;
    }

    try {
      // Simulate subscription (would need Twitch API in real implementation)
      const newSubscriptionState = !isSubscribed;
      setIsSubscribed(newSubscriptionState);

      // Store in localStorage
      localStorage.setItem(`twitch_subscribed_${twitchUserData.id}`, String(newSubscriptionState));

      if (newSubscriptionState) {
        toast.success(`✅ Abonné à ${channelName} !`);

        // Enable notifications automatically
        if (!notificationsEnabled && Notification.permission !== "denied") {
          handleNotifications();
        }
      } else {
        toast.info(`ℹ️ Désabonné de ${channelName}`);
      }
    } catch (error) {
      console.error("Error subscribing:", error);
      toast.error("❌ Erreur lors de l'abonnement");
    }
  };

  if (isLoading) {
    return (
      <Card className="border-2 h-[600px]" style={{ borderColor: `${colors.primary}40` }}>
        <CardContent className="p-6 flex items-center justify-center h-full">
          <div className="animate-spin rounded-full size-8 border-b-2" style={{ borderColor: colors.primary }} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 h-[600px] overflow-hidden" style={{ borderColor: `${colors.primary}40` }}>
      <CardHeader className="pb-3 border-b" style={{ borderColor: `${colors.primary}20` }}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-2">
            <MessageSquare className="size-5" style={{ color: colors.primary }} />
            Chat en direct
          </h3>

          {user ? (
            <div className="flex items-center gap-2">
              <Avatar className="size-8">
                <AvatarImage src={twitchUserData?.profile_image_url} />
                <AvatarFallback style={{ backgroundColor: `${colors.primary}40` }}>
                  {twitchUsername?.[0]?.toUpperCase() || "U"}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col">
                <span className="text-sm font-semibold leading-tight">{twitchUsername}</span>
                {twitchUserData?.broadcaster_type && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">
                    {twitchUserData.broadcaster_type}
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNotifications}
                className="h-8"
                title={notificationsEnabled ? "Désactiver notifications" : "Activer notifications"}
              >
                {notificationsEnabled ? <Bell className="size-4 text-green-500" /> : <BellOff className="size-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleLogout} className="h-8">
                <LogOut className="size-4" />
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={handleTwitchLogin} className="gap-2" style={{ backgroundColor: "#9146FF" }}>
              <LogIn className="size-4" />
              <span className="hidden sm:inline">Connexion Twitch</span>
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0 h-[calc(100%-4rem)]">
        {user ? (
          <AnimatePresence mode="wait">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full flex flex-col"
            >
              {/* Subscription banner */}
              {!isSubscribed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  className="p-3 bg-linear-to-r from-purple-500/20 to-pink-500/20 border-b"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs">💜 Abonne-toi pour être notifié des streams !</p>
                    <Button
                      size="sm"
                      onClick={handleSubscribe}
                      className="h-7 text-xs"
                      style={{ backgroundColor: "#9146FF" }}
                    >
                      S'abonner
                    </Button>
                  </div>
                </motion.div>
              )}

              {isSubscribed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  className="p-2 bg-green-500/10 border-b border-green-500/30"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-green-600 font-semibold flex items-center gap-1">
                      ✅ Abonné à {channelName}
                    </p>
                    <Button size="sm" variant="ghost" onClick={handleSubscribe} className="h-6 text-xs">
                      Se désabonner
                    </Button>
                  </div>
                </motion.div>
              )}

              <iframe
                title="Discussion Twitch"
                src={`https://www.twitch.tv/embed/${channelName}/chat?parent=${typeof window !== "undefined" ? window.location.hostname : SITE_HOSTNAME}`}
                width="100%"
                height="100%"
                className="border-0 flex-1"
              />
            </motion.div>
          </AnimatePresence>
        ) : (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
            >
              <div className="mb-4 p-4 rounded-full" style={{ backgroundColor: `${colors.primary}20` }}>
                <MessageSquare className="size-12" style={{ color: colors.primary }} />
              </div>
              <h4 className="font-bold text-lg mb-2">Rejoignez le chat Twitch !</h4>
              <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                Connectez-vous avec votre compte Twitch pour participer aux discussions en direct avec la communauté.
              </p>
              <Button onClick={handleTwitchLogin} className="gap-2" style={{ backgroundColor: "#9146FF" }}>
                <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                </svg>
                Se connecter avec Twitch
              </Button>
              <p className="text-xs text-muted-foreground mt-4">Votre connexion est sécurisée via Supabase Auth</p>
            </motion.div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
