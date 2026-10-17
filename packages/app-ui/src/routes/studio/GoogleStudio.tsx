// SPDX-License-Identifier: Apache-2.0
import { GoogleStudio as NativeGoogleStudio } from "./NativeGoogleStudio";
import { isTauri } from "../../tauri-bridge";
import { ProductSearchHome } from "../product/ProductSearchHome";
import { useI18n } from "../../i18n";
import { nativeGoogleMessages } from "../product/product-search-messages";

export function GoogleStudio() {
  const language = useI18n(state => state.language);
  return isTauri() ? (
    <NativeGoogleStudio language={language} messages={nativeGoogleMessages[language]} />
  ) : (
    <ProductSearchHome />
  );
}
