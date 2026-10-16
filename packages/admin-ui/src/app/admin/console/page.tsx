import type { Metadata } from "next";
import { BotConsole } from "./BotConsole";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Console bots",
  robots: { index: false },
};

export default function AdminConsolePage() {
  return <BotConsole />;
}
