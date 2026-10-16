/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { createBunSql, createInagleBunSql } from "@rosegriffon/db/bun-sql";

export const sql = createBunSql();
export const inagleSql = createInagleBunSql();
