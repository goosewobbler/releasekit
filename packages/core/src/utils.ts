/**
 * Normalize a scoped npm package name into a tag-safe string.
 * "@scope/pkg" → "scope-pkg", "pkg" → "pkg"
 */
export function sanitizePackageName(name: string): string {
  return name.startsWith('@') ? name.slice(1).replace(/\//g, '-') : name;
}

/**
 * Reject a value a getopt/cobra-style CLI (git, gh) would parse as an option flag instead of a
 * positional. `execFile`/`execFileSync` spawn with no shell, so there's no shell injection, but a
 * leading-`-` positional still becomes argument injection: `gh release` exposes `-R/--repo` and
 * `-F/--notes-file`, so a tag of `--repo=evil` or `-F/etc/passwd` would be read as a flag. Tag, ref,
 * and package names can never legitimately start with `-`, so we refuse them before the value reaches
 * the argv. Mirrors git's own assertNotOption barrier for the gh call sites (publish + notes-backfill).
 */
export function assertNotOption(value: string, kind: string): void {
  if (value.startsWith('-')) {
    throw new Error(`Refusing to run: ${kind} '${value}' looks like an option (starts with '-')`);
  }
}
