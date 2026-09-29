const tsup = `${import.meta.dir}/node_modules/.bin/tsup`;
const child = Bun.spawn([process.execPath, tsup, ...process.argv.slice(2)], {
	cwd: process.cwd(),
	stdin: 'inherit',
	stdout: 'inherit',
	stderr: 'inherit',
});

process.exit(await child.exited);
