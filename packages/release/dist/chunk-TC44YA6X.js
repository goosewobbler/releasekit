import {
  init_esm_shims
} from "./chunk-NOZSTVTV.js";

// ../version/dist/chunk-LMPZV35Z.js
init_esm_shims();
import { execFile, execFileSync } from "child_process";
var execAsync = (file, args, options) => {
  const defaultOptions = { maxBuffer: 1024 * 1024 * 10, ...options };
  return new Promise((resolve, reject) => {
    execFile(file, args, defaultOptions, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      }
    });
  });
};
var execSync = (file, args, options) => execFileSync(file, args, { maxBuffer: 1024 * 1024 * 10, ...options });

export {
  execAsync,
  execSync
};
