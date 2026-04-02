#!/usr/bin/env node
import {
  createPreviewCommand,
  createReleaseCommand
} from "./chunk-ALHJU3KL.js";
import {
  EXIT_CODES,
  error,
  info,
  readPackageVersion,
  success
} from "./chunk-D6HRZXZZ.js";

// src/dispatcher.ts
import { realpathSync } from "fs";
import { fileURLToPath } from "url";
import { createNotesCommand } from "@releasekit/notes/cli";
import { createPublishCommand } from "@releasekit/publish/cli";
import { createVersionCommand } from "@releasekit/version/cli";
import { Command as Command2 } from "commander";

// src/init-command.ts
import * as fs from "fs";
import { detectMonorepo } from "@releasekit/notes";
import { Command } from "commander";
function createInitCommand() {
  return new Command("init").description("Create a default releasekit.config.json").option("-f, --force", "Overwrite existing config").action((options) => {
    const configPath = "releasekit.config.json";
    if (fs.existsSync(configPath) && !options.force) {
      error(`Config file already exists at ${configPath}. Use --force to overwrite.`);
      process.exit(EXIT_CODES.GENERAL_ERROR);
    } else {
      let changelogMode;
      try {
        const detected = detectMonorepo(process.cwd());
        changelogMode = detected.isMonorepo ? "packages" : "root";
        info(
          detected.isMonorepo ? "Monorepo detected \u2014 using mode: packages" : "Single-package repo detected \u2014 using mode: root"
        );
      } catch {
        changelogMode = "root";
        info("Could not detect project type \u2014 using mode: root");
      }
      let packageName;
      try {
        const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
        packageName = pkg.name;
      } catch {
      }
      const isScoped = packageName?.startsWith("@") ?? false;
      const defaultConfig = {
        $schema: "https://goosewobbler.github.io/releasekit/schema.json",
        notes: {
          changelog: {
            mode: changelogMode
          }
        },
        publish: {
          npm: {
            enabled: true,
            ...isScoped ? { access: "public" } : {}
          }
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), "utf-8");
      success(`Created ${configPath}`);
    }
  });
}

// src/dispatcher.ts
function createDispatcherProgram() {
  const program = new Command2().name("releasekit").description("Unified release pipeline: version, changelog, and publish").version(readPackageVersion(import.meta.url));
  program.addCommand(createReleaseCommand(), { isDefault: true });
  program.addCommand(createPreviewCommand());
  program.addCommand(createInitCommand());
  program.addCommand(createVersionCommand());
  program.addCommand(createNotesCommand());
  program.addCommand(createPublishCommand());
  return program;
}
var isMain = (() => {
  try {
    return process.argv[1] ? realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) : false;
  } catch {
    return false;
  }
})();
if (isMain) {
  createDispatcherProgram().parse();
}
export {
  createDispatcherProgram
};
