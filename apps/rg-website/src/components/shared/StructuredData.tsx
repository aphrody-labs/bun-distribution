import type {
  Article,
  BreadcrumbList,
  Event,
  ImageObject,
  Organization,
  ProfilePage,
  WebSite,
  WithContext,
} from "schema-dts";
import { NETWORK_SAME_AS } from "@/lib/social-links";
import { absoluteUrl, SITE_URL } from "@/lib/site-url";

// ... existing imports ...

interface ImageObjectSchemaProps {
  url: string;
  name?: string;
  description?: string;
  author?: string;
  datePublished?: string;
}

export function ImageObjectSchema({ url, name, description, author, datePublished }: ImageObjectSchemaProps) {
  const schema: WithContext<ImageObject> = {
    "@context": "https://schema.org",
    "@type": "ImageObject",
    acquireLicensePage: absoluteUrl("/legal/cgu"),
    author: author ? { "@type": "Person", name: author } : undefined,
    contentUrl: url,
    datePublished: datePublished,
    description: description,
    license: absoluteUrl("/legal/cgu"),
    name: name,
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}

export function OrganizationSchema() {
  const schema: WithContext<Organization> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    // Même `@id` que le `@graph` du layout → Google fusionne les deux nœuds.
    "@id": absoluteUrl("/#organization"),
    address: {
      "@type": "PostalAddress",
      addressCountry: "FR",
    },
    description:
      "Association française Inazuma Eleven. Rassemble la communauté, organise des événements et produit du contenu.",
    foundingDate: "2019",
    logo: absoluteUrl("/RG_Logo_V2.5.webp"),
    name: "Rose Griffon",
    // Réseau Rose Griffon : 3 domaines siblings + tous les réseaux sociaux.
    // Liste identique sur website / azalee / achillea (entité cohérente).
    sameAs: NETWORK_SAME_AS,
    url: SITE_URL,
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}

export function WebsiteSchema() {
  const schema: WithContext<WebSite> = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Rose Griffon",
    /* eslint-disable @typescript-eslint/no-explicit-any -- schema-dts SearchAction not directly assignable */
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: absoluteUrl("/search?q={search_term_string}"),
      },
      "query-input": "required name=search_term_string",
    } as any /* eslint-enable @typescript-eslint/no-explicit-any */,
    url: SITE_URL,
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}

interface ArticleSchemaProps {
  title: string;
  description: string;
  image: string[];
  datePublished: string;
  dateModified?: string;
  authorName: string;
  authorUrl?: string;
  url: string;
}

/** La plus récente des deux dates ISO, en repli sur la publication. */
function plusRecente(publication: string, modification?: string): string {
  if (!modification) {
    return publication;
  }
  const a = Date.parse(publication);
  const b = Date.parse(modification);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return publication;
  }
  return b > a ? modification : publication;
}

export function ArticleSchema({
  title,
  description,
  image,
  datePublished,
  dateModified,
  authorName,
  authorUrl,
  url,
}: ArticleSchemaProps) {
  const schema: WithContext<Article> = {
    "@context": "https://schema.org",
    "@type": "Article",
    author: {
      "@type": "Person",
      name: authorName,
      url: authorUrl,
    },
    // `updated_at` de la table `articles` porte la date de la dernière écriture en
    // base, qui peut précéder la publication (article rédigé puis publié plus
    // tard). Une modification antérieure à la publication est incohérente et
    // invalide le balisage Article aux yeux de Google : on plafonne par le bas.
    dateModified: plusRecente(datePublished, dateModified),
    datePublished: datePublished,
    description: description,
    headline: title,
    image: image,
    mainEntityOfPage: {
      "@id": url,
      "@type": "WebPage",
    },
    publisher: {
      "@type": "Organization",
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl("/RG_Logo_V2.5.webp"),
      },
      name: "Rose Griffon",
    },
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}

interface BreadcrumbSchemaProps {
  items: { name: string; item: string }[];
}

export function BreadcrumbSchema({ items }: BreadcrumbSchemaProps) {
  const schema: WithContext<BreadcrumbList> = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      item: item.item.startsWith("http") ? item.item : absoluteUrl(item.item),
      name: item.name,
      position: index + 1,
    })),
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}

interface ProfileSchemaProps {
  name: string;
  username: string;
  image?: string;
  description?: string;
  url: string;
  sameAs?: string[];
}

export function ProfileSchema({ name, username, image, description, url, sameAs }: ProfileSchemaProps) {
  const schema: WithContext<ProfilePage> = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    mainEntity: {
      "@type": "Person",
      alternateName: username,
      description: description,
      image: image,
      name: name,
      sameAs: sameAs,
      url: url,
    },
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}

interface TeamMemberSchema {
  name: string;
  role?: string;
  image?: string;
  sameAs?: string[];
}

interface TeamStructuredDataProps {
  /** Titre de la page équipe (ex : "Le Staff RG"). */
  pageName: string;
  /** URL canonique de la page (ex : "https://rosegriffon.fr/community"). */
  url: string;
  members: TeamMemberSchema[];
}

/**
 * Données structurées pour une page équipe : un `CollectionPage` dont l'entité
 * principale est un `ItemList` de `Person`. Chaque membre expose name, jobTitle,
 * image et `sameAs` (ses réseaux), rattaché à l'Organization Rose Griffon —
 * éligible aux rich results Google et au knowledge graph.
 */
export function TeamStructuredData({ pageName, url, members }: TeamStructuredDataProps) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: pageName,
    url,
    isPartOf: { "@id": absoluteUrl("/#website") },
    about: { "@id": absoluteUrl("/#organization") },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: members.length,
      itemListElement: members.map((member, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "Person",
          name: member.name,
          ...(member.role ? { jobTitle: member.role } : {}),
          ...(member.image ? { image: member.image } : {}),
          ...(member.sameAs && member.sameAs.length > 0 ? { sameAs: member.sameAs } : {}),
          memberOf: { "@id": absoluteUrl("/#organization") },
        },
      })),
    },
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}

interface EventSchemaProps {
  name: string;
  description: string;
  startDate: string;
  endDate?: string;
  image?: string;
  location?: string | { name: string; address?: string };
  url: string;
}

export function EventSchema({ name, description, startDate, endDate, image, location, url }: EventSchemaProps) {
  const schema: WithContext<Event> = {
    "@context": "https://schema.org",
    "@type": "Event",
    description: description,
    endDate: endDate,
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    image: image,
    location:
      typeof location === "string"
        ? {
            "@type": "Place",
            name: location,
          }
        : {
            "@type": "Place",
            name: location?.name || "Online",
            address: location?.address,
          },
    name: name,
    organizer: {
      "@type": "Organization",
      name: "Rose Griffon",
      url: SITE_URL,
    },
    startDate: startDate,
    url: url,
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}
