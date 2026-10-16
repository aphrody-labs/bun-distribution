"use client";

import {
  BookOpen,
  BarChart3,
  Bot,
  Calendar,
  Database,
  Hash,
  Heart,
  Home,
  Image as ImageIcon,
  Settings,
  Shield,
  Trophy,
  Users,
} from "lucide-react";
import type { NavItem } from "@rosegriffon/ui";
import { AdminSidebar as SharedAdminSidebar } from "@rosegriffon/ui";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const adminNavItems: NavItem[] = [
  { exact: true, href: "/admin", icon: Home, title: "Tableau de bord" },
  { href: "/admin/users", icon: Users, title: "Utilisateurs" },
  {
    badge: "Articles",
    href: "/admin/chroniques",
    icon: BookOpen,
    submenu: [
      { title: "Chroniques du bouquet", href: "/admin/chroniques" },
      { title: "Éditeur d'articles Wiki", href: "/admin/news" },
      { title: "Nouvel article (Lexical)", href: "/admin/news/new" },
    ],
    title: "Articles & Chroniques",
  },
  {
    badge: "Wiki",
    href: "/admin/database",
    icon: Database,
    submenu: [
      { title: "Base de données Wiki", href: "/admin/database" },
      { title: "Vérification", href: "/admin/database/verification" },
      { title: "Images de jeu", href: "/admin/database/images" },
      { title: "Zukan Review", href: "/admin/zukan-review" },
      { title: "Import Google Sheet", href: "/admin/import-sheet" },
      { title: "Import Google Doc", href: "/admin/import-google-doc" },
    ],
    title: "Données Wiki",
  },
  { href: "/admin/tweets", icon: Hash, title: "Tweets" },
  { href: "/admin/audit", icon: Shield, title: "Journal d'audit" },
  { href: "/admin/staff", icon: Users, title: "Staff" },
  {
    href: "/admin/events",
    icon: Calendar,
    submenu: [
      { title: "Calendrier", href: "/admin/events" },
      { title: "Planning Streams", href: "/admin/stream-schedule" },
    ],
    title: "Événements",
  },
  {
    badge: "Esport",
    href: "/admin/achillea",
    icon: Trophy,
    submenu: [
      { title: "Comptes & données Achilléa", href: "/admin/achillea" },
      { title: "Backoffice Achilléa", href: "/achillea/admins/dashboard" },
      { title: "Litiges Ranked", href: "/achillea/admins/ranked-disputes" },
      { title: "Sanctions", href: "/achillea/admins/sanctions" },
      { title: "Validation Orgs", href: "/achillea/organizations/validate" },
    ],
    title: "Achilléa Esport",
  },
  { href: "/admin/media", icon: ImageIcon, title: "Médias" },
  { href: "/admin/iergday", icon: Hash, title: "Campagne hashtag" },
  {
    creatorOnly: true,
    href: "/admin/patreon",
    icon: Heart,
    title: "Patreon",
  },
  { href: "/admin/stats", icon: BarChart3, title: "Statistiques" },
  // Le bot Discord n'avait aucune surface web : ses réglages ne se voyaient
  // que depuis `/administration réglages`, dans Discord, et son état
  // d'exécution nulle part. Les quatre pages vivent sous `/admin/bot` sauf
  // l'ordonnanceur, qui a son propre chemin parce qu'il n'est pas le bot —
  // c'est `rg-cron.service`, un troisième service.
  {
    href: "/admin/bot",
    icon: Bot,
    submenu: [
      { title: "Vue d'ensemble", href: "/admin/bot" },
      { title: "Membres", href: "/admin/bot/membres" },
      { title: "Réglages", href: "/admin/bot/reglages" },
      { title: "Commandes", href: "/admin/bot/commandes" },
      { title: "Tâches planifiées", href: "/admin/cron" },
    ],
    title: "Bot Discord",
  },
  { href: "/admin/base", icon: Database, title: "Infrastructure" },
  { href: "/admin/settings", icon: Settings, title: "Configuration" },
];

export default function AdminSidebar({ showPatreon = false }: { showPatreon?: boolean }) {
  const pathname = usePathname();
  const wikiAdmin = [
    "/admin/database",
    "/admin/zukan-review",
    "/admin/import-sheet",
    "/admin/import-google-doc",
    "/admin/news",
    "/admin/tweets",
  ].some(route => pathname === route || pathname?.startsWith(`${route}/`));
  const achilleaAdmin = pathname === "/admin/achillea";
  return (
    <SharedAdminSidebar
      items={adminNavItems}
      title={achilleaAdmin ? "Admin Achilléa" : "Administration"}
      subtitle={achilleaAdmin ? "E-sport" : wikiAdmin ? "Azalée" : "Rose Griffon"}
      logo={
        wikiAdmin ? (
          <Image src="/logo.webp" alt="" width={28} height={28} />
        ) : achilleaAdmin ? (
          <Image src="/achillea/achillea_ico.png" alt="" width={28} height={28} />
        ) : undefined
      }
      showCreatorItems={showPatreon}
      // `/dashboard` n'est qu'une redirection vers `/profil/<pseudo>` : deux
      // chemins pour la même page. On pointe directement sur les paramètres du
      // compte, la seule destination distincte.
      footer={
        <Link
          href="/settings"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-lg text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        >
          <Home className="size-4" />
          <span>Mon compte</span>
        </Link>
      }
    />
  );
}
