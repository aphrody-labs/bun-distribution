// SPDX-License-Identifier: Apache-2.0
/**
 * @shenron/pipeline — Couche unifiée Offload (OCR, RAG, IA, Traduction, Crawl, IPC Bridge)
 * Conçu pour s'exécuter exclusivement hors du VPS principal (en local ou sur worker GPU).
 * Délègue l'interface utilisateur native au shell Aphrody.
 */





export * from "./bridge/index";
export * from "./execution";
export * from "./workflows";

export * from "./koharu";
export * from "./aphrody-ocr-candidate";
