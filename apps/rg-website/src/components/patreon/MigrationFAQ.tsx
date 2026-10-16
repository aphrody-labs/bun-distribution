import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@rosegriffon/ui";

const ITEMS = [
  {
    a: "Pour reprendre la main sur la communauté, baisser les frais (Patreon prend 8 à 12% + frais de paiement), et offrir un système de soutien intégré au site Rose Griffon, avec boutique, contenus exclusifs et rôles Discord automatiques.",
    q: "Pourquoi quitter Patreon ?",
  },
  {
    a: "Oui. Mêmes paliers, mêmes prix pendant 12 mois, même rôle Discord, mêmes contenus exclusifs. Tout ce qu'on faisait sur Patreon, on le refait ici, en mieux.",
    q: "Mes avantages restent-ils les mêmes ?",
  },
  {
    a: "Cliquez sur « Lier mon compte Patreon » : on identifie votre soutien historique. Puis vous souscrivez via Stripe (carte bancaire) au tarif que vous payiez sur Patreon, garanti 12 mois. Pensez ensuite à annuler votre paiement Patreon de votre côté.",
    q: "Comment se passe la migration concrète ?",
  },
  {
    a: "Non. Patreon utilise son propre système de paiement, et les informations de carte ne sont pas transférables vers un autre service (ni Stripe, ni un concurrent). C'est une étape obligatoire imposée par Patreon — désolés.",
    q: "Pourquoi dois-je re-souscrire ? Patreon ne transfère pas ma carte ?",
  },
  {
    a: "Au cutoff, votre rôle Discord Patreon expirera automatiquement. Vous pourrez toujours rejoindre le serveur Rose Griffon en tant que membre standard, et soutenir plus tard si vous le souhaitez.",
    q: "Que se passe-t-il si je ne fais rien ?",
  },
  {
    a: "Tous les envois physiques promis sur Patreon seront honorés, même après le cutoff. Si vous avez une adresse renseignée chez Patreon, on l'a importée pour la réutilisation.",
    q: "Et mes commandes Patreon en cours (envoi physique) ?",
  },
  {
    a: "Stripe est l'un des leaders mondiaux du paiement en ligne (Apple, Shopify, Amazon en font partie). Aucune information bancaire ne transite ou n'est stockée sur les serveurs Rose Griffon. Conforme PCI DSS niveau 1.",
    q: "Le paiement Stripe est-il sûr ?",
  },
];

export function MigrationFAQ() {
  return (
    <Accordion type="single" collapsible className="w-full">
      {ITEMS.map((item, i) => (
        <AccordionItem key={i} value={`item-${i}`}>
          <AccordionTrigger className="text-left">{item.q}</AccordionTrigger>
          <AccordionContent>{item.a}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
