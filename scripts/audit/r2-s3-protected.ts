// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Provider mutations and cleanup are deliberately sequential. */
import { S3Client } from "bun";

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY)
  throw new Error("Protected R2 credentials are incomplete");
for (const bucket of ["aphrody-assets", "aphrody-dist"]) {
  const client = new S3Client({
    bucket,
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    region: "auto",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  });
  const key = `_aphrody-qualification/${crypto.randomUUID()}.txt`;
  let created = false;
  try {
    const listing = await client.list({ maxKeys: 1 });
    const existing = listing.contents?.[0]?.key;
    if (existing) await client.file(existing).stat();
    const payload = `Aphrody R2 qualification ${crypto.randomUUID()}`;
    await client.file(key).write(payload);
    created = true;
    await client.file(key).stat();
    if ((await client.file(key).text()) !== payload) throw new Error("R2 probe read mismatch");
    await client.file(key).delete();
    created = false;
    console.log(
      JSON.stringify({
        bucket,
        list: true,
        head: true,
        write: true,
        read: true,
        deletedProbe: true,
      }),
    );
  } finally {
    if (created) await client.file(key).delete();
  }
}
