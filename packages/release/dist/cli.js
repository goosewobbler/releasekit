#!/usr/bin/env node
import {
  createPreviewCommand,
  createReleaseCommand
} from "./chunk-ALHJU3KL.js";
import {
  readPackageVersion
} from "./chunk-D6HRZXZZ.js";

// src/cli.ts
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
