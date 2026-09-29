// Déclaration ambiante pour @casl/ability : le bot conserve
// `moduleResolution=Node`, tandis que le paquet publie ses types sous `exports`.
declare module "@casl/ability" {
	export * from "@casl/ability/dist/types/index";
}
