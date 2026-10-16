import type { Metadata } from "next";
import Link from "next/link";

import { absoluteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/legal/confidentialite") },
  description:
    "Politique de confidentialité et protection des données personnelles de l'association Rose Griffon, conforme au RGPD et à la loi Informatique et Libertés.",
  title: "Politique de Confidentialité | Rose Griffon",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <h1 className="text-4xl font-bold mb-4 text-[#B03519]">Politique de Confidentialité</h1>
      <p className="text-sm text-muted-foreground mb-8">Dernière mise à jour : 17 août 2026</p>

      <div className="prose prose-lg dark:prose-invert max-w-none space-y-8">
        <section className="bg-muted/30 p-6 rounded-lg">
          <p className="font-semibold text-lg">Rose Griffon s'engage à protéger et respecter votre vie privée.</p>
          <p className="mt-2">
            Cette politique explique comment nous collectons, utilisons et protégeons vos données personnelles,
            conformément au Règlement Général sur la Protection des Données (RGPD - Règlement UE 2016/679) et à la loi
            Informatique et Libertés du 6 janvier 1978 modifiée.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">1. Responsable du Traitement</h2>
          <p>
            Le responsable du traitement des données est l'association Rose Griffon, association loi 1901 à but non
            lucratif.
          </p>
          <p className="mt-4">
            <strong>Contact :</strong> Pour toute question relative à la protection de vos données personnelles, vous
            pouvez nous contacter via :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Notre{" "}
              <Link href="/a-propos/contact" className="text-[#344E8C] hover:underline">
                formulaire de contact
              </Link>
            </li>
            <li>
              Notre serveur Discord officiel :{" "}
              <a
                href="https://discord.gg/8X8eQfBMkt"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#344E8C] hover:underline"
              >
                discord.gg/8X8eQfBMkt
              </a>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">2. Collecte des Données Personnelles</h2>
          <h3 className="text-xl font-semibold mb-3">2.1. Données Collectées</h3>
          <p>
            Dans le cadre de l'utilisation de nos services (site web, bot Discord, événements, outils interactifs), nous
            sommes amenés à collecter les données personnelles suivantes :
          </p>

          <div className="mt-4">
            <h4 className="font-semibold">Données d'authentification (Discord OAuth)</h4>
            <ul className="list-disc pl-6 space-y-1">
              <li>Identifiant Discord (ID)</li>
              <li>Pseudo Discord</li>
              <li>Avatar Discord</li>
              <li>Adresse e-mail (si fournie par Discord)</li>
            </ul>
          </div>

          <div className="mt-4">
            <h4 className="font-semibold">Données de participation</h4>
            <ul className="list-disc pl-6 space-y-1">
              <li>Inscriptions aux événements et tournois</li>
              <li>Résultats de compétitions e-sport</li>
              <li>Statistiques de jeu (pour les tournois Achilléa)</li>
            </ul>
          </div>

          <div className="mt-4">
            <h4 className="font-semibold">Contenus générés par l'utilisateur</h4>
            <ul className="list-disc pl-6 space-y-1">
              <li>Images créées via nos outils (Nostalgie VR, Crampons de Noël, Avatar RG)</li>
              <li>Commentaires et contributions sur le serveur Discord</li>
              <li>Créations partagées dans les galeries communautaires</li>
            </ul>
          </div>

          <div className="mt-4">
            <h4 className="font-semibold">Données techniques</h4>
            <ul className="list-disc pl-6 space-y-1">
              <li>Cookies de session (authentification, préférences utilisateur)</li>
              <li>Logs de connexion (adresse IP, type de navigateur, horodatage)</li>
              <li>Données d'analyse (auto-hébergées, plus Google Tag Manager et Google AdSense — cf. § 8)</li>
            </ul>
          </div>

          <h3 className="text-xl font-semibold mb-3 mt-6">2.2. Base Légale du Traitement</h3>
          <p>Le traitement de vos données repose sur :</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Votre consentement</strong> pour l'utilisation de nos services et outils interactifs (Art. 6.1.a
              du RGPD)
            </li>
            <li>
              <strong>L'exécution d'un contrat</strong> pour la gestion de votre participation aux événements (Art.
              6.1.b du RGPD)
            </li>
            <li>
              <strong>Notre intérêt légitime</strong> pour améliorer nos services, modérer les contenus et sécuriser nos
              plateformes (Art. 6.1.f du RGPD)
            </li>
            <li>
              <strong>Le respect d'obligations légales</strong> (conservation des logs, lutte contre les contenus
              illégaux)
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">3. Utilisation des Données</h2>
          <p>Vos données personnelles sont utilisées uniquement pour :</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Assurer le fonctionnement de nos services</strong> : authentification, sauvegarde de vos
              préférences, accès à vos créations
            </li>
            <li>
              <strong>Gérer votre participation aux événements</strong> : inscriptions aux tournois, suivi des
              résultats, attribution des récompenses
            </li>
            <li>
              <strong>Modérer et sécuriser nos plateformes</strong> : détection des comportements abusifs, application
              du code de conduite
            </li>
            <li>
              <strong>Améliorer l'expérience utilisateur</strong> : statistiques d'utilisation anonymisées, optimisation
              des services
            </li>
            <li>
              <strong>Communiquer avec vous</strong> : annonces importantes, réponses à vos demandes de support
            </li>
          </ul>

          <div className="mt-6 p-6 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <p className="font-semibold text-green-900 dark:text-green-200">Engagement de Rose Griffon :</p>
            <p className="mt-2 text-green-800 dark:text-green-300">
              Nous ne vendons <strong>jamais</strong> vos données personnelles et ne transmettons aucun fichier de
              membres à un annonceur. Les annonces du site sont servies par Google AdSense, qui dépose ses propres
              cookies (§ 8) sans recevoir de nous la moindre donnée de compte.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">4. Partage des Données</h2>
          <p>Vos données personnelles peuvent être partagées uniquement dans les cas suivants :</p>

          <h3 className="text-xl font-semibold mb-3 mt-6">4.1. Prestataires Techniques</h3>
          <p>Nous utilisons les services suivants pour héberger nos données :</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Auto-hébergement</strong> (hébergement du site web) - Données hébergées sur serveur dédié en
              France/Europe.
            </li>
            <li>
              <strong>PostgreSQL auto-hébergé</strong> (base de données et authentification) - sur le même serveur
              dédié, en France
            </li>
            <li>
              <strong>Google Ireland Limited</strong> (diffusion des annonces AdSense et mesure d'audience) - selon sa{" "}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#344E8C] hover:underline"
              >
                politique de confidentialité
              </a>
            </li>
            <li>
              <strong>Discord Inc.</strong> (authentification OAuth et bot) - Selon leur{" "}
              <a
                href="https://discord.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#344E8C] hover:underline"
              >
                politique de confidentialité
              </a>
            </li>
          </ul>
          <p className="mt-4">
            Ces prestataires agissent en qualité de sous-traitants au sens de l'article 28 du RGPD et sont
            contractuellement tenus de garantir la sécurité de vos données.
          </p>

          <h3 className="text-xl font-semibold mb-3 mt-6">4.2. Obligations Légales</h3>
          <p>Nous pouvons être amenés à communiquer vos données aux autorités compétentes en cas de :</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Réquisition judiciaire</li>
            <li>Lutte contre les contenus illicites (harcèlement, pédocriminalité, terrorisme)</li>
            <li>Protection de nos droits légitimes</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">5. Durée de Conservation</h2>
          <p>
            Conformément au principe de limitation de la conservation (Art. 5.1.e du RGPD), nous conservons vos données
            personnelles uniquement aussi longtemps que nécessaire :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Données de compte actif</strong> : Tant que votre compte est actif ou selon vos demandes de
              suppression
            </li>
            <li>
              <strong>Contenus générés</strong> : Jusqu'à votre demande de suppression ou suppression volontaire
            </li>
            <li>
              <strong>Logs de connexion</strong> : 12 mois (durée légale de conservation pour la sécurité)
            </li>
            <li>
              <strong>Données de tournois</strong> : 3 ans (conservation à des fins historiques et statistiques)
            </li>
          </ul>
          <p className="mt-4">Après ces délais, vos données sont soit supprimées définitivement, soit anonymisées.</p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">6. Sécurité des Données</h2>
          <p>
            Nous mettons en œuvre des mesures techniques et organisationnelles appropriées pour protéger vos données
            contre :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>L'accès non autorisé</li>
            <li>La perte, l'altération ou la destruction accidentelle</li>
            <li>Les fuites de données</li>
          </ul>
          <p className="mt-4">Ces mesures incluent :</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Chiffrement des communications (HTTPS/TLS pour le site web)</li>
            <li>Authentification sécurisée via Discord OAuth 2.0</li>
            <li>Contrôle d'accès strict aux base de données (RLS Supabase)</li>
            <li>Sauvegarde régulière des données (backups quotidiens automatiques)</li>
            <li>Surveillance des activités suspectes</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">
            7. Vos Droits (RGPD et Loi Informatique et Libertés)
          </h2>
          <p>
            Conformément aux articles 12 à 22 du RGPD et à la loi Informatique et Libertés, vous disposez des droits
            suivants :
          </p>

          <div className="space-y-4 mt-4">
            <div>
              <h4 className="font-semibold">🔍 Droit d'accès (Art. 15 RGPD)</h4>
              <p>Vous pouvez demander une copie de toutes les données personnelles que nous détenons sur vous.</p>
            </div>

            <div>
              <h4 className="font-semibold">✏️ Droit de rectification (Art. 16 RGPD)</h4>
              <p>Vous pouvez demander la correction de données inexactes ou incomplètes.</p>
            </div>

            <div>
              <h4 className="font-semibold">🗑️ Droit à l'effacement / Droit à l'oubli (Art. 17 RGPD)</h4>
              <p>
                Vous pouvez demander la suppression de vos données personnelles, sauf si nous avons une obligation
                légale de les conserver.
              </p>
            </div>

            <div>
              <h4 className="font-semibold">⏸️ Droit à la limitation du traitement (Art. 18 RGPD)</h4>
              <p>Vous pouvez demander le gel temporaire du traitement de vos données.</p>
            </div>

            <div>
              <h4 className="font-semibold">📦 Droit à la portabilité (Art. 20 RGPD)</h4>
              <p>
                Vous pouvez récupérer vos données dans un format structuré, couramment utilisé et lisible par machine
                (JSON).
              </p>
            </div>

            <div>
              <h4 className="font-semibold">❌ Droit d'opposition (Art. 21 RGPD)</h4>
              <p>
                Vous pouvez vous opposer au traitement de vos données pour des raisons tenant à votre situation
                particulière.
              </p>
            </div>

            <div>
              <h4 className="font-semibold">🚫 Droit de retirer votre consentement</h4>
              <p>
                Vous pouvez retirer votre consentement à tout moment, sans affecter la licéité des traitements
                antérieurs.
              </p>
            </div>
          </div>

          <div className="mt-6 p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <p className="font-semibold text-blue-900 dark:text-blue-200">Comment exercer vos droits ?</p>
            <p className="mt-2 text-blue-800 dark:text-blue-300">
              Pour exercer l'un de ces droits, contactez-nous via notre{" "}
              <Link href="/a-propos/contact" className="underline hover:text-blue-600">
                formulaire de contact
              </Link>{" "}
              ou notre Discord. Nous vous répondrons dans un délai maximum de
              <strong> 1 mois</strong> conformément à l'article 12.3 du RGPD.
            </p>
            <p className="mt-2 text-blue-800 dark:text-blue-300">
              Vous disposez également du droit d'introduire une réclamation auprès de la CNIL (Commission Nationale de
              l'Informatique et des Libertés) :{" "}
              <a
                href="https://www.cnil.fr"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-blue-600"
              >
                www.cnil.fr
              </a>
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">8. Cookies et Technologies Similaires</h2>
          <p>Cookies déposés par le site lui-même :</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Cookies de session</strong> : pour maintenir votre authentification (Better Auth)
            </li>
            <li>
              <strong>Cookies de préférences</strong> : pour sauvegarder vos choix (thème clair/sombre, langue)
            </li>
            <li>
              <strong>Cookies de panier</strong> : pour conserver votre commande en cours dans la boutique
            </li>
          </ul>
          <p className="mt-4">Cookies déposés par des tiers :</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Google AdSense</strong> : les annonces affichées sur le site participent au financement de
              l'association. Google et ses partenaires peuvent déposer des cookies pour mesurer les affichages, limiter
              la répétition d'une même annonce et, si vous y avez consenti, personnaliser les annonces d'après votre
              navigation. Nous ne transmettons à Google aucune donnée de votre compte.
            </li>
            <li>
              <strong>Google Tag Manager</strong> : mesure d'audience (pages consultées, appareil, provenance).
            </li>
          </ul>
          <p className="mt-4">
            Vous pouvez refuser la personnalisation des annonces à tout moment depuis les{" "}
            <a
              href="https://myadcenter.google.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-blue-600"
            >
              paramètres publicitaires Google
            </a>{" "}
            et consulter le détail des cookies utilisés par Google sur{" "}
            <a
              href="https://policies.google.com/technologies/partner-sites"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-blue-600"
            >
              sa page dédiée
            </a>
            . Un blocage de ces cookies par votre navigateur n'empêche pas la consultation du site.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">9. Transferts de Données Hors UE</h2>
          <p>
            Certains de nos prestataires (Discord, Google) sont basés aux États-Unis. Ces transferts sont encadrés par :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Des clauses contractuelles types (SCC) approuvées par la Commission européenne</li>
            <li>L'adhésion au EU-US Data Privacy Framework</li>
            <li>Des garanties contractuelles de protection équivalente au RGPD</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">10. Mineurs</h2>
          <p>
            Nos services sont accessibles à tous. Conformément à l'article 8 du RGPD, si vous avez moins de 15 ans,
            l'utilisation de nos services nécessite le consentement de vos parents ou de votre responsable légal.
          </p>
          <p className="mt-4">
            Si nous découvrons que des données personnelles d'un mineur ont été collectées sans consentement parental,
            nous les supprimerons dans les plus brefs délais.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">11. Modification de la Politique</h2>
          <p>
            Cette politique de confidentialité peut être mise à jour pour refléter les évolutions de nos pratiques ou de
            la réglementation. En cas de modification substantielle, nous vous en informerons via nos canaux officiels
            (Discord, site web).
          </p>
          <p className="mt-4">
            La version en vigueur est toujours accessible sur cette page avec la date de dernière mise à jour en haut du
            document.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">
            12. Contact et Délégué à la Protection des Données
          </h2>
          <p>
            Pour toute question relative à cette politique ou à la protection de vos données personnelles, vous pouvez
            nous contacter :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Par notre{" "}
              <Link href="/a-propos/contact" className="text-[#344E8C] hover:underline">
                formulaire de contact
              </Link>
            </li>
            <li>
              Via notre Discord :{" "}
              <a
                href="https://discord.gg/8X8eQfBMkt"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#344E8C] hover:underline"
              >
                discord.gg/8X8eQfBMkt
              </a>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
