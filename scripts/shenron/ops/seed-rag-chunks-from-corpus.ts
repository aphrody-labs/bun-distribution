#!/usr/bin/env bun
/**
 * seed-rag-chunks-from-corpus.ts — Peuple rag_chunks dans bot.db depuis le corpus unifié Shenron.
 */

import { Database } from "bun:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const botDbPath = join(import.meta.dir, "../../apps/bot/data/bot.db");
const corpusJsonPath = join(import.meta.dir, "../../apps/bot/data/rag/corpus.json");
const massiveDbPath = join(import.meta.dir, "../../data/rag/massive-unified-index.db");

console.log("🐉 Initialisation de rag_chunks dans", botDbPath);
const db = new Database(botDbPath);

db.run(`
  CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks USING fts5(
    kind,
    title,
    url,
    content,
    lang,
    source_id,
    entity,
    tokenize='unicode61 remove_diacritics 2'
  )
`);

const existing = (db.query("SELECT count(*) as c FROM rag_chunks").get() as { c: number }).c;
console.log(`Chunks existants dans rag_chunks : ${existing}`);

if (existing === 0) {
  const insertStmt = db.prepare(`
    INSERT INTO rag_chunks (kind, title, url, content, lang, source_id, entity)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.run("BEGIN TRANSACTION");

  if (existsSync(corpusJsonPath)) {
    console.log("Lecture de", corpusJsonPath, "...");
    const raw = JSON.parse(readFileSync(corpusJsonPath, "utf-8"));
    const docs = raw.docs || [];
    console.log(`Insertion de ${docs.length} documents depuis corpus.json...`);

    for (const doc of docs) {
      const url = doc.url || "";
      const title = doc.name || doc.title || "";
      const content = doc.markdown || "";

      let kind = "wiki";
      let entity = "";
      if (url.includes("/personnages/")) {
        kind = "character";
        entity = url.split("/personnages/")[1]?.split("/")[0] || "";
      } else if (url.includes("/techniques/")) {
        kind = "technique";
        entity = url.split("/techniques/")[1]?.split("/")[0] || "";
      } else if (url.includes("/transformations/")) {
        kind = "transformation";
        entity = url.split("/transformations/")[1]?.split("/")[0] || "";
      } else if (url.includes("/sagas/")) {
        kind = "saga";
        entity = url.split("/sagas/")[1]?.split("/")[0] || "";
      } else if (url.includes("/cosmologie/")) {
        kind = "planet";
        entity = url.split("/cosmologie/")[1]?.split("/")[0] || "";
      } else if (url.includes("/races/")) {
        kind = "race";
        entity = url.split("/races/")[1]?.split("/")[0] || "";
      } else if (url.includes("/databooks/")) {
        kind = "databook";
        entity = "databook";
      } else if (url.includes("/canon")) {
        kind = "canon";
      }

      const lang = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(title + content) ? "ja" : "fr";
      const sourceId = url.includes("/databooks/") ? "databooks" : "wiki";

      insertStmt.run(kind, title, url, content, lang, sourceId, entity);
      inserted++;
    }
  }

  // Enrichissement complémentaire depuis massive-unified-index.db si disponible
  if (existsSync(massiveDbPath)) {
    console.log("Vérification des documents additionnels dans massive-unified-index.db...");
    const massiveDb = new Database(massiveDbPath, { readonly: true });
    const docs = massiveDb.query("SELECT id, title, url, source_type, markdown FROM unified_documents").all() as any[];
    console.log(`Examen de ${docs.length} documents dans massive-unified-index...`);

    const knownUrls = new Set((db.query("SELECT url FROM rag_chunks WHERE url != ''").all() as any[]).map(r => r.url));
    let addedMassive = 0;

    for (const doc of docs) {
      if (knownUrls.has(doc.url)) continue;
      knownUrls.add(doc.url);

      const url = doc.url || "";
      const title = doc.title || "";
      const content = doc.markdown || "";
      const sourceId = doc.source_type || "massive";
      const kind = sourceId.includes("databook") ? "databook" : "wiki";
      const lang = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(title + content) ? "ja" : "fr";

      insertStmt.run(kind, title, url, content, lang, sourceId, "");
      inserted++;
      addedMassive++;
    }
    console.log(`Ajouté ${addedMassive} documents additionnels depuis massive-unified-index.`);
    massiveDb.close();
  }

  db.run("COMMIT");
  console.log(`✓ rag_chunks initialisé avec succès : ${inserted} passages.`);
}

const finalCount = (db.query("SELECT count(*) as c FROM rag_chunks").get() as { c: number }).c;
console.log(`Total final dans rag_chunks : ${finalCount}`);
db.close();
