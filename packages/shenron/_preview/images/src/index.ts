export { hashFile, hashBuffer, dHash, hammingDistance } from "./hash";
export { bestVariant, variantScore, coversResolution, type ImageVariant } from "./variants";
export {
	dbPathToDisk,
	diskToDbPath,
	dbPathToUrlPath,
	normalizeDbPath,
	isImagePath,
	IMAGE_EXTENSIONS,
	type AssetRoots,
} from "./resolve";
export { provePixelEquality, prouverEgalitePixels, psnr, type PixelEqualityResult } from "./pixels";
export { toWebp, type ToWebpOptions, type ToWebpResult } from "./webp";
export {
	selectionnerIllustration,
	selectIllustration,
	scoreCandidate,
	type IllustrationSource,
	type IllustrationEntity,
	type IllustrationCandidate,
	type IllustrationProvider,
	type SelectIllustrationInput,
	type SelectedIllustration,
} from "./select";
