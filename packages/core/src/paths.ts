import * as path from 'node:path';

/** A relative `target` resolves against `process.cwd()`, not `root`, so resolve it against the intended base first. */
export function isPathWithinRoot(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedRoot) {
    return true;
  }
  const relative = path.relative(resolvedRoot, resolvedTarget);
  // path.relative returns an absolute path for a Windows cross-drive target.
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
