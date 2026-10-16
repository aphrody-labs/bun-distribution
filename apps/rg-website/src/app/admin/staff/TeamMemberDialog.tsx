"use client";

import {
  Button,
  Input,
  Label,
  ResponsiveDialog,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@rosegriffon/ui";
import { Upload, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { createTeamMember, updateTeamMember, uploadTeamMemberImage } from "./actions";
import type { TeamMember } from "./actions";
import {
  messagesParChamp,
  schemaMembre,
  TYPES_IMAGE_ACCEPTES,
  validerFichierImage,
} from "./staff-schema";
import { EQUIPES } from "./teams";

interface TeamMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member?: TeamMember;
  onSuccess: () => void;
}

interface Formulaire {
  discord_user_id: string;
  display_index: string;
  image_url: string;
  is_active: boolean;
  member_link: string;
  name: string;
  role: string;
  team_id: string;
}

function formulaireDepuis(membre?: TeamMember): Formulaire {
  return {
    discord_user_id: membre?.discord_user_id ?? "",
    display_index: membre?.display_index?.toString() ?? "",
    image_url: membre?.image_url ?? "",
    is_active: membre?.is_active ?? true,
    member_link: membre?.member_link ?? "",
    name: membre?.name ?? "",
    role: membre?.role ?? "",
    team_id: membre?.team_id ?? "",
  };
}

/** Onglet où se trouve chaque champ — sert à ramener l'utilisateur sur l'erreur. */
const ONGLET_PAR_CHAMP: Record<string, "general" | "details"> = {
  discord_user_id: "details",
  display_index: "details",
  image_url: "details",
  is_active: "general",
  member_link: "details",
  name: "general",
  role: "general",
  team_id: "general",
};

export function TeamMemberDialog({ open, onOpenChange, member, onSuccess }: TeamMemberDialogProps) {
  const [enregistrement, setEnregistrement] = useState(false);
  const [formulaire, setFormulaire] = useState<Formulaire>(() => formulaireDepuis(member));
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<string>(member?.image_url ?? "");
  const [onglet, setOnglet] = useState<"general" | "details">("general");

  // Réinitialise le formulaire à chaque ouverture ou changement de membre.
  const [formIdentity, setFormIdentity] = useState({ open, member });
  if (formIdentity.open !== open || formIdentity.member !== member) {
    setFormIdentity({ open, member });
    if (open) {
      setFormulaire(formulaireDepuis(member));
      setApercu(member?.image_url ?? "");
      setFichier(null);
      setErreurs({});
      setOnglet("general");
    }
  }

  // L'aperçu passait par un `FileReader` : une image de 4 Mo finissait en base64
  // dans l'état React (≈5,3 Mo de chaîne). Une URL d'objet coûte quelques
  // octets, et `next/image` la sert telle quelle (les `blob:` ne sont jamais
  // optimisées). Elle doit être révoquée pour ne pas fuir.
  useEffect(() => {
    if (!apercu.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(apercu);
  }, [apercu]);

  const modifier = <C extends keyof Formulaire>(champ: C, valeur: Formulaire[C]) => {
    setFormulaire((precedent) => ({ ...precedent, [champ]: valeur }));
    setErreurs((precedent) => {
      const reste = { ...precedent };
      delete reste[champ];
      return reste;
    });
  };

  const choisirFichier = (evenement: React.ChangeEvent<HTMLInputElement>) => {
    const choisi = evenement.target.files?.[0];
    if (!choisi) {
      return;
    }
    const controle = validerFichierImage(choisi);
    if (!controle.ok) {
      toast.error("Image refusée", { description: controle.message });
      evenement.target.value = "";
      return;
    }
    setFichier(choisi);
    setApercu(URL.createObjectURL(choisi));
  };

  const retirerImage = () => {
    setFichier(null);
    setApercu("");
    modifier("image_url", "");
  };

  const enregistrer = async (evenement: React.FormEvent) => {
    evenement.preventDefault();
    setErreurs({});

    // Validation locale AVANT tout envoi : inutile de téléverser une image
    // pour se faire refuser sur un champ obligatoire vide.
    const controle = schemaMembre.safeParse(formulaire);
    if (!controle.success) {
      const parChamp = messagesParChamp(controle.error);
      setErreurs(parChamp);
      const premierChamp = Object.keys(parChamp)[0];
      if (premierChamp && ONGLET_PAR_CHAMP[premierChamp]) {
        setOnglet(ONGLET_PAR_CHAMP[premierChamp]);
      }
      toast.error("Formulaire incomplet", {
        description: Object.values(parChamp)[0] ?? "Vérifiez les champs signalés.",
      });
      return;
    }

    setEnregistrement(true);
    try {
      let urlImage = formulaire.image_url;

      if (fichier) {
        const { url, error } = await uploadTeamMemberImage(fichier);
        if (error) {
          toast.error("Erreur lors de l'envoi de l'image", { description: error });
          return;
        }
        urlImage = url ?? "";
      }

      // Les champs vidés partent en chaîne vide, que le schéma serveur
      // convertit en NULL : envoyer `undefined` (comportement précédent) les
      // faisait disparaître de la charge utile, donc rien n'était jamais effacé.
      const donnees = {
        discord_user_id: formulaire.discord_user_id,
        display_index: formulaire.display_index,
        image_url: urlImage,
        is_active: formulaire.is_active,
        member_link: formulaire.member_link,
        name: formulaire.name,
        role: formulaire.role,
        team_id: formulaire.team_id,
      };

      const { error } = member
        ? await updateTeamMember(member.id, donnees)
        : await createTeamMember(donnees);

      if (error) {
        toast.error(member ? "Erreur lors de la mise à jour" : "Erreur lors de la création", {
          description: error,
        });
        return;
      }

      toast.success(
        member ? `${formulaire.name} a été mis à jour` : `${formulaire.name} a été créé`,
      );
      onSuccess();
      onOpenChange(false);
    } catch (erreur) {
      console.error("[staff] échec de l'enregistrement du formulaire :", erreur);
      toast.error("Une erreur est survenue");
    } finally {
      setEnregistrement(false);
    }
  };

  const messageErreur = (champ: keyof Formulaire) =>
    erreurs[champ] ? (
      <p id={`${champ}-erreur`} className="text-xs text-destructive">
        {erreurs[champ]}
      </p>
    ) : null;

  const proprietesChamp = (champ: keyof Formulaire) => ({
    "aria-describedby": erreurs[champ] ? `${champ}-erreur` : undefined,
    "aria-invalid": erreurs[champ] ? true : undefined,
  });

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={member ? "Modifier un membre d'équipe" : "Ajouter un membre d'équipe"}
      description="Renseignez les informations du membre. Les champs marqués d'un astérisque sont obligatoires."
    >
      <form onSubmit={enregistrer} className="p-1" noValidate>
        <Tabs value={onglet} onValueChange={(valeur) => setOnglet(valeur as "general" | "details")}>
          <TabsList className="mb-4 grid w-full grid-cols-2">
            <TabsTrigger value="general">Informations générales</TabsTrigger>
            <TabsTrigger value="details">Photo et détails</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="team_id">
                Équipe <span aria-hidden="true">*</span>
                <span className="sr-only">(obligatoire)</span>
              </Label>
              <Select
                value={formulaire.team_id}
                onValueChange={(valeur) => modifier("team_id", valeur)}
              >
                <SelectTrigger id="team_id" {...proprietesChamp("team_id")}>
                  <SelectValue placeholder="Sélectionnez une équipe" />
                </SelectTrigger>
                <SelectContent>
                  {EQUIPES.map((equipe) => (
                    <SelectItem key={equipe.id} value={equipe.id}>
                      {equipe.libelle}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {messageErreur("team_id")}
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">
                Nom <span aria-hidden="true">*</span>
                <span className="sr-only">(obligatoire)</span>
              </Label>
              <Input
                id="name"
                value={formulaire.name}
                onChange={(evenement) => modifier("name", evenement.target.value)}
                placeholder="Ex. : Jean Dupont"
                maxLength={80}
                {...proprietesChamp("name")}
              />
              {messageErreur("name")}
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">
                Rôle <span aria-hidden="true">*</span>
                <span className="sr-only">(obligatoire)</span>
              </Label>
              <Input
                id="role"
                value={formulaire.role}
                onChange={(evenement) => modifier("role", evenement.target.value)}
                placeholder="Ex. : Développeur, Dessinateur…"
                maxLength={80}
                {...proprietesChamp("role")}
              />
              {messageErreur("role")}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Switch
                id="is_active"
                checked={formulaire.is_active}
                onCheckedChange={(coche) => modifier("is_active", coche)}
              />
              <Label htmlFor="is_active">Membre actif (visible sur le site public)</Label>
            </div>
          </TabsContent>

          <TabsContent value="details" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="photo">Photo de profil</Label>
              <div className="flex flex-col items-start gap-4 xs:flex-row">
                {apercu ? (
                  <div className="relative size-24 shrink-0 overflow-hidden rounded-full border-2 border-outline-variant">
                    <Image
                      src={apercu}
                      alt="Aperçu de la photo du membre"
                      fill
                      sizes="96px"
                      className="object-cover"
                      unoptimized
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute right-1 top-1 size-5"
                      aria-label="Retirer la photo"
                      onClick={retirerImage}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex size-24 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-outline-variant">
                    <Upload className="size-6 text-on-surface-variant" aria-hidden="true" />
                  </div>
                )}
                <div className="w-full flex-1 space-y-2">
                  <Input
                    id="photo"
                    type="file"
                    accept={TYPES_IMAGE_ACCEPTES.join(",")}
                    onChange={choisirFichier}
                    className="text-sm"
                  />
                  <p className="text-xs text-on-surface-variant">
                    PNG, JPEG, WebP, AVIF ou GIF — 400 × 400 px recommandé, 4 Mo maximum.
                  </p>
                  {messageErreur("image_url")}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xs:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="display_index">Ordre d'affichage</Label>
                <Input
                  id="display_index"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={32767}
                  value={formulaire.display_index}
                  onChange={(evenement) => modifier("display_index", evenement.target.value)}
                  placeholder="1"
                  {...proprietesChamp("display_index")}
                />
                {messageErreur("display_index")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="discord_user_id">Identifiant Discord</Label>
                <Input
                  id="discord_user_id"
                  inputMode="numeric"
                  value={formulaire.discord_user_id}
                  onChange={(evenement) => modifier("discord_user_id", evenement.target.value)}
                  placeholder="123456789012345678"
                  {...proprietesChamp("discord_user_id")}
                />
                {messageErreur("discord_user_id")}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="member_link">Lien vers un profil (facultatif)</Label>
              <Input
                id="member_link"
                type="url"
                value={formulaire.member_link}
                onChange={(evenement) => modifier("member_link", evenement.target.value)}
                placeholder="https://…"
                {...proprietesChamp("member_link")}
              />
              {messageErreur("member_link")}
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-6 flex flex-col justify-end gap-2 xs:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={enregistrement}
          >
            Annuler
          </Button>
          <Button type="submit" disabled={enregistrement}>
            {enregistrement ? "Enregistrement…" : member ? "Mettre à jour" : "Créer"}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
