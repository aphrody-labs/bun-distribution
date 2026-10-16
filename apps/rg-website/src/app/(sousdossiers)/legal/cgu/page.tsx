import type { Metadata } from "next";
import Link from "next/link";

import { absoluteUrl, SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/legal/cgu") },
  description:
    "Conditions générales d'utilisation des services de l'association Rose Griffon, conformes aux lois françaises.",
  title: "Conditions Générales d'Utilisation | Rose Griffon",
};

export default function TermsOfServicePage() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <h1 className="text-4xl font-bold mb-4 text-[#B03519]">Conditions Générales d'Utilisation</h1>
      <p className="text-sm text-muted-foreground mb-8">Dernière mise à jour : 24 novembre 2025</p>

      <div className="prose prose-lg dark:prose-invert max-w-none space-y-8">
        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">1. Objet et Champ d'Application</h2>
          <p>
            Les présentes Conditions Générales d'Utilisation (ci-après « CGU ») régissent l'accès et l'utilisation du
            site web{" "}
            <Link href={SITE_URL} className="text-[#344E8C] hover:underline">
              rosegriffon.fr
            </Link>{" "}
            et de l'ensemble des services associés fournis par l'association Rose Griffon, association loi 1901 à but
            non lucratif.
          </p>
          <p>Nos services incluent notamment :</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Le site web et ses outils interactifs (générateurs d'images, galeries)</li>
            <li>Le bot Discord "Capitaine Gaëlle"</li>
            <li>L'organisation d'événements et de tournois e-sport</li>
            <li>Les plateformes Achilléa (e-sport) et Azalée (média)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">2. Acceptation des Conditions</h2>
          <p>
            En accédant à notre site web et en utilisant nos services, vous acceptez sans réserve les présentes CGU
            ainsi que notre{" "}
            <Link href="/legal/confidentialite" className="text-[#344E8C] hover:underline">
              Politique de Confidentialité
            </Link>{" "}
            et notre{" "}
            <Link href="/charte-engagements" className="text-[#344E8C] hover:underline">
              Charte d'Engagements
            </Link>
            .
          </p>
          <p>Si vous n'acceptez pas ces conditions, vous devez cesser immédiatement d'utiliser nos services.</p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">
            3. Code de Conduite et Valeurs de l'Association
          </h2>
          <h3 className="text-xl font-semibold mb-3">3.1. Respect et Inclusion</h3>
          <p>
            Conformément à notre{" "}
            <Link href="/charte-engagements" className="text-[#344E8C] hover:underline">
              charte d'engagements
            </Link>
            , Rose Griffon est une structure inclusive. Nous défendons activement le respect de toutes les identités
            (LGBTQIA+, croyances religieuses, origines, genres) et nous nous engageons à intervenir fermement contre
            tout comportement discriminatoire.
          </p>
          <p className="font-semibold mt-4">Sont strictement interdits et entraîneront une exclusion immédiate :</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Tout comportement toxique, harcèlement ou intimidation</li>
            <li>Propos discriminatoires (racisme, sexisme, homophobie, transphobie, validisme, etc.)</li>
            <li>Incitation à la haine ou à la violence</li>
            <li>Partage de contenu NSFW (Not Safe For Work) ou inapproprié</li>
            <li>Triche lors des tournois et compétitions</li>
          </ul>

          <h3 className="text-xl font-semibold mb-3 mt-6">3.2. Transparence et Crédit</h3>
          <p>
            Nous nous engageons à créditer toutes les personnes ayant contribué à nos projets. De même, nous attendons
            de nos utilisateurs qu'ils respectent la propriété intellectuelle d'autrui et créditent les créateurs
            lorsqu'ils partagent du contenu.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">4. Propriété Intellectuelle</h2>
          <h3 className="text-xl font-semibold mb-3">4.1. Propriété de Rose Griffon</h3>
          <p>
            Le nom « Rose Griffon », nos logos, mascottes (Roy, Gaëlle) et tous les contenus originaux créés par
            l'association sont la propriété exclusive de l'association Rose Griffon et sont protégés par les lois
            françaises et internationales relatives au droit d'auteur et à la propriété intellectuelle (Code de la
            propriété intellectuelle).
          </p>

          <h3 className="text-xl font-semibold mb-3 mt-6">4.2. Licence Inazuma Eleven</h3>
          <p>
            Inazuma Eleven est une marque déposée et une propriété de LEVEL-5 Inc. Rose Griffon est une association de
            fans indépendante et n'est pas officiellement affiliée à LEVEL-5. Tous les contenus relatifs à la licence
            Inazuma Eleven restent la propriété de leurs ayants droit respectifs.
          </p>

          <h3 className="text-xl font-semibold mb-3 mt-6">4.3. Contenus Générés par les Utilisateurs</h3>
          <p>
            Lorsque vous créez du contenu via nos outils (ex : générateurs d'images, galeries), vous conservez vos
            droits sur vos créations. Vous accordez toutefois à Rose Griffon une licence non exclusive pour afficher,
            partager et promouvoir ces contenus dans le cadre de nos activités associatives.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">5. Utilisation des Services</h2>
          <h3 className="text-xl font-semibold mb-3">5.1. Conditions d'Accès</h3>
          <p>
            L'accès à nos services est gratuit et ouvert à tous. Certaines fonctionnalités peuvent nécessiter une
            authentification via Discord.
          </p>

          <h3 className="text-xl font-semibold mb-3 mt-6">5.2. Obligations de l'Utilisateur</h3>
          <p>En utilisant nos services, vous vous engagez à :</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Fournir des informations exactes lors de votre inscription</li>
            <li>Respecter le code de conduite et la charte d'engagements</li>
            <li>Ne pas perturber le bon fonctionnement des services</li>
            <li>Ne pas tenter d'accéder de manière non autorisée à nos systèmes</li>
            <li>Ne pas utiliser nos services à des fins illégales</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">6. Responsabilité et Limitation de Garantie</h2>
          <h3 className="text-xl font-semibold mb-3">6.1. Services Fournis "En l'État"</h3>
          <p>
            Rose Griffon s'efforce de fournir des services fiables et de qualité. Toutefois, en tant qu'association à
            but non lucratif gérée par des bénévoles, nous ne pouvons garantir une disponibilité continue et sans
            interruption de nos services.
          </p>

          <h3 className="text-xl font-semibold mb-3 mt-6">6.2. Limitation de Responsabilité</h3>
          <p>Conformément à l'article 1231-3 du Code civil, Rose Griffon ne saurait être tenue responsable :</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Des interruptions de service, bugs ou dysfonctionnements techniques</li>
            <li>Des pertes de données, sauf en cas de faute lourde ou de négligence grave</li>
            <li>Des dommages indirects résultant de l'utilisation de nos services</li>
            <li>Des contenus générés par les utilisateurs</li>
          </ul>
          <p className="mt-4">L'utilisation de nos outils et services se fait sous votre propre responsabilité.</p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">7. Protection des Données Personnelles</h2>
          <p>
            La collecte et le traitement de vos données personnelles sont régis par notre{" "}
            <Link href="/legal/confidentialite" className="text-[#344E8C] hover:underline">
              Politique de Confidentialité
            </Link>
            , conforme au Règlement Général sur la Protection des Données (RGPD) et à la loi Informatique et Libertés du
            6 janvier 1978 modifiée.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">8. Modification et Interruption des Services</h2>
          <p>
            Rose Griffon se réserve le droit de modifier, suspendre ou interrompre tout ou partie de ses services à tout
            moment, sans préavis ni indemnité.
          </p>
          <p className="mt-4">
            Les présentes CGU peuvent également être modifiées à tout moment. En cas de modification substantielle, nous
            nous efforcerons de vous en informer via nos canaux de communication officiels (Discord, site web). La
            version en vigueur est toujours accessible sur cette page avec la date de dernière mise à jour.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">9. Sanctions et Exclusion</h2>
          <p>
            En cas de non-respect des présentes CGU, de notre code de conduite ou de notre charte d'engagements, Rose
            Griffon se réserve le droit de :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Suspendre temporairement votre accès à nos services</li>
            <li>Bannir définitivement votre compte</li>
            <li>Supprimer vos contenus</li>
            <li>Signaler aux autorités compétentes tout comportement illégal</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">10. Droit Applicable et Litiges</h2>
          <p>
            Les présentes CGU sont régies par le droit français. En cas de litige, conformément aux articles L.612-1 et
            suivants du Code de la consommation, vous pouvez recourir à une procédure de médiation conventionnelle ou à
            tout autre mode alternatif de règlement des différends.
          </p>
          <p className="mt-4">
            À défaut de résolution amiable, tout litige relèvera de la compétence exclusive des tribunaux français.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-[#FFC46E]">11. Contact</h2>
          <p>Pour toute question relative à ces conditions, vous pouvez nous contacter :</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Via notre serveur Discord officiel :{" "}
              <a
                href="https://discord.gg/8X8eQfBMkt"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#344E8C] hover:underline"
              >
                discord.gg/8X8eQfBMkt
              </a>
            </li>
            <li>
              Via notre{" "}
              <Link href="/a-propos/contact" className="text-[#344E8C] hover:underline">
                formulaire de contact
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
