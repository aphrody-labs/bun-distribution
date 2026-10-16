"use client";

import { useEffect } from "react";
import { WikiErrorState } from "@/components/wiki/WikiErrorState";

export default function Error({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <WikiErrorState title="Impossible de charger ce personnage" backHref="/chara" backLabel="Retour aux personnages" />
  );
}
