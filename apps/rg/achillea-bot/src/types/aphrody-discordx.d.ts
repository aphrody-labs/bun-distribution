// Complément de types pour `@aphrody/discordx` (npm public).
//
// Le build runtime du package (dist/index.mjs) EXPORTE bien `DIService`,
// `tsyringeDependencyRegistryEngine` et les types de décorateurs, mais ses fichiers de
// déclaration `.d.ts` ne les ré-exportent pas (l'ancien `@rose-griffon/discordx@0.1.1` le
// faisait). `tsc` échoue alors que l'exécution fonctionne → on réaligne les types ici.
//
// `export {}` en fin de fichier → le fichier est traité comme un module, donc le
// `declare module` ci-dessous est une AUGMENTATION (ajout d'exports) et non un
// remplacement (les exports d'origine — Client, MetadataStorage… — sont conservés).
//
// NB : à supprimer si `@aphrody/discordx` est republié avec des `.d.ts` complets.
declare module "@aphrody/discordx" {
	export interface IDependencyRegistryEngine {
		clearAllServices(): void;
		getService<T = unknown>(classType: unknown): T | null;
		getAllServices(): Set<unknown>;
		addService<T = unknown>(classType: unknown, instance: T): void;
		setInjector(injector: unknown): IDependencyRegistryEngine;
	}

	export const tsyringeDependencyRegistryEngine: IDependencyRegistryEngine;
	export const DIService: { engine: IDependencyRegistryEngine };

	// Types de décorateurs (issus de `@discordx/internal`). Params volontairement larges :
	// ce sont des signatures de décorateurs runtime, le shim doit accepter les diverses
	// implémentations des wrappers (On/Once/SlashGroup) sans contrainte de variance.
	/* eslint-disable @typescript-eslint/no-explicit-any */
	export type ClassDecoratorEx = <T extends abstract new (...args: never[]) => unknown>(
		target: T
	) => T | void;
	export type MethodDecoratorEx = (target: any, propertyKey: any, descriptor?: any) => void;
	export type ParameterDecoratorEx = (
		target: any,
		propertyKey: any,
		parameterIndex: number
	) => void;
	export type ClassMethodDecorator = ClassDecoratorEx & MethodDecoratorEx;
	/* eslint-enable @typescript-eslint/no-explicit-any */
}

export {};
