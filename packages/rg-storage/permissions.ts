/** Permissions for copying or moving an object between storage buckets. */
export async function canTransferObject(
  operation: "copy" | "move",
  sourceBucket: string,
  sourceName: string,
  destinationBucket: string,
  destinationName: string,
  access: {
    canRead(bucket: string): Promise<boolean>;
    canWrite(bucket: string, name: string): Promise<boolean>;
  },
): Promise<boolean> {
  if (!(await access.canRead(sourceBucket))) return false;
  if (operation === "move" && !(await access.canWrite(sourceBucket, sourceName))) return false;
  return access.canWrite(destinationBucket, destinationName);
}
