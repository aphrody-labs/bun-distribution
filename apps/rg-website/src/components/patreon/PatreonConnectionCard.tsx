"use client";

import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@rosegriffon/ui";
import { Heart, Link2, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { useLanguage } from "@/components/providers/language-provider";
import { uiMessage, type UiMessageKey } from "@rosegriffon/i18n";

interface Props {
  isLinked: boolean;
  hasDiscord: boolean;
}

const PROMO_DISMISSED_KEY = "rg.patreon_promo_dismissed";

export function PatreonConnectionCard({ isLinked, hasDiscord }: Props) {
  const { language } = useLanguage();
  const message = (key: UiMessageKey) => uiMessage(language, key);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);

  useEffect(() => {
    if (isLinked || !hasDiscord) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    const dismissed = window.localStorage.getItem(PROMO_DISMISSED_KEY);
    if (dismissed === "1") {
      return;
    }
    const t = setTimeout(() => setPromoOpen(true), 800);
    return () => clearTimeout(t);
  }, [isLinked, hasDiscord]);

  const dismissPromo = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PROMO_DISMISSED_KEY, "1");
    }
    setPromoOpen(false);
  };

  const startLink = async () => {
    setBusy(true);
    try {
      const res = await authClient.signIn.social({
        callbackURL: window.location.pathname,
        provider: "patreon",
      });
      const err = (res as { error?: { message?: string } | null })?.error;
      if (err) {
        toast.error(err.message ?? "Erreur lors du link Patreon");
        setBusy(false);
      }
    } catch (error) {
      console.error(error);
      toast.error("Erreur lors du link Patreon");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/patreon/disconnect", {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      toast.success("Compte Patreon déconnecté");
      window.location.reload();
    } catch (error) {
      console.error(error);
      toast.error("Erreur lors de la déconnexion");
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="border-[#FF424D]/30 bg-card">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#FF424D]/10 text-[#FF424D]">
              <Heart className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-foreground">
                {message("account.patreon.title")}
                {isLinked ? (
                  <span className="ml-2 inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    {message("account.patreon.status.linked")}
                  </span>
                ) : (
                  <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {message("account.patreon.status.unlinked")}
                  </span>
                )}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {isLinked
                  ? "Synchronisation automatique de votre tier Patreon."
                  : hasDiscord
                    ? "Liez votre Patreon pour récupérer votre tier et votre rôle Discord."
                    : "Liez votre Patreon pour synchroniser votre tier."}
              </p>
            </div>
          </div>
          {isLinked ? (
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)} disabled={busy}>
              <X className="mr-2 size-4" />
              {message("account.patreon.action.disconnect")}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={startLink}
              disabled={busy}
              className="bg-[#FF424D] text-white hover:bg-[#e63b46]"
            >
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Link2 className="mr-2 size-4" />}
              {message("account.patreon.action.link")}
            </Button>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{message("account.patreon.confirmDisconnect.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              Votre tier ne sera plus synchronisé automatiquement. Vous pourrez relier le compte à tout moment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{message("common.action.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => {
                e.preventDefault();
                disconnect();
              }}
              disabled={busy}
              className="bg-rose-500 hover:bg-rose-600"
            >
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {message("account.patreon.action.disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={promoOpen} onOpenChange={setPromoOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-[#FF424D]/10">
              <Heart className="size-6 text-[#FF424D]" />
            </div>
            <DialogTitle>Liez votre Patreon</DialogTitle>
            <DialogDescription>
              Votre compte Discord est déjà connecté. Reliez votre Patreon en deux clics : votre tier sera synchronisé
              automatiquement et votre rôle Discord conservé.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={dismissPromo} disabled={busy}>
              Plus tard
            </Button>
            <Button
              onClick={() => {
                dismissPromo();
                startLink();
              }}
              disabled={busy}
              className="bg-[#FF424D] text-white hover:bg-[#e63b46]"
            >
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Link2 className="mr-2 size-4" />}
              {message("account.patreon.action.link")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
