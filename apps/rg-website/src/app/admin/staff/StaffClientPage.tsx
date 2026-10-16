"use client";

import {
  AdminPageHeader,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  DashboardStatsCard as StatsCard,
} from "@rosegriffon/ui";
import {
  ArrowDownAZ,
  ArrowUp01,
  Check,
  Edit,
  EyeOff,
  LayoutGrid,
  List,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users as UsersIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmationDialog } from "@/components/admin/confirmation-dialog";
import { AdminDataGrid } from "@/components/admin/shared/AdminDataGrid";

import { deleteTeamMember, setTeamMemberActive } from "./actions";
import type { TeamMember } from "./actions";
import { AvatarMembre } from "./AvatarMembre";
import { comparerMembres, comparerMembresParNom, SOURCE_DISCORD } from "./staff-schema";
import { StaffMemberCard } from "./StaffMemberCard";
import { EQUIPES, libelleEquipe, NOMBRE_EQUIPES, rangEquipe } from "./teams";
import { TeamMemberDialog } from "./TeamMemberDialog";

interface StaffClientPageProps {
  initialMembers: TeamMember[];
}

type ModeAffichage = "grille" | "liste";
type ModeTri = "ordre" | "nom";

/** Une section de la page : un groupe de membres et son titre. */
interface Section {
  cle: string;
  titre: string;
  membres: TeamMember[];
  /** Les membres inactifs se valident/réactivent au lieu de se désactiver. */
  inactifs: boolean;
}

interface OptionsColonnes {
  section: Section;
  enCours: boolean;
  onBasculer: (membre: TeamMember, actif: boolean) => void;
  onEditer: (membre: TeamMember) => void;
  onSupprimer: (membre: TeamMember) => void;
}

/**
 * Colonnes du tableau (vue liste).
 *
 * Défini hors du composant : trois jeux de colonnes quasi identiques étaient
 * recopiés dans le rendu (imports Discord, équipes, désactivés), chacun avec ses
 * propres oublis — l'un n'avait ni `title` ni `aria-label` sur ses boutons
 * d'action, un autre n'affichait pas l'équipe.
 */
function construireColonnes({
  section,
  enCours,
  onBasculer,
  onEditer,
  onSupprimer,
}: OptionsColonnes) {
  return [
    {
      cell: (membre: TeamMember) => (
        <AvatarMembre
          src={membre.image_url}
          alt={`Photo de ${membre.name}`}
          taille={40}
          attenue={section.inactifs}
        />
      ),
      className: "w-[60px]",
      header: "Photo",
    },
    {
      cell: (membre: TeamMember) => (
        <span className="font-medium wrap-break-word">{membre.name}</span>
      ),
      header: "Nom",
    },
    {
      cell: (membre: TeamMember) => membre.role,
      header: "Rôle",
    },
    {
      cell: (membre: TeamMember) => libelleEquipe(membre.team_id),
      className: "hidden sm:table-cell",
      header: "Équipe",
    },
    {
      cell: (membre: TeamMember) =>
        membre.discord_user_id ? (
          <a
            href={`https://discord.com/users/${membre.discord_user_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-discord hover:underline"
          >
            {membre.discord_user_id}
            <span className="sr-only"> — ouvrir le profil Discord</span>
          </a>
        ) : (
          <span className="text-xs text-on-surface-variant">—</span>
        ),
      className: "hidden md:table-cell",
      header: "Discord",
    },
    {
      cell: (membre: TeamMember) => (
        <span className="tabular-nums">{membre.display_index ?? "—"}</span>
      ),
      className: "hidden lg:table-cell w-[80px]",
      header: "Ordre",
    },
    {
      cell: (membre: TeamMember) => (
        <div className="flex flex-wrap justify-end gap-1">
          {section.inactifs ? (
            <Button
              variant="outline"
              size="sm"
              disabled={enCours}
              onClick={() => onBasculer(membre, true)}
            >
              {membre.source === SOURCE_DISCORD ? (
                <Check className="mr-1 size-4" aria-hidden="true" />
              ) : (
                <RotateCcw className="mr-1 size-4" aria-hidden="true" />
              )}
              {membre.source === SOURCE_DISCORD ? "Valider" : "Réactiver"}
              <span className="sr-only"> {membre.name}</span>
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Désactiver ${membre.name}`}
              title={`Désactiver ${membre.name}`}
              disabled={enCours}
              onClick={() => onBasculer(membre, false)}
            >
              <EyeOff className="size-4 text-alerte" aria-hidden="true" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Modifier ${membre.name}`}
            title={`Modifier ${membre.name}`}
            disabled={enCours}
            onClick={() => onEditer(membre)}
          >
            <Edit className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Supprimer ${membre.name}`}
            title={`Supprimer ${membre.name}`}
            disabled={enCours}
            onClick={() => onSupprimer(membre)}
          >
            <Trash2 className="size-4 text-destructive" aria-hidden="true" />
          </Button>
        </div>
      ),
      className: "text-right w-[160px]",
      header: "Actions",
    },
  ];
}

export function StaffClientPage({ initialMembers }: StaffClientPageProps) {
  const router = useRouter();
  const [membres, setMembres] = useState<TeamMember[]>(initialMembers);
  const [dialogueOuvert, setDialogueOuvert] = useState(false);
  const [membreSelectionne, setMembreSelectionne] = useState<TeamMember | undefined>();
  const [recherche, setRecherche] = useState("");
  const [equipeFiltre, setEquipeFiltre] = useState<string>("toutes");
  const [modeAffichage, setModeAffichage] = useState<ModeAffichage>("grille");
  const [modeTri, setModeTri] = useState<ModeTri>("ordre");
  const [enCours, demarrerTransition] = useTransition();
  const [confirmationSuppression, setConfirmationSuppression] = useState<{
    open: boolean;
    membre?: TeamMember;
  }>({ open: false });

  const [previousInitial, setPreviousInitial] = useState(initialMembers);
  if (previousInitial !== initialMembers) {
    setPreviousInitial(initialMembers);
    setMembres(initialMembers);
  }

  const ouvrirCreation = () => {
    setMembreSelectionne(undefined);
    setDialogueOuvert(true);
  };

  const ouvrirEdition = (membre: TeamMember) => {
    setMembreSelectionne(membre);
    setDialogueOuvert(true);
  };

  const demanderSuppression = (membre: TeamMember) => {
    setConfirmationSuppression({ membre, open: true });
  };

  const supprimer = async () => {
    const membre = confirmationSuppression.membre;
    if (!membre) {
      return;
    }

    const { error } = await deleteTeamMember(membre.id);
    if (error) {
      toast.error("Erreur lors de la suppression", { description: error });
      return;
    }

    toast.success(`${membre.name} a été supprimé`);
    setMembres((precedents) => precedents.filter((m) => m.id !== membre.id));
    setConfirmationSuppression({ open: false });
    demarrerTransition(() => router.refresh());
  };

  const basculerActivation = (membre: TeamMember, actif: boolean) => {
    demarrerTransition(async () => {
      const { error } = await setTeamMemberActive(membre.id, actif);
      if (error) {
        toast.error(actif ? "Erreur lors de la réactivation" : "Erreur lors de la désactivation", {
          description: error,
        });
        return;
      }
      toast.success(actif ? `${membre.name} est de nouveau visible` : `${membre.name} est masqué`);
      setMembres((precedents) =>
        precedents.map((m) => (m.id === membre.id ? { ...m, is_active: actif } : m)),
      );
      router.refresh();
    });
  };

  const apresEnregistrement = () => {
    demarrerTransition(() => router.refresh());
  };

  const reinitialiserFiltres = () => {
    setRecherche("");
    setEquipeFiltre("toutes");
  };

  // ── Statistiques : calculées sur l'ensemble, jamais sur le filtre ────────
  const inactifs = useMemo(() => membres.filter((m) => m.is_active === false), [membres]);
  const actifs = useMemo(() => membres.filter((m) => m.is_active !== false), [membres]);
  const nombreEnAttente = inactifs.filter((m) => m.source === SOURCE_DISCORD).length;
  const nombreDesactives = inactifs.length - nombreEnAttente;
  const equipesPeuplees = new Set(actifs.map((m) => m.team_id)).size;

  // ── Filtrage : la recherche porte AUSSI sur les membres inactifs ─────────
  const sections = useMemo<Section[]>(() => {
    const requete = recherche.toLowerCase().trim();
    const correspond = (membre: TeamMember) => {
      const parRecherche =
        !requete ||
        membre.name.toLowerCase().includes(requete) ||
        membre.role.toLowerCase().includes(requete) ||
        (membre.discord_user_id ?? "").toLowerCase().includes(requete);
      const parEquipe = equipeFiltre === "toutes" || membre.team_id === equipeFiltre;
      return parRecherche && parEquipe;
    };

    const comparateur = modeTri === "nom" ? comparerMembresParNom : comparerMembres;
    const trier = (liste: TeamMember[]) => liste.toSorted(comparateur);

    const retenus = membres.filter(correspond);
    const enAttente = retenus.filter((m) => m.is_active === false && m.source === SOURCE_DISCORD);
    const desactives = retenus.filter((m) => m.is_active === false && m.source !== SOURCE_DISCORD);

    const parEquipe = new Map<string, TeamMember[]>();
    for (const membre of retenus) {
      if (membre.is_active === false) {
        continue;
      }
      const groupe = parEquipe.get(membre.team_id);
      if (groupe) {
        groupe.push(membre);
      } else {
        parEquipe.set(membre.team_id, [membre]);
      }
    }

    const resultat: Section[] = [];
    if (enAttente.length > 0) {
      resultat.push({
        cle: "en-attente",
        inactifs: true,
        membres: trier(enAttente),
        titre: `Imports Discord à valider (${enAttente.length})`,
      });
    }
    for (const [idEquipe, liste] of [...parEquipe.entries()].toSorted(
      (a, b) => rangEquipe(a[0]) - rangEquipe(b[0]),
    )) {
      resultat.push({
        cle: idEquipe,
        inactifs: false,
        membres: trier(liste),
        titre: `${libelleEquipe(idEquipe)} (${liste.length})`,
      });
    }
    if (desactives.length > 0) {
      resultat.push({
        cle: "desactives",
        inactifs: true,
        membres: trier(desactives),
        titre: `Désactivés (${desactives.length})`,
      });
    }
    return resultat;
  }, [membres, recherche, equipeFiltre, modeTri]);

  const nombreAffiche = sections.reduce((total, section) => total + section.membres.length, 0);
  const filtreActif = recherche.trim() !== "" || equipeFiltre !== "toutes";

  const colonnes = (section: Section) =>
    construireColonnes({
      enCours,
      onBasculer: basculerActivation,
      onEditer: ouvrirEdition,
      onSupprimer: demanderSuppression,
      section,
    });

  return (
    <div className="space-y-8">
      <AdminPageHeader
        icon={<UsersIcon className="size-5" aria-hidden="true" />}
        title="Gestion du staff"
        description="Gérez les membres de toutes les équipes Rose Griffon"
        actions={
          <Button onClick={ouvrirCreation}>
            <Plus className="mr-2 size-4" aria-hidden="true" />
            Ajouter un membre
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Actifs" value={actifs.length} icon={UsersIcon} accent="emerald" />
        <StatsCard title="À valider" value={nombreEnAttente} icon={Check} accent="amber" />
        <StatsCard title="Désactivés" value={nombreDesactives} icon={EyeOff} accent="rose" />
        <StatsCard
          title="Équipes"
          value={`${equipesPeuplees} / ${NOMBRE_EQUIPES}`}
          icon={LayoutGrid}
          accent="sky"
        />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="absolute left-2.5 top-2.5 size-4 text-on-surface-variant"
            aria-hidden="true"
          />
          <label htmlFor="recherche-staff" className="sr-only">
            Rechercher un membre par nom, rôle ou identifiant Discord
          </label>
          <Input
            id="recherche-staff"
            type="search"
            placeholder="Nom, rôle, ID Discord…"
            className="pl-9"
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
          />
        </div>
        <Select value={equipeFiltre} onValueChange={setEquipeFiltre}>
          <SelectTrigger className="w-full sm:w-[250px]" aria-label="Filtrer par équipe">
            <SelectValue placeholder="Toutes les équipes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="toutes">Toutes les équipes</SelectItem>
            {EQUIPES.map((equipe) => (
              <SelectItem key={equipe.id} value={equipe.id}>
                {equipe.libelle}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <fieldset
          className="m-0 min-w-0 border-0 p-0 flex items-center overflow-hidden rounded-md border border-outline-variant bg-background"

          aria-label="Options d'affichage"
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              modeTri === "ordre" ? "Trier par ordre alphabétique" : "Trier par ordre d'affichage"
            }
            title={
              modeTri === "ordre" ? "Trier par ordre alphabétique" : "Trier par ordre d'affichage"
            }
            className="size-10 rounded-none"
            onClick={() => setModeTri((mode) => (mode === "ordre" ? "nom" : "ordre"))}
          >
            {modeTri === "ordre" ? (
              <ArrowUp01 className="size-4" aria-hidden="true" />
            ) : (
              <ArrowDownAZ className="size-4" aria-hidden="true" />
            )}
          </Button>
          <div className="h-6 w-px bg-outline-variant" />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Affichage en liste"
            aria-pressed={modeAffichage === "liste"}
            title="Affichage en liste"
            className={
              modeAffichage === "liste"
                ? "size-10 rounded-none bg-surface-container-high"
                : "size-10 rounded-none"
            }
            onClick={() => setModeAffichage("liste")}
          >
            <List className="size-4" aria-hidden="true" />
          </Button>
          <div className="h-6 w-px bg-outline-variant" />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Affichage en grille"
            aria-pressed={modeAffichage === "grille"}
            title="Affichage en grille"
            className={
              modeAffichage === "grille"
                ? "size-10 rounded-none bg-surface-container-high"
                : "size-10 rounded-none"
            }
            onClick={() => setModeAffichage("grille")}
          >
            <LayoutGrid className="size-4" aria-hidden="true" />
          </Button>
        </fieldset>
      </div>

      {/* Deux vides distincts : une base sans membre n'est pas une recherche
			    sans résultat. L'ancienne page proposait « Ajouter le premier
			    membre » alors que la base en comptait 129. */}
      {nombreAffiche === 0 ? (
        <Card>
          <CardContent className="py-12">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersIcon className="size-6" aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>
                  {filtreActif ? "Aucun membre ne correspond" : "Aucun membre pour le moment"}
                </EmptyTitle>
                <EmptyDescription>
                  {filtreActif
                    ? "Aucun membre ne correspond à cette recherche ou à cette équipe."
                    : "Ajoutez un premier membre pour qu'il apparaisse sur le site public."}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {filtreActif ? (
                  <Button variant="outline" onClick={reinitialiserFiltres}>
                    <RotateCcw className="mr-2 size-4" aria-hidden="true" />
                    Réinitialiser les filtres
                  </Button>
                ) : (
                  <Button onClick={ouvrirCreation}>
                    <Plus className="mr-2 size-4" aria-hidden="true" />
                    Ajouter le premier membre
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {filtreActif && (
            <p className="text-sm text-on-surface-variant" aria-live="polite">
              {nombreAffiche} membre{nombreAffiche > 1 ? "s" : ""} affiché
              {nombreAffiche > 1 ? "s" : ""} sur {membres.length}.
            </p>
          )}

          {sections.map((section) =>
            modeAffichage === "liste" ? (
              <AdminDataGrid
                key={section.cle}
                title={section.titre}
                data={section.membres}
                columns={colonnes(section)}
              />
            ) : (
              <Card key={section.cle} className="border-none bg-transparent shadow-none">
                <CardHeader className="px-0 pt-0">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                    {section.titre}
                    {section.inactifs && (
                      <Badge variant="outline" className="border-alerte/40 text-alerte">
                        Non visibles sur le site
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-0">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {section.membres.map((membre) => (
                      <StaffMemberCard
                        key={membre.id}
                        member={membre}
                        teamLabel={libelleEquipe(membre.team_id)}
                        onEdit={ouvrirEdition}
                        onDelete={demanderSuppression}
                        onToggleActive={basculerActivation}
                        disabled={enCours}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ),
          )}
        </div>
      )}

      <TeamMemberDialog
        open={dialogueOuvert}
        onOpenChange={setDialogueOuvert}
        member={membreSelectionne}
        onSuccess={apresEnregistrement}
      />

      <ConfirmationDialog
        open={confirmationSuppression.open}
        onCancel={() => setConfirmationSuppression({ open: false })}
        title="Supprimer un membre"
        message={`Êtes-vous sûr de vouloir supprimer ${confirmationSuppression.membre?.name ?? "ce membre"} ? Cette action est définitive.`}
        confirmText="Supprimer"
        danger
        onConfirm={supprimer}
      />
    </div>
  );
}
