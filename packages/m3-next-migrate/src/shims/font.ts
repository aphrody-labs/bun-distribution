// SPDX-License-Identifier: Apache-2.0
export interface FontConfig {
  subsets?: string[];
  weight?: string | string[];
  style?: string | string[];
  variable?: string;
  fallback?: string[];
  display?: "auto" | "block" | "swap" | "fallback" | "optional";
  preload?: boolean;
}

export interface NextFont {
  className: string;
  variable?: string;
  style: {
    fontFamily: string;
    fontWeight?: string | number;
    fontStyle?: string;
  };
}

function createFontShim(
  fontName: string,
  defaultFamily: string,
): (config?: FontConfig) => NextFont {
  return (config?: FontConfig) => {
    const slug = fontName.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const variable = config?.variable || `--font-${slug}`;
    const className = `font-${slug}`;
    const fontFamily = config?.fallback
      ? `"${fontName}", ${config.fallback.join(", ")}`
      : defaultFamily;

    return {
      className,
      variable,
      style: {
        fontFamily,
      },
    };
  };
}

export const Inter = createFontShim("Inter", "Inter, sans-serif");
export const Roboto = createFontShim("Roboto", "Roboto, sans-serif");
export const Roboto_Mono = createFontShim(
  "Roboto Mono",
  "'Roboto Mono', monospace",
);
export const Geist = createFontShim("Geist", "Geist, sans-serif");
export const Geist_Mono = createFontShim(
  "Geist Mono",
  "'Geist Mono', monospace",
);
export const Poppins = createFontShim("Poppins", "Poppins, sans-serif");
export const Open_Sans = createFontShim("Open Sans", "'Open Sans', sans-serif");
export const Fira_Code = createFontShim("Fira Code", "'Fira Code', monospace");

export interface LocalFontConfig {
  src: string | Array<{ path: string; weight?: string; style?: string }>;
  variable?: string;
  fallback?: string[];
}

export function localFont(config: LocalFontConfig): NextFont {
  const variable = config.variable || "--font-local";
  const className = "font-local";
  const fallbackStr = config.fallback
    ? `, ${config.fallback.join(", ")}`
    : ", sans-serif";
  return {
    className,
    variable,
    style: {
      fontFamily: `"LocalFont"${fallbackStr}`,
    },
  };
}
