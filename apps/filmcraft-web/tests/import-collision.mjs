// #194 regression: same-name/same-size imports must retain independent sources across OPFS recovery.
// evaluate(expression) awaits a browser expression; navigate(url) waits for FilmCraft readiness. Generated PCM16 mono WAVs only; no binary fixtures.

function tone(frequency, seconds) {
  // RIFF/WAVE PCM16 mono: 44-byte header + 2 bytes/sample; fixture matches #194 (48 kHz, amplitude 12000).
  const rate = 48000,
    bytesPerSample = 2,
    samples = rate * seconds;
  const b = new Uint8Array(44 + samples * bytesPerSample);
  const view = new DataView(b.buffer);
  const encoder = new TextEncoder();
  b.set(encoder.encode("RIFF"), 0);
  view.setUint32(4, b.length - 8, true);
  b.set(encoder.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  b.set(encoder.encode("data"), 36);
  view.setUint32(40, samples * bytesPerSample, true);
  for (let i = 0; i < samples; i++)
    view.setInt16(
      44 + bytesPerSample * i,
      Math.round(12000 * Math.sin((2 * Math.PI * frequency * i) / rate)),
      true,
    );
  return b;
}

export async function checkImportCollision({
  evaluate,
  navigate,
  url,
  timeoutMs = 120000,
}) {
  const fixtures = [tone(440, 2), tone(880, 2)];
  const hashes = fixtures.map((b) =>
    new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  );
  const report = {
    hashes,
    fixtureBytes: fixtures.map((b) => b.length),
    gates: {},
  };
  const hash = (expression) =>
    evaluate(
      `(async () => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", ${expression})), b => b.toString(16).padStart(2, "0")).join(""))()`,
    );
  const readHash = (path) =>
    hash(`await filmcraft.readFile(${JSON.stringify(path)})`);
  const importFile = (index) =>
    evaluate(
      `filmcraft.importFiles([new File([Uint8Array.from(atob(${JSON.stringify(fixtures[index].toBase64())}), c => c.charCodeAt(0))], "collision.wav", {type: "audio/wav"})])`,
    );
  await evaluate(
    'filmcraft.execute("file.newProject", {name: "Import collision"})',
  );
  const a = await importFile(0);
  report.a = a;
  if (a.errors?.length || !a.items?.length)
    throw new Error("baseline import failed: " + JSON.stringify(a));
  report.initialHash = await readHash(a.paths[0]);
  report.gates.healthyInitial = report.initialHash === hashes[0];
  await evaluate(
    `filmcraft.execute("file.newSequence", {name: "Original A", fromItem: ${a.items[0]}})`,
  );
  const b = await importFile(1);
  report.b = b;
  if (b.errors?.length || !b.items?.length)
    throw new Error("second import failed: " + JSON.stringify(b));
  report.afterBHash = await readHash(a.paths[0]);
  report.gates.distinctPaths = a.paths[0] !== b.paths[0];
  report.gates.originalPreserved = report.afterBHash === hashes[0];
  report.beforeProject = await evaluate('filmcraft.execute("project.inspect")');
  const revision = report.beforeProject.revision;
  const deadline = Date.now() + timeoutMs;
  const persistencePollMs = 100;
  for (;;) {
    const snapshot = await evaluate(`(async () => {
      try {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("recovery");
        const read = async name => JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());
        return {meta: await read("meta.json"), project: await read("snapshot.fcproj")};
      } catch (e) {return {error: String(e)};}
    })()`);
    report.recoveryMeta = snapshot.meta;
    if (
      snapshot.meta?.dirty &&
      snapshot.meta.revision === revision &&
      JSON.stringify(snapshot.project).includes("Original A")
    )
      break;
    if (Date.now() >= deadline)
      throw new Error(
        "Recovery persistence gate failed: " + JSON.stringify(snapshot),
      );
    await Bun.sleep(persistencePollMs);
  }
  // Media writes run separately from the snapshot queue; gate their actual bytes before navigation.
  for (;;) {
    report.opfs = await evaluate(`(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("media");
      const files = [];
      for await (const [name, handle] of dir.entries()) {
        const bytes = await (await handle.getFile()).arrayBuffer();
        files.push({name, hash: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("")});
      }
      return files;
    })()`);
    // Before the fix, A and B intentionally share the same path; qualify the last write there.
    const expected = new Map([
      [a.paths[0], hashes[0]],
      [b.paths[0], hashes[1]],
    ]);
    if (
      [...expected].every(([path, digest]) =>
        report.opfs.some(
          (f) => f.name === path.slice("/files/".length) && f.hash === digest,
        ),
      )
    )
      break;
    if (Date.now() >= deadline)
      throw new Error(
        "Imported media did not reach OPFS: " + JSON.stringify(report.opfs),
      );
    await Bun.sleep(persistencePollMs);
  }
  const recoveryUrl = new URL(url);
  recoveryUrl.searchParams.delete("fresh");
  recoveryUrl.searchParams.delete("norecover");
  await navigate(recoveryUrl.href);
  report.recovered = await evaluate('filmcraft.execute("project.inspect")');
  report.afterReload = {
    a: await readHash(a.paths[0]),
    b: await readHash(b.paths[0]),
  };
  report.gates.recoveredProject = JSON.stringify(report.recovered).includes(
    "Original A",
  );
  report.gates.recoveredSources =
    report.afterReload.a === hashes[0] && report.afterReload.b === hashes[1];
  report.ok = Object.values(report.gates).every(Boolean);
  return report;
}
