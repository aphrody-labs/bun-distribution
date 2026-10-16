import { createPostgresClient } from "@rosegriffon/db/service";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-helpers";
import { absoluteUrl, SITE_URL } from "@/lib/site-url";

export async function GET() {
  const session = await getServerSession();
  const user = session?.user ?? null;

  let profile = null;
  if (user) {
    // `full_name` fait partie des colonnes personnelles fermées à `anon`.
    const supabase = createPostgresClient();
    const { data } = await supabase
      .from("profiles")
      .select("username, avatar_url, full_name, role")
      .eq("id", user.id)
      .maybeSingle();
    profile = data;
  }

  const commonData = {
    app: "azalee",
    environment: process.env.NODE_ENV,
    network: {
      achillea: "https://achillea.rosegriffon.fr",
      azalee: "https://azalee.rosegriffon.fr",
      rgtv: absoluteUrl("/rose-griffon-tv"),
      rosegriffon: SITE_URL,
    },
    user: user
      ? {
          id: user.id,
          email: user.email,
          ...profile,
        }
      : null,
    version: "1.0.0",
  };

  return NextResponse.json(commonData);
}
