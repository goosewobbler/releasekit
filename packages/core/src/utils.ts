export function sanitizePackageName(name: string): string {
  return name.startsWith('@') ? name.slice(1).replace(/\//g, '-') : name;
}

/**
 * `execFile` spawns with no shell, but a leading-`-` positional is still argument injection into git/gh. Tag, ref
 * and package names never legitimately start with `-`.
 */
export function assertNotOption(value: string, kind: string): void {
  if (value.startsWith('-')) {
    throw new Error(`Refusing to run: ${kind} '${value}' looks like an option (starts with '-')`);
  }
}
