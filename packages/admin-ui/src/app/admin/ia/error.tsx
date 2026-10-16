"use client";

// SPDX-License-Identifier: Apache-2.0

import { SectionError } from "@/components/SectionError";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SectionError
      {...props}
      title="Le cockpit IA n'a pas pu s'afficher"
      backHref="/admin/dashboard"
      backLabel="Tableau de bord admin"
    />
  );
}
