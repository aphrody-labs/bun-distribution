import { UsageError } from "../../shared/args.ts";
import { LlmError } from "./video-translate/llm.ts";
import { ToolError } from "./video-translate/media.ts";
import { HELP, parseConfig } from "./video-translate/options.ts";
import { runPipeline } from "./video-translate/pipeline.ts";
import type { Command } from "./types.ts";

const command: Command = {
  name: "video-translate",
  summary: "Transcrire et traduire une vidéo vers l'anglais (sous-titres idiomatiques)",
  async run(argv) {
    const { config, help } = parseConfig(argv);
    if (help || !config) {
      console.log(HELP);
      return 0;
    }
    try {
      return await runPipeline(config, {
        env: process.env,
        io: { log: (line) => console.error(line), out: (line) => console.log(line) },
      });
    } catch (error) {
      if (error instanceof UsageError) throw error;
      if (error instanceof ToolError || error instanceof LlmError) {
        console.error(`video-translate : ${error.message}`);
        return 1;
      }
      throw error;
    }
  },
};

export default command;
