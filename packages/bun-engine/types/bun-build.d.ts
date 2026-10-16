import "bun";

declare module "bun" {
  interface CompileBuildOptions {
    assets?: string[];
    autoloadTsconfig?: boolean;
    autoloadPackageJson?: boolean;
    bytecodeOrder?: string | string[] | false | null;
  }
}
