import { EventsStream } from "./events-stream";

export default function AdminEventsPage() {
  return (
    <div className="w-full max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-4xl font-saiyan text-dbz-orange mb-2">ÉVÉNEMENTS A2A</h1>
        <p className="text-sm text-zinc-300 mb-1">
          Flux d'événements entre agents (protocole A2A — Agent-to-Agent). Ce canal transporte les
          actions structurées publiées par les différents modules du bot : montées de niveau, succès
          débloqués, sanctions, quêtes… Différent du flux « Live Bot » qui est plus bas niveau.
        </p>
        <p className="text-xs text-dbz-blue-light uppercase tracking-widest">
          SSE temps réel · /api/a2a/events · tampon 100 événements
        </p>
      </header>
      <EventsStream />
    </div>
  );
}
