/** Format generated source with the repository formatter (`bun fmt`). */
export const formatGeneratedFile = async (fileName, source) => {
  const result = Bun.spawnSync(
    [process.execPath, "fmt", `--stdin-filepath=${fileName}`],
    { stdin: new TextEncoder().encode(source), stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0)
    throw new Error(`Cannot format ${fileName}: ${result.stderr.toString()}`);
  return result.stdout.toString();
};
