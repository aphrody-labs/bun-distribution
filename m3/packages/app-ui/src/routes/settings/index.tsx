// SPDX-License-Identifier: Apache-2.0
// Canonical Settings Surface (docs/UI-DESIGN.md §4.6)
// Zero duplicate sidebar, zero technical slop, pure user controls.

import { useSearchParams } from "react-router-dom";
import {
  GeneralSettings,
  AppearanceSettings,
  AgentSettings,
  ModelsSettings,
  KeyboardSettings,
} from "../../Settings/pages";

export interface SettingsProps {
  embedded?: boolean;
}

export function Settings({ embedded: _embedded = false }: SettingsProps) {
  const [searchParams] = useSearchParams();
  const section = searchParams.get("section") || "general";

  const renderContent = () => {
    switch (section) {
      case "general":
        return <GeneralSettings />;
      case "appearance":
        return <AppearanceSettings />;
      case "agent":
        return <AgentSettings />;
      case "models":
        return <ModelsSettings />;
      case "keyboard":
        return <KeyboardSettings />;
      default:
        return <GeneralSettings />;
    }
  };

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto bg-surface text-on-surface">
      <main className="mx-auto max-w-4xl p-6 md:p-8">{renderContent()}</main>
    </div>
  );
}
