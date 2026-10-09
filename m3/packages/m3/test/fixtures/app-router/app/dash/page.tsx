import { cookies, headers } from "next/headers";

export default async function Dash() {
  const agent = (await headers()).get("user-agent") ?? "none";
  const theme = (await cookies()).get("theme")?.value ?? "light";
  return (
    <p id="dash">
      {agent} {theme}
    </p>
  );
}
