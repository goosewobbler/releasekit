#!/usr/bin/env node
import {
  createPreviewCommand,
  createReleaseCommand
} from "./chunk-FEMWVXXM.js";
import {
  readPackageVersion
} from "./chunk-6UI4L62T.js";
import {
  init_esm_shims
} from "./chunk-NOZSTVTV.js";

// src/cli.ts
init_esm_shims();
import { realpathSync } from "fs";
import { fileURLToPath } from "url";
import { Command } from "commander";
function createReleaseProgram() {
  return new Command().name("releasekit-release").description("Unified release pipeline: version, changelog, and publish").version(readPackageVersion(import.meta.url)).addCommand(createReleaseCommand(), { isDefault: true }).addCommand(createPreviewCommand());
}
var isMain = (() => {
  try {
    return process.argv[1] ? realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) : false;
  } catch {
    return false;
  }
})();
if (isMain) {
  createReleaseProgram().parse();
}
export {
  createReleaseProgram
};
