import "@tsed/swagger";

import { MikroORM } from "@mikro-orm/postgresql";
import {
	Configuration,
	Inject,
	PlatformAcceptMimesMiddleware,
	PlatformApplication,
} from "@tsed/common";
import { PlatformExpress } from "@tsed/platform-express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";

import * as controllers from "@/api/controllers";
import { CorrelationIdMiddleware, HttpMetricsMiddleware, Log } from "@/api/middlewares";
import { urlsConfig } from "@/configs/urls";
import { env } from "@/env";
import { Database, PluginsManager, Store } from "@/services";
import { resolveDependency } from "@/utils/functions";

/**
 * Server TSed — bootstrappé directement (pas de @Service tsyringe).
 *
 * L'ancien @Service() + @Configuration créait un conflit DI :
 * - tsyringe construisait Server SANS injecter PlatformApplication.app
 * - TSed appelait $beforeRoutesInit sur l'instance tsyringe → app=undefined → crash.
 *
 * Solution : Server n'est plus dans tsyringe. PlatformExpress.bootstrap(Server) le crée
 * et injecte app correctement. Les services (pluginsManager, store, db) sont résolus
 * via resolveDependency() au moment de start() (post-DI init).
 */
@Configuration({
	middlewares: [cookieParser()],
})
export class Server {
	@Inject() app!: PlatformApplication;

	orm!: InstanceType<typeof MikroORM>;
	private pluginsManager!: PluginsManager;
	private store!: Store;

	$beforeRoutesInit() {
		this.app
			.use((req: Request, res: Response, next: NextFunction) => {
				const origin = req.headers.origin;
				if (origin && !urlsConfig.allowedOrigins.includes(origin)) {
					return res.status(403).json({ error: "cors_origin_forbidden" });
				}
				if (origin) {
					res.setHeader("Access-Control-Allow-Origin", origin);
					res.setHeader("Access-Control-Allow-Credentials", "true");
					res.setHeader("Vary", "Origin");
				}
				if (req.method === "OPTIONS") {
					res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE");
					res.setHeader(
						"Access-Control-Allow-Headers",
						"Authorization,Content-Type,X-CSRF-Token,X-Internal-Secret"
					);
					return res.sendStatus(204);
				}
				return next();
			})
			.use(bodyParser.json())
			.use(bodyParser.urlencoded({ extended: true }))
			.use(CorrelationIdMiddleware)
			.use(HttpMetricsMiddleware)
			.use(Log)
			.use(PlatformAcceptMimesMiddleware);

		return null;
	}

	async loadDependencies(): Promise<void> {
		this.pluginsManager = await resolveDependency(PluginsManager);
		this.store = await resolveDependency(Store);
		const db = await resolveDependency(Database);
		this.orm = db.orm;
	}

	/**
	 * Start API server — appelé directement depuis main.ts (sans tsyringe).
	 */
	static async start(): Promise<Awaited<ReturnType<typeof PlatformExpress.bootstrap>>> {
		const pluginsManager = await resolveDependency(PluginsManager);
		const port = env.NODE_ENV === "development" ? env.TEST_API_PORT : env.API_PORT;
		const host = env.API_HOST;

		const platform = await PlatformExpress.bootstrap(Server, {
			rootDir: __dirname,
			httpPort: `${host}:${port}`,
			httpsPort: false,
			acceptMimes: ["application/json"],
			mount: {
				"/": [...Object.values(controllers), ...pluginsManager.getControllers()],
			},
			swagger: [
				{
					path: "/docs",
					specVersion: "3.0.1",
				},
			],
			logger: {
				level: "warn",
				disableRoutesSummary: true,
			},
		});

		const serverInstance = platform.injector.get<Server>(Server);
		if (serverInstance) await serverInstance.loadDependencies();

		await platform.listen();
		console.info(`API listening on http://${host}:${port}`);

		const store = await resolveDependency(Store);
		store.update("ready", (e) => ({ ...e, api: true }));

		return platform;
	}
}
