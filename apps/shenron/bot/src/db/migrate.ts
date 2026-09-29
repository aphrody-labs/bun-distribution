import "reflect-metadata";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { container } from "tsyringe";
import { DatabaseService } from "./index";
import { join } from "node:path";

const svc = container.resolve(DatabaseService);
migrate(svc.db, { migrationsFolder: join(import.meta.dir, "migrations") });
console.log("✓ Migrations applied");
svc.close();
