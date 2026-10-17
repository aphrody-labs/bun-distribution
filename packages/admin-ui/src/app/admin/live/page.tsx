import { LiveEventsStream } from "./LiveEventsStream";

export const dynamic = "force-dynamic";

export default function AdminLivePage() {
  return (
    <div className="w-full max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-4xl font-saiyan text-dbz-orange mb-2">FLUX EN DIRECT</h1>
        <p className="text-sm text-zinc-300 mb-1">
          Cette page affiche en temps réel toutes les actions qui se passent sur le bot : montées de niveau, sanctions,
          arrivées/départs de membres, commandes Discord, exécutions de tâches automatiques… Tout ce que le bot reçoit
          ou publie apparaît ici instantanément.
        </p>
        <p className="text-xs text-dbz-blue-light uppercase tracking-widest">
          Connexion SSE (Server-Sent Events) · mise à jour instantanée · tampon 200 événements
        </p>
      </header>
      <LiveEventsStream />
    </div>
  );
}
