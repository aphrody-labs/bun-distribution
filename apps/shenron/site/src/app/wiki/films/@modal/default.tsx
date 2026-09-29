// Slot `@modal` inactif (pas d'interception en cours) → rien. Requis par Next
// pour que le rendu pleine page de `/wiki/films/[slug]` et de `/wiki/films` ne
// 404 pas sur le slot parallèle.
export default function Default() {
	return null;
}
