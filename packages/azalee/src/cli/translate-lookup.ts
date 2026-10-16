import { getInagleDatabaseURL, isInagleDatabaseConfigured } from "@rosegriffon/db/pg";
/**
 * Recherche d'entités et traduction assistée par glossaire, pour la commande
 * `azalee translate`.
 *
 * Une seule source de vérité est interrogée : les projections SQL `inagle_*`,
 * PostgreSQL en priorité et le miroir SQLite en repli hors ligne.
 * La traduction elle-même protège les noms propres du jeu derrière des
 * marqueurs avant de passer par le service de traduction, puis les restaure :
 * « Fire Tornado » reste « Tornade de feu », pas « Tornade d'incendie ».
 */

import { Database } from "bun:sqlite";
import { isKana, toHiragana, toKatakana } from "wanakana";

import { containsJapanese, escapeRegExp, stripRubyAnnotations } from "../text/japanese-detect";
import { japaneseToRomaji } from "../text/japanese-romaji";
import { createPgClient, getSqlitePath } from "./context";

/** Entité trouvée dans la base ou le glossaire, telle qu'affichée. */
export interface TranslateMatch {
  id: string;
  type: string;
  typeLabel: string;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  name_roma: string | null;
  url: string;
}

/** Traduction brute via l'API publique de Google Translate. */
export async function translateWithGoogle(text: string, from: string, to: string): Promise<string> {
  if (!text.trim()) return "";
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as [Array<[string]>] | null;
      if (data && data[0]) {
        return data[0].map((x) => x[0]).join("");
      }
    }
  } catch (e) {
    console.error("Google Translation API Error:", e);
  }
  return text;
}

/**
 * Cherche l'entité dans PostgreSQL puis, en repli silencieux, dans le miroir
 * SQLite. Les requêtes acceptent kana ↔ romaji via `wanakana`.
 */
export async function searchDatabaseTranslate(query: string): Promise<TranslateMatch[]> {
  const sanitized = query.replaceAll(/[%_,().*\\]/g, "").trim();
  if (!sanitized) return [];

  const q = `%${sanitized}%`;

  const hira = toHiragana(sanitized.toLowerCase());
  const kata = toKatakana(sanitized.toLowerCase());
  const isValidHira = hira.length > 0 && [...hira].every((c) => isKana(c) || c === "ー");
  const isValidKata = kata.length > 0 && [...kata].every((c) => isKana(c) || c === "ー");

  // PostgreSQL en premier.
  const dbUrl = isInagleDatabaseConfigured() ? getInagleDatabaseURL() : undefined;
  if (dbUrl) {
    try {
      const client = createPgClient(dbUrl);
      await client.connect();

      const results: TranslateMatch[] = [];

      // Personnages
      let charSql = `
				SELECT slug as id, 'character' as type, 'Personnage' as "typeLabel",
				       name_fr, name_en, name_ja, name_roma, ('/chara/' || slug) as url
				FROM inagle_characters
				WHERE name_fr ILIKE $1 OR name_en ILIKE $1 OR name_ja ILIKE $1 OR name_roma ILIKE $1
				  AND internal_code NOT LIKE '%_5000'
				ORDER BY name_fr ASC LIMIT 10
			`;
      const charParams: unknown[] = [q];
      if (isValidHira && hira !== sanitized.toLowerCase()) {
        charSql = charSql.replace(
          "OR name_roma ILIKE $1",
          `OR name_roma ILIKE $1 OR name_ja ILIKE $2`,
        );
        charParams.push(`%${hira}%`);
      }
      if (isValidKata && kata !== sanitized.toLowerCase()) {
        const paramIndex = charParams.length + 1;
        charSql = charSql.replace(
          "OR name_ja ILIKE $2",
          `OR name_ja ILIKE $2 OR name_ja ILIKE $${paramIndex}`,
        );
        charParams.push(`%${kata}%`);
      }

      const charRes = await client.query<TranslateMatch>(charSql, charParams);
      results.push(...charRes.rows);

      // Techniques
      const skillRes = await client.query<TranslateMatch>(
        `
				SELECT id::text, 'skill' as type, 'Technique' as "typeLabel",
				       name_fr, name_en, name_ja, NULL as name_roma, ('/skill/' || id) as url
				FROM inagle_skills
				WHERE name_fr ILIKE $1 OR name_en ILIKE $1 OR name_ja ILIKE $1
				ORDER BY name_fr ASC LIMIT 10
			`,
        [q],
      );
      results.push(...skillRes.rows);

      // Équipes
      const teamRes = await client.query<TranslateMatch>(
        `
				SELECT id::text, 'team' as type, 'Équipe' as "typeLabel",
				       name_fr, name_en, name_ja, NULL as name_roma, ('/team/' || id) as url
				FROM inagle_teams
				WHERE name_fr ILIKE $1 OR name_en ILIKE $1 OR name_ja ILIKE $1
				ORDER BY name_fr ASC LIMIT 10
			`,
        [q],
      );
      results.push(...teamRes.rows);

      // Objets
      const itemRes = await client.query<TranslateMatch>(
        `
				SELECT id::text, 'item' as type, 'Objet' as "typeLabel",
				       name_fr, name_en, name_ja, NULL as name_roma, ('/item/' || id) as url
				FROM inagle_items
				WHERE category != 'special_tactics' AND (name_fr ILIKE $1 OR name_en ILIKE $1 OR name_ja ILIKE $1)
				ORDER BY name_fr ASC LIMIT 10
			`,
        [q],
      );
      results.push(...itemRes.rows);

      await client.end();
      return results;
    } catch {
      // Échec silencieux : on tente le miroir SQLite.
    }
  }

  // Repli miroir SQLite.
  const dbPath = getSqlitePath();
  if (dbPath) {
    try {
      const db = new Database(dbPath, { readonly: true });
      const results: TranslateMatch[] = [];

      const queryRun = (sql: string, params: unknown[]): SqliteNameRow[] => {
        const stmt = db.prepare(sql);
        return stmt.all(...(params as never[])) as SqliteNameRow[];
      };

      // Personnages
      let charSql = `
				SELECT id, 'character' as type, 'Personnage' as typeLabel,
				       name_fr, name_en, name_ja, slug,
				       ('/chara/' || slug) as url
				FROM inagle_characters
				WHERE name_fr LIKE ?1 OR name_en LIKE ?1 OR name_ja LIKE ?1
				  AND internal_code NOT LIKE '%_5000'
				ORDER BY name_fr ASC LIMIT 10
			`;
      const charParams: unknown[] = [q];
      if (isValidHira && hira !== sanitized.toLowerCase()) {
        charSql = charSql.replace("OR name_ja LIKE ?1", `OR name_ja LIKE ?1 OR name_ja LIKE ?2`);
        charParams.push(`%${hira}%`);
      }
      if (isValidKata && kata !== sanitized.toLowerCase()) {
        const paramIndex = charParams.length + 1;
        charSql = charSql.replace(
          "OR name_ja LIKE ?2",
          `OR name_ja LIKE ?2 OR name_ja LIKE ?${paramIndex}`,
        );
        charParams.push(`%${kata}%`);
      }

      for (const c of queryRun(charSql, charParams)) results.push(toMatch(c));

      // Techniques
      const skillSql = `
				SELECT id, 'skill' as type, 'Technique' as typeLabel,
				       name_fr, name_en, name_ja, ('/skill/' || id) as url
				FROM inagle_skills
				WHERE name_fr LIKE ?1 OR name_en LIKE ?1 OR name_ja LIKE ?1
				ORDER BY name_fr ASC LIMIT 10
			`;
      for (const s of queryRun(skillSql, [q])) results.push(toMatch(s));

      // Équipes
      const teamSql = `
				SELECT id, 'team' as type, 'Équipe' as typeLabel,
				       name_fr, name_en, name_ja, ('/team/' || id) as url
				FROM inagle_teams
				WHERE name_fr LIKE ?1 OR name_en LIKE ?1 OR name_ja LIKE ?1
				ORDER BY name_fr ASC LIMIT 10
			`;
      for (const t of queryRun(teamSql, [q])) results.push(toMatch(t));

      // Objets
      const itemSql = `
				SELECT id, 'item' as type, 'Objet' as typeLabel,
				       name_fr, name_en, name_ja, ('/item/' || id) as url
				FROM inagle_items
				WHERE category != 'special_tactics' AND (name_fr LIKE ?1 OR name_en LIKE ?1 OR name_ja LIKE ?1)
				ORDER BY name_fr ASC LIMIT 10
			`;
      for (const i of queryRun(itemSql, [q])) results.push(toMatch(i));

      db.close();
      return results;
    } catch {
      // Miroir illisible : on renvoie ce qu'on a (rien).
    }
  }

  return [];
}

/** Ligne brute du miroir SQLite (colonnes de nommage communes). */
interface SqliteNameRow {
  id: string;
  type: string;
  typeLabel: string;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  url: string;
}

/** Normalise une ligne SQLite en `TranslateMatch` (romaji dérivé du japonais). */
function toMatch(row: SqliteNameRow): TranslateMatch {
  return {
    id: row.id,
    type: row.type,
    typeLabel: row.typeLabel,
    name_fr: row.name_fr,
    name_en: row.name_en,
    name_ja: row.name_ja,
    name_roma: row.name_ja ? japaneseToRomaji(row.name_ja) : null,
    url: row.url,
  };
}

interface GlossaryRow {
  id: string;
  type: string;
  typeLabel: string;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  url: string;
  sub_type: string | null;
}

let glossaryRowsPromise: Promise<GlossaryRow[]> | null = null;

/** Charge toutes les variantes nommables depuis les projections SQL canoniques. */
async function loadGlossaryRows(): Promise<GlossaryRow[]> {
  if (glossaryRowsPromise) return glossaryRowsPromise;
  glossaryRowsPromise = (async () => {
    const sql = `
			SELECT slug::text AS id, 'character' AS type, 'Personnage' AS "typeLabel",
			       name_fr, name_en, name_ja, ('/chara/' || slug) AS url, NULL::text AS sub_type
			FROM inagle_characters
			WHERE internal_code NOT LIKE '%_5000' AND slug IS NOT NULL
			UNION ALL
			SELECT id::text, 'skill', 'Technique', name_fr, name_en, name_ja,
			       ('/skill/' || id), NULL::text
			FROM inagle_skills
			UNION ALL
			SELECT id::text, 'aura', 'Aura', name_fr, name_en, name_ja,
			       ('/aura/' || id), sub_type
			FROM inagle_souls
			UNION ALL
			SELECT id::text, 'passive', 'Passif', name_fr, name_en, name_ja,
			       ('/skill/' || id), NULL::text
			FROM inagle_passives
			UNION ALL
			SELECT id::text, 'team', 'Équipe', name_fr, name_en, name_ja,
			       ('/team/' || id), NULL::text
			FROM inagle_teams
			UNION ALL
			SELECT id::text, 'item', 'Objet', name_fr, name_en, name_ja,
			       ('/item/' || id), NULL::text
			FROM inagle_items
			WHERE category <> 'special_tactics'
		`;
    const dbUrl = isInagleDatabaseConfigured() ? getInagleDatabaseURL() : undefined;
    if (dbUrl) {
      try {
        const client = createPgClient(dbUrl);
        await client.connect();
        const result = await client.query<GlossaryRow>(sql);
        await client.end();
        return result.rows;
      } catch {
        // Le miroir local prend le relais hors ligne.
      }
    }
    const dbPath = getSqlitePath();
    if (!dbPath) return [];
    try {
      const db = new Database(dbPath, { readonly: true });
      const rows = db.prepare(sql.replaceAll(/::text/g, "")).all() as GlossaryRow[];
      db.close();
      return rows;
    } catch {
      return [];
    }
  })();
  return glossaryRowsPromise;
}

/** Cherche la requête dans toutes les projections SQL nommables. */
export async function searchGlossaryTranslate(query: string): Promise<TranslateMatch[]> {
  const sanitized = query
    .replaceAll(/[%_,().*\\]/g, "")
    .trim()
    .toLowerCase();
  if (!sanitized) return [];
  const hiraCandidate = toHiragana(sanitized).toLowerCase();
  const kataCandidate = toKatakana(sanitized).toLowerCase();
  const isValidHira = [...hiraCandidate].every((c) => isKana(c) || c === "ー");
  const isValidKata = [...kataCandidate].every((c) => isKana(c) || c === "ー");
  const rows = await loadGlossaryRows();
  return rows
    .filter((row) => {
      const names = [row.name_fr, row.name_en, row.name_ja]
        .filter(Boolean)
        .map((name) => name!.toLowerCase());
      return names.some(
        (name) =>
          name.includes(sanitized) ||
          (isValidHira && name.includes(hiraCandidate)) ||
          (isValidKata && name.includes(kataCandidate)) ||
          (row.name_ja ? japaneseToRomaji(row.name_ja)?.toLowerCase().includes(sanitized) : false),
      );
    })
    .map((row) => ({
      id: row.id,
      type: row.sub_type?.toLowerCase().includes("soul") ? "soul" : row.type,
      typeLabel: row.sub_type?.toLowerCase().includes("soul") ? "Totem" : row.typeLabel,
      name_fr: row.name_fr,
      name_en: row.name_en,
      name_ja: row.name_ja,
      name_roma: row.name_ja ? japaneseToRomaji(row.name_ja) : null,
      url: row.sub_type?.toLowerCase().includes("soul") ? `/aura/totems/${row.id}` : row.url,
    }));
}

/**
 * Traduit un texte vers le français en préservant la terminologie du jeu.
 *
 * Chaque terme du glossaire présent dans le texte est remplacé par un marqueur
 * `[[Tn]]` avant l'appel au service de traduction, puis restauré ensuite — y
 * compris quand le traducteur a déformé le marqueur (`[ T 3 ]`, `T3`…).
 */
export async function translateTextHelper(inputText: string): Promise<string> {
  if (!inputText.trim()) return "";
  const isJa = containsJapanese(inputText);
  const from = isJa ? "ja" : "en";

  const jpToFrMap = new Map<string, string>();
  const enToFrMap = new Map<string, string>();
  const glossaryRows = await loadGlossaryRows();
  for (const row of glossaryRows) {
    const frVal = row.name_fr;
    if (!frVal) continue;
    if (row.name_ja?.trim()) {
      const cleanJa = stripRubyAnnotations(row.name_ja);
      if (cleanJa.length > 1) jpToFrMap.set(cleanJa, frVal);
    }
    if (row.name_en?.trim() && row.name_en.toLowerCase() !== frVal.toLowerCase()) {
      enToFrMap.set(row.name_en.trim(), frVal);
    }
  }

  const jpReplacements = Array.from(jpToFrMap.entries()).sort((a, b) => b[0].length - a[0].length);
  const enReplacements = Array.from(enToFrMap.entries()).sort((a, b) => b[0].length - a[0].length);

  const replacements = (isJa ? jpReplacements : enReplacements).map(([term, frVal]) => ({
    term,
    lowerTerm: term.toLowerCase(),
    frVal,
  }));

  let processedText = inputText;
  const placeholderMap = new Map<string, string>();
  let placeholderIndex = 0;

  const regexCache = new Map<string, RegExp>();
  const globalRegexCache = new Map<string, RegExp>();
  const getRegex = (t: string) => {
    let r = regexCache.get(t);
    if (!r) {
      r = new RegExp("\\b" + escapeRegExp(t) + "\\b", "i");
      regexCache.set(t, r);
    }
    return r;
  };
  const getGlobalRegex = (t: string) => {
    let r = globalRegexCache.get(t);
    if (!r) {
      r = new RegExp("\\b" + escapeRegExp(t) + "\\b", "gi");
      globalRegexCache.set(t, r);
    }
    return r;
  };

  for (const { term, lowerTerm, frVal } of replacements) {
    let matches = false;
    if (isJa) {
      matches = processedText.includes(term);
    } else {
      if (processedText.toLowerCase().includes(lowerTerm)) {
        const regex = getRegex(term);
        matches = regex.test(processedText);
      }
    }

    if (matches) {
      const placeholder = ` [[T${placeholderIndex}]] `;
      placeholderMap.set(placeholder.trim(), frVal);

      if (isJa) {
        processedText = processedText.replaceAll(term, placeholder);
      } else {
        const regex = getGlobalRegex(term);
        processedText = processedText.replace(regex, placeholder);
      }
      placeholderIndex++;
    }
  }

  let translated = await translateWithGoogle(processedText, from, "fr");

  for (const [placeholder, frVal] of placeholderMap.entries()) {
    const cleanPlaceholder = placeholder.replace("[[", "").replace("]]", "").trim().toLowerCase();
    const num = cleanPlaceholder.replace("t", "");

    const dblRegex = new RegExp("\\[\\s*\\[\\s*[tT]\\s*" + num + "\\s*\\]\\s*\\]", "g");
    translated = translated.replace(dblRegex, frVal);

    const sglRegex = new RegExp("\\[\\s*[tT]\\s*" + num + "\\s*\\]", "g");
    translated = translated.replace(sglRegex, frVal);

    const rawRegex = new RegExp("\\b[tT]\\s*" + num + "\\b", "g");
    translated = translated.replace(rawRegex, frVal);
  }

  for (const [placeholder, frVal] of placeholderMap.entries()) {
    if (translated.includes(placeholder)) {
      translated = translated.replaceAll(placeholder, frVal);
    }
    const rawPlaceholder = placeholder.trim();
    if (translated.includes(rawPlaceholder)) {
      translated = translated.replaceAll(rawPlaceholder, frVal);
    }
  }

  translated = translated.replace(/\s+/g, " ").trim();
  return translated;
}
