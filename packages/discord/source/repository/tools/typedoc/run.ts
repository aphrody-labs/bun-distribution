const typedoc = `${import.meta.dir}/node_modules/.bin/typedoc`;
const child = Bun.spawn([process.execPath, typedoc, ...process.argv.slice(2)], {
	cwd: process.cwd(),
	stdin: 'inherit',
	stdout: 'inherit',
	stderr: 'inherit',
});

process.exit(await child.exited);
