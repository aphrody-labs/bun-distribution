import { Button } from "@rosegriffon/ui";
import { FileQuestion } from "lucide-react";
import Link from "next/link";

export default function ChroniqueNotFound() {
  return (
    <div className="container flex flex-col items-center justify-center min-h-[60vh] space-y-6 text-center">
      <div className="p-6 bg-muted rounded-full">
        <FileQuestion className="size-12 text-muted-foreground" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-rg-rose">Chronique introuvable</h2>
        <p className="text-muted-foreground">La chronique que vous recherchez n'existe pas ou a été supprimée.</p>
      </div>
      <Button asChild>
        <Link href="/admin/chroniques">Retour à la liste</Link>
      </Button>
    </div>
  );
}
