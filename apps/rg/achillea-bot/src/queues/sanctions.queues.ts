import { Queue } from "bullmq";

import { PREFIXE_FILES, redisConnection } from "@/configs";

export const sanctionsQueue = new Queue("sanctions", { connection: redisConnection, prefix: PREFIXE_FILES });
