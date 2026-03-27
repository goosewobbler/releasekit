/**
 * Formatting utilities for releasekit-version
 */

import { log } from './logging.js';

/**
 * Escapes special characters in a string to be used in a RegExp safely
 * Prevents regex injection when using user-provided strings in RegExp constructors
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Format a version prefix by ensuring it doesn't end with a slash
 */
export function formatVersionPrefix(prefix: string): string {
  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
}

/**
 * Format a tag based on the provided parameters
 */
export function formatTag(
  version: string,
  prefix: string,
  packageName?: string | null,
  template?: string,
  packageSpecificTags?: boolean,
): string {
  // Strip @ prefix from package names for tags (e.g., @releasekit/version -> releasekit-version)
  const sanitizedPackageName = packageName?.startsWith('@') ? packageName.slice(1).replace(/\//g, '-') : packageName;

  // Show context-specific warning if template uses packageName but no package name is available
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

  // Default template logic
  if (packageSpecificTags && sanitizedPackageName) {
    return `${sanitizedPackageName}@${prefix}${version}`;
  }

  return `${prefix}${version}`;
}

/**
 * Format a commit message based on the provided parameters
 */
export function formatCommitMessage(
  template: string,
  version: string,
  packageName?: string | null,
  additionalContext?: Record<string, string>,
): string {
  // Show context-specific warning if template uses packageName but no package name is available
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

  // Apply additional context if provided
  if (additionalContext) {
    for (const [key, value] of Object.entries(additionalContext)) {
      const placeholder = `${key ? `\${${key}}` : ''}`;
      result = result.replace(new RegExp(escapeRegExp(placeholder), 'g'), value);
    }
  }

  return result;
}

/**
 * Format a tag prefix for git tag searching
 */
export function formatTagPrefix(
  prefix: string,
  packageName?: string | null,
  template?: string,
  packageSpecificTags?: boolean,
): string {
  // Strip @ prefix from package names for tags (e.g., @releasekit/version -> releasekit-version)
  const sanitizedPackageName = packageName?.startsWith('@') ? packageName.slice(1).replace(/\//g, '-') : packageName;

  if (template) {
    // For template-based tags, we need to create a prefix pattern
    // Replace version with * and packageName with actual name or *
    return template
      .replace(/\$\{version\}/g, '*')
      .replace(/\$\{prefix\}/g, prefix)
      .replace(/\$\{packageName\}/g, sanitizedPackageName || '*');
  }

  // Default prefix logic
  if (packageSpecificTags && sanitizedPackageName) {
    return `${sanitizedPackageName}@${prefix}`;
  }

  return prefix;
}
