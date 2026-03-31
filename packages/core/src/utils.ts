/**
 * Normalize a scoped npm package name into a tag-safe string.
 * "@scope/pkg" → "scope-pkg", "pkg" → "pkg"
 */
export function sanitizePackageName(name: string): string {
  return name.startsWith('@') ? name.slice(1).replace(/\//g, '-') : name;
}
