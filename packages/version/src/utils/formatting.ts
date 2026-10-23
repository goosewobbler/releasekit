import { sanitizePackageName } from '@releasekit/core';
import { log } from './logging.js';

export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatVersionPrefix(prefix: string): string {
  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
}

export function formatTag(
  version: string,
  prefix: string,
  packageName?: string | null,
  template?: string,
  packageSpecificTags?: boolean,
): string {
  const sanitizedPackageName = packageName ? sanitizePackageName(packageName) : packageName;

  if (template?.includes('${' + 'packageName}') && !packageName) {
    log(
      `Warning: Your tagTemplate contains \${packageName} but no package name is available.\n` +
        `This will result in an empty package name in the tag (e.g., "@v1.0.0" instead of "my-package@v1.0.0").\n\n` +
        `To fix this:\n` +
        `• If using sync mode: Set "packageSpecificTags": true in your config to enable package names in tags\n` +
        `• If you want global tags: Remove \${packageName} from your tagTemplate (e.g., use "\${prefix}\${version}")\n` +
        `• If using single/async mode: Ensure your package.json has a valid "name" field`,
      'warning',
    );
  }

  if (template) {
    return template
      .replace(/\$\{version\}/g, version)
      .replace(/\$\{prefix\}/g, prefix)
      .replace(/\$\{packageName\}/g, sanitizedPackageName || '');
  }

  if (packageSpecificTags && sanitizedPackageName) {
    return `${sanitizedPackageName}@${prefix}${version}`;
  }

  return `${prefix}${version}`;
}

export function formatCommitMessage(
  template: string,
  version: string,
  packageName?: string | null,
  additionalContext?: Record<string, string>,
): string {
  if (template.includes('${' + 'packageName}') && !packageName) {
    log(
      `Warning: Your commitMessage template contains \${packageName} but no package name is available.\n` +
        `This will result in an empty package name in the commit message (e.g., "Release @v1.0.0").\n\n` +
        `To fix this:\n` +
        `• If using sync mode: Set "packageSpecificTags": true to enable package names in commits\n` +
        `• If you want generic commit messages: Remove \${packageName} from your commitMessage template\n` +
        `• If using single/async mode: Ensure your package.json has a valid "name" field`,
      'warning',
    );
  }

  let result = template.replace(/\$\{version\}/g, version).replace(/\$\{packageName\}/g, packageName || '');

  if (additionalContext) {
    for (const [key, value] of Object.entries(additionalContext)) {
      const placeholder = `${key ? `\${${key}}` : ''}`;
      result = result.replace(new RegExp(escapeRegExp(placeholder), 'g'), value);
    }
  }

  return result;
}

export function formatTagPrefix(
  prefix: string,
  packageName?: string | null,
  template?: string,
  packageSpecificTags?: boolean,
): string {
  const sanitizedPackageName = packageName ? sanitizePackageName(packageName) : packageName;

  if (template) {
    return template
      .replace(/\$\{version\}/g, '*')
      .replace(/\$\{prefix\}/g, prefix)
      .replace(/\$\{packageName\}/g, sanitizedPackageName || '*');
  }

  if (packageSpecificTags && sanitizedPackageName) {
    return `${sanitizedPackageName}@${prefix}`;
  }

  return prefix;
}

export function buildTagStripPatternFromTemplate(template: string, packageName: string, prefix: string): string {
  if (!template) {
    return '';
  }

  const sanitizedPackageName = packageName ? sanitizePackageName(packageName) : packageName;

  /* biome-ignore lint/suspicious/noTemplateCurlyInString: searching for literal template placeholder */
  const versionIndex = template.indexOf('${version}');
  if (versionIndex === -1) {
    const prefixPattern = template
      .replace(/\$\{packageName\}/g, sanitizedPackageName || '')
      .replace(/\$\{prefix\}/g, prefix);
    return escapeRegExp(prefixPattern);
  }

  const prefixPart = template.substring(0, versionIndex);
  const prefixPattern = prefixPart
    .replace(/\$\{packageName\}/g, sanitizedPackageName || '')
    .replace(/\$\{prefix\}/g, prefix);

  return escapeRegExp(prefixPattern);
}

/** Filters `getSemverTags`'s scan to the baseline family and recognises baseline tags when stripping for display. */
export function deriveBaselineTagPrefix(
  template: string | undefined,
  formattedPrefix: string,
  packageName?: string,
): string | undefined {
  if (!template) {
    return undefined;
  }
  return template
    .split('${' + 'version}')[0]
    .replace(/\$\{prefix\}/g, formattedPrefix)
    .replace(/\$\{packageName\}/g, packageName ? sanitizePackageName(packageName) : '');
}

/** Display form of a baseline tag (`release/v1.2.3` → `v1.2.3`); git ranges keep using the raw tag. */
export function displayTag(tag: string, baselineTagPrefix: string | undefined, formattedPrefix: string): string {
  if (!baselineTagPrefix || !tag.startsWith(baselineTagPrefix)) {
    return tag;
  }
  return `${formattedPrefix}${tag.slice(baselineTagPrefix.length)}`;
}
