"use client";
import {
  useNotificationPermission,
  refreshNotificationPermission,
} from "../_context/notification-permission";

import { Button } from "@rosegriffon/ui";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useTheme } from "@/contexts/theme-context";
import { Bell, CalendarDays, Menu, Radio, Share2, Users } from "@/lib/icons-config";

interface RgtvAppShellProps {
  children: React.ReactNode;
  isLive?: boolean;
  viewerCount?: number;
  onTabChange?: (tab: string) => void;
  activeTab?: string;
}

export function RgtvAppShell({
  children,
  isLive = false,
  viewerCount = 0,
  onTabChange,
  activeTab = "stream",
}: RgtvAppShellProps) {
  const { colors } = useTheme();
  const [showMenu, setShowMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const notificationPermission = useNotificationPermission();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) {
      toast.error("Les notifications ne sont pas supportées par votre navigateur");
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      refreshNotificationPermission();

      if (permission === "granted") {
        toast.success("✅ Notifications activées !");
        // Send test notification
        new Notification("Rose Griffon TV", {
          badge: "/rgtv/rgtv.webp",
          body: "Vous serez prévenu des prochains streams !",
          icon: "/rgtv/rgtv.webp",
        });
      } else if (permission === "denied") {
        toast.error("❌ Notifications refusées. Activez-les dans les paramètres du navigateur.");
      }
    } catch (error) {
      console.error("Erreur notification:", error);
      toast.error("Erreur lors de la demande de notifications");
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          text: "Rejoins le stream 100% Inazuma Eleven !",
          title: "Rose Griffon TV",
          url: window.location.href,
        });
        toast.success("✅ Partagé avec succès !");
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          toast.error("Erreur lors du partage");
        }
      }
    } else {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(window.location.href);
        toast.success("📋 Lien copié dans le presse-papiers !");
      } catch {
        toast.error("Impossible de copier le lien");
      }
    }
  };

  const handleTabClick = (tab: string) => {
    if (onTabChange) {
      onTabChange(tab);
    }
    setShowMenu(false);
  };

  return (
    <div className="min-h-screen bg-background relative">
      {/* Background decoration */}
      <div
        className="fixed inset-0 opacity-5 bg-cover bg-center pointer-events-none"
        style={{
          backgroundImage: "url(/rgtv/jude.webp)",
          filter: "blur(4px)",
        }}
      />
      {/* App Header - Fixed */}
      <motion.header
        initial={false}
        animate={{
          backdropFilter: "blur(12px)",
          backgroundColor: isScrolled ? `${colors.background}F5` : `${colors.background}DD`,
        }}
        className="fixed top-0 left-0 right-0 z-50 border-b transition-colors"
        style={{
          borderColor: isScrolled ? `${colors.primary}30` : `${colors.primary}20`,
        }}
      >
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div
              className="relative size-10 rounded-full ring-2 ring-offset-2 overflow-hidden"
              style={{ "--tw-ring-color": "#d63901" } as React.CSSProperties}
            >
              <Image src="/rgtv/rgtv.webp" alt="RGTV" fill sizes="40px" className="object-cover" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-lg font-bold" style={{ color: "#345182" }}>
                Rose Griffon TV
              </h1>
              <p className="text-xs text-muted-foreground">100% Inazuma Eleven</p>
            </div>
          </div>

          {/* Live Indicator */}
          {isLive && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{
                backgroundColor: "#34518220",
                border: "1px solid #345182",
              }}
            >
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="size-2 rounded-full"
                style={{ backgroundColor: "#d63901" }}
              />
              <span className="text-xs font-bold uppercase" style={{ color: "#345182" }}>
                Live
              </span>
              {viewerCount > 0 && (
                <span className="text-xs text-muted-foreground">• {viewerCount}</span>
              )}
            </motion.div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={handleShare} className="hidden sm:flex">
              <Share2 className="size-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative"
            >
              <Bell className="size-5" />
              {notificationPermission === "default" && (
                <span className="absolute top-1 right-1 size-2 bg-[#d63901] rounded-full animate-pulse" />
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setShowMenu(!showMenu)}>
              <Menu className="size-5" />
            </Button>
          </div>
        </div>
      </motion.header>

      {/* Notification Panel */}
      <AnimatePresence>
        {showNotifications && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
              onClick={() => setShowNotifications(false)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ damping: 20, type: "spring" }}
              className="fixed top-16 right-0 w-80 h-[calc(100vh-4rem)] bg-background border-l shadow-2xl z-40 overflow-y-auto"
              style={{ borderColor: colors.primary }}
            >
              <div className="p-4">
                <h3 className="font-bold text-lg mb-4">Notifications</h3>
                <div className="space-y-3">
                  {notificationPermission === "default" && (
                    <div className="p-4 rounded-lg bg-primary/10 border border-primary/30">
                      <p className="text-sm font-semibold mb-3">🔔 Activez les notifications</p>
                      <p className="text-xs text-muted-foreground mb-3">
                        Soyez prévenu des prochains streams !
                      </p>
                      <Button onClick={requestNotificationPermission} className="w-full" size="sm">
                        Activer
                      </Button>
                    </div>
                  )}
                  {notificationPermission === "granted" && (
                    <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                      <p className="text-sm font-semibold text-green-600">
                        ✅ Notifications activées
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Vous serez prévenu des prochains streams
                      </p>
                    </div>
                  )}
                  {notificationPermission === "denied" && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                      <p className="text-sm font-semibold text-red-600">
                        ❌ Notifications bloquées
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Activez-les dans les paramètres du navigateur
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Menu Panel */}
      <AnimatePresence>
        {showMenu && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setShowMenu(false)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ damping: 20, type: "spring" }}
              className="fixed top-0 right-0 w-80 h-full bg-background shadow-2xl z-50"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-xl">Menu</h3>
                  <Button variant="ghost" size="icon" onClick={() => setShowMenu(false)}>
                    <Menu className="size-5" />
                  </Button>
                </div>
                <nav className="space-y-2">
                  <Button
                    variant={activeTab === "stream" ? "default" : "ghost"}
                    className="w-full justify-start"
                    onClick={() => handleTabClick("stream")}
                  >
                    <Radio className="mr-2 size-4" />
                    Stream en direct
                  </Button>
                  <Button
                    variant={activeTab === "planning" ? "default" : "ghost"}
                    className="w-full justify-start"
                    onClick={() => handleTabClick("planning")}
                  >
                    <CalendarDays className="mr-2 size-4" />
                    Planning
                  </Button>
                  <Button
                    variant={activeTab === "community" ? "default" : "ghost"}
                    className="w-full justify-start"
                    onClick={() => handleTabClick("community")}
                  >
                    <Users className="mr-2 size-4" />
                    Communauté
                  </Button>
                  <div className="h-px bg-border my-4" />
                  <Button variant="ghost" className="w-full justify-start" onClick={handleShare}>
                    <Share2 className="mr-2 size-4" />
                    Partager
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={requestNotificationPermission}
                  >
                    <Bell className="mr-2 size-4" />
                    Notifications
                  </Button>
                </nav>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="pt-16 pb-20 md:pb-4">{children}</div>
    </div>
  );
}
