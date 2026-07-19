import * as path from 'node:path';

/**
 * True when `target` resolves to `root` itself or a path nested within it.
 *
 * Used to confine config-driven filesystem access — manifest write targets (`version.cargo.paths` /
 * `version.pub.paths`), `npm.copyFiles` destinations, and `{file:}` reads — to the repository root so
 * a malicious or mistaken config cannot drive reads/writes outside the tree via `..` or an absolute
 * path. Both paths are resolved to absolute form first, so a relative `target` is interpreted
 * against `process.cwd()` unless the caller has already resolved it against the intended base.
 */
export function isPathWithinRoot(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedRoot) {
    return true;
  }
  const relative = path.relative(resolvedRoot, resolvedTarget);
  // The equal case already returned, so `relative` is non-empty here. `..` / `../…` catch parent
  // escapes; isAbsolute catches a Windows cross-drive target (path.relative returns an absolute path
  // when root and target are on different drives).
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
