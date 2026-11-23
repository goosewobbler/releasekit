import { formatVersionPrefix } from './formatting.js';

export interface ReleasedPackage {
  name: string;
  version: string;
}

const PLACEHOLDER = /\$\{(?:version|packageName|scope)\}/;

/**
 * The release commit's message. A template with placeholders gets `${packageName}` as the released names and
 * `${version}` as the first released version. One without them is followed by the names and the shared version, or by
 * each `name@version` when the versions differ.
 */
export function formatReleaseCommitMessage(
  template: string,
  released: ReleasedPackage[],
  options: { versionPrefix: string; version?: string },
): string {
  const version = options.version ?? released[0]?.version ?? '';
  const names = released.map((pkg) => pkg.name).join(', ');
  let message: string;
  if (PLACEHOLDER.test(template)) {
    message = template
      .replace(/\$\{version\}/g, version)
      .replace(/\$\{packageName\}/g, names)
      .replace(/\$\{scope\}/g, '');
  } else if (released.every((pkg) => pkg.version === version)) {
    message = `${template} ${names} ${formatVersionPrefix(options.versionPrefix)}${version}`;
  } else {
    message = `${template} ${released.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}`;
  }
  // Collapse the gap an empty ${packageName} leaves (e.g. 'chore: release  v1.0.0').
  return message.replace(/\s{2,}/g, ' ').trim();
}
