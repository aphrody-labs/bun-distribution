import type { AchilleaTables } from "./achillea";
import type { PublicTables } from "./public";
import type { InagleTables } from "./inagle";

export type Database = AchilleaTables & PublicTables & InagleTables;
export type DB = Database;

export * from "./achillea";
export * from "./public";
export * from "./inagle";
