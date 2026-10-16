import { DashboardGrid, QuickActionCard } from "@rosegriffon/ui";
import {
  BarChart3,
  BookOpen,
  Calendar,
  Database,
  Image as ImageIcon,
  Settings,
  Shield,
  Trophy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface QuickAction {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accent: string;
}

const ACTIONS: QuickAction[] = [
  {
    accent: "text-amber-400",
    description: "Compétitions, tournois, litiges, clans, ELO",
    href: "/achillea/admins/dashboard",
    icon: Trophy,
    title: "Achilléa Esport",
  },
  {
    accent: "text-info",
    description: "Comptes, rôles, sanctions",
    href: "/admin/users",
    icon: Users,
    title: "Utilisateurs",
  },
  {
    accent: "text-secondary-foreground",
    description: "Articles, brouillons, séries",
    href: "/admin/chroniques",
    icon: BookOpen,
    title: "Chroniques",
  },
  {
    accent: "text-alerte",
    description: "Calendrier et planning streams",
    href: "/admin/events",
    icon: Calendar,
    title: "Événements",
  },
  {
    accent: "text-succes",
    description: "Membres équipe et rôles",
    href: "/admin/staff",
    icon: Shield,
    title: "Staff",
  },
  {
    accent: "text-rg-rose",
    description: "Upload, galeries, modération",
    href: "/admin/media",
    icon: ImageIcon,
    title: "Médias",
  },
  {
    accent: "text-succes",
    description: "Audience et contenu, domaine par domaine",
    href: "/admin/stats",
    icon: BarChart3,
    title: "Statistiques",
  },
  {
    accent: "text-info",
    description: "Services, schéma, sécurité, stockage",
    href: "/admin/base",
    icon: Database,
    title: "Infrastructure",
  },
  {
    accent: "text-muted-foreground",
    description: "Site, intégrations, secrets",
    href: "/admin/settings",
    icon: Settings,
    title: "Configuration",
  },
];

export function QuickActions() {
  return (
    <DashboardGrid title="Modules" className="lg:grid-cols-3">
      {ACTIONS.map(action => (
        <QuickActionCard key={action.href} {...action} />
      ))}
    </DashboardGrid>
  );
}
