#!/usr/bin/env bun
import { build, diagnose, exefs, extract, extractAll, h3d, identify, list, plugins, toPng } from "./index";

const usage =
  "usage: ds-dotnet build | plugins | identify <file> | list <file> | extract <file> <entry> <out> | extract-all <file> <dir> | png <file> <out> [entry] | h3d <file> | exefs <file> <dir>";
const pretty = (value: unknown) => console.log(JSON.stringify(value, null, 2));

/** Runs the ds-dotnet command line; returns the process exit code. */
export function main(argv: string[]): number {
  const [command, ...rest] = argv;
  switch (command) {
    case "build":
      console.log(build());
      break;
    case "diagnose":
      pretty(diagnose());
      break;
    case "plugins":
      pretty(plugins());
      break;
    case "identify":
      pretty(identify(rest[0]!));
      break;
    case "list":
      pretty(list(rest[0]!, rest[1]));
      break;
    case "extract":
      pretty(extract(rest[0]!, rest[1]!, rest[2]!));
      break;
    case "extract-all":
      pretty(extractAll(rest[0]!, rest[1]!));
      break;
    case "png":
      pretty(toPng(rest[0]!, rest[1]!, rest[2]));
      break;
    case "h3d":
      pretty(h3d(rest[0]!));
      break;
    case "exefs":
      pretty(exefs(rest[0]!, rest[1]!));
      break;
    default:
      console.error(usage);
      return command ? 1 : 0;
  }
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
