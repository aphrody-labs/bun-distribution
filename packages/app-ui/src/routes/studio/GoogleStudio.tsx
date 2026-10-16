// SPDX-License-Identifier: Apache-2.0
import { GoogleStudio as NativeGoogleStudio } from "@aphrody/web-source/integrations/m3/packages/app-ui/src/routes/studio/GoogleStudio.tsx";
import { isTauri } from "../../tauri-bridge";
import { ProductSearchHome } from "../product/ProductSearchHome";
import { useI18n } from "../../i18n";
import { nativeGoogleMessages } from "../product/product-search-messages";

export function GoogleStudio() {
  const language = useI18n((state) => state.language);
  return isTauri() ? (
    <NativeGoogleStudio
      language={language}
      messages={nativeGoogleMessages[language]}
    />
  ) : (
    <ProductSearchHome />
  );
}
