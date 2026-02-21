import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from '../utils/logging.js';
import { formatChangelogEntries } from './formatters.js';

/**
 * Changelog entry structure
 */
export interface ChangelogEntry {
  type: 'added' | 'changed' | 'deprecated' | 'removed' | 'fixed' | 'security';
  description: string;
  issueIds?: string[]; // Optional related issue IDs
  scope?: string; // Optional scope for Angular format
  originalType?: string; // Original commit type for Angular format
}

/**
 * Changelog version structure
 */
export interface ChangelogVersion {
  version: string;
  date: string;
  entries: ChangelogEntry[];
}

/**
 * Changelog structure
 */
export interface Changelog {
  projectName: string;
  unreleased: ChangelogEntry[];
  versions: ChangelogVersion[];
}

/**
 * Changelog format options
 */
export type ChangelogFormat = 'keep-a-changelog' | 'angular';

/**
 * Create a new changelog
 */
export function createChangelog(_packagePath: string, packageName: string): Changelog {
  return {
    projectName: packageName,
    unreleased: [],
    versions: [],
  };
}

/**
 * Parse an existing changelog file
 */
export function parseChangelog(filePath: string): Changelog | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    // Read the file but don't use the content yet since we're stubbing the parsing
    fs.readFileSync(filePath, 'utf8');

    // TODO: Implement proper parsing logic
    // This is a placeholder implementation

    log(`Parsed changelog at ${filePath}`, 'info');

    // For now, return a basic structure
    return {
      projectName: path.basename(path.dirname(filePath)),
      unreleased: [],
      versions: [],
    };
  } catch (error) {
    log(`Error parsing changelog: ${error instanceof Error ? error.message : String(error)}`, 'error');
    return null;
  }
}

/**
 * Generate a link section for the changelog
 */
function generateLinks(changelog: Changelog, repoUrl?: string): string {
  if (!repoUrl || changelog.versions.length === 0) {
    return '';
  }

  let links = '\n';

  // Add unreleased link
  if (changelog.unreleased.length > 0) {
    const latestVersion = changelog.versions[0]?.version || '';
    links += `[unreleased]: ${repoUrl}/compare/v${latestVersion}...HEAD\n`;
  }

  // Add version comparison links
  for (let i = 0; i < changelog.versions.length; i++) {
    const currentVersion = changelog.versions[i].version;
    const previousVersion = changelog.versions[i + 1]?.version;

    if (previousVersion) {
      links += `[${currentVersion}]: ${repoUrl}/compare/v${previousVersion}...v${currentVersion}\n`;
    } else if (i === changelog.versions.length - 1) {
      // First version
      links += `[${currentVersion}]: ${repoUrl}/releases/tag/v${currentVersion}\n`;
    }
  }

  return links;
}

/**
 * Generate Angular-style changelog
 */
function generateAngularChangelogContent(changelog: Changelog, repoUrl?: string): string {
  let content = '# Changelog\n\n';

  // Add unreleased changes if any
  if (changelog.unreleased.length > 0) {
    content += '## [Unreleased]\n\n';

    // Group entries by Angular type (feat, fix, perf)
    const groupedByType = groupEntriesByAngularType(changelog.unreleased);

    // Add entries by type
    for (const [type, entries] of Object.entries(groupedByType)) {
      content += `### ${formatAngularType(type)}\n\n`;

      // Group by scope
      const groupedByScope = groupEntriesByScope(entries);

      for (const [scope, scopeEntries] of Object.entries(groupedByScope)) {
        if (scope !== 'undefined' && scope !== '') {
          content += `* **${scope}:**\n`;
          for (const entry of scopeEntries) {
            content += formatAngularEntry(entry, false);
          }
          content += '\n';
        } else {
          // No scope
          for (const entry of scopeEntries) {
            content += formatAngularEntry(entry, true);
          }
        }
      }

      content += '\n';
    }

    // Add breaking changes section if any
    const breakingChanges = changelog.unreleased.filter((entry) => entry.description.includes('**BREAKING**'));

    if (breakingChanges.length > 0) {
      content += '### BREAKING CHANGES\n\n';
      for (const entry of breakingChanges) {
        // Remove the **BREAKING** prefix for this section
        const description = entry.description.replace('**BREAKING** ', '');
        content += `* ${entry.scope ? `**${entry.scope}:** ` : ''}${description}`;
        if (entry.issueIds && entry.issueIds.length > 0) {
          content += ` (${entry.issueIds.join(', ')})`;
        }
        content += '\n';
      }
      content += '\n';
    }
  }

  // Add released versions
  for (const version of changelog.versions) {
    content += `## [${version.version}] - ${version.date}\n\n`;

    // Group entries by Angular type (feat, fix, perf)
    const groupedByType = groupEntriesByAngularType(version.entries);

    // Add entries by type
    for (const [type, entries] of Object.entries(groupedByType)) {
      content += `### ${formatAngularType(type)}\n\n`;

      // Group by scope
      const groupedByScope = groupEntriesByScope(entries);

      for (const [scope, scopeEntries] of Object.entries(groupedByScope)) {
        if (scope !== 'undefined' && scope !== '') {
          content += `* **${scope}:**\n`;
          for (const entry of scopeEntries) {
            content += formatAngularEntry(entry, false);
          }
          content += '\n';
        } else {
          // No scope
          for (const entry of scopeEntries) {
            content += formatAngularEntry(entry, true);
          }
        }
      }

      content += '\n';
    }

    // Add breaking changes section if any
    const breakingChanges = version.entries.filter((entry) => entry.description.includes('**BREAKING**'));

    if (breakingChanges.length > 0) {
      content += '### BREAKING CHANGES\n\n';
      for (const entry of breakingChanges) {
        // Remove the **BREAKING** prefix for this section
        const description = entry.description.replace('**BREAKING** ', '');
        content += `* ${entry.scope ? `**${entry.scope}:** ` : ''}${description}`;
        if (entry.issueIds && entry.issueIds.length > 0) {
          content += ` (${entry.issueIds.join(', ')})`;
        }
        content += '\n';
      }
      content += '\n';
    }
  }

  // Add links section
  content += generateLinks(changelog, repoUrl);

  return content;
}

/**
 * Helper to group entries by Angular type
 */
function groupEntriesByAngularType(entries: ChangelogEntry[]): Record<string, ChangelogEntry[]> {
  const result: Record<string, ChangelogEntry[]> = {};

  // Map Keep-a-Changelog types to Angular types
  for (const entry of entries) {
    const type = entry.originalType || mapToAngularType(entry.type);

    // Handle breaking changes - they still go in their original category
    // but also in a separate breaking changes section

    if (!result[type]) {
      result[type] = [];
    }

    result[type].push(entry);
  }

  return result;
}

/**
 * Helper to map Keep-a-Changelog types to Angular types
 */
function mapToAngularType(type: string): string {
  switch (type) {
    case 'added':
      return 'feat';
    case 'fixed':
      return 'fix';
    case 'changed':
      return 'perf';
    case 'deprecated':
    case 'removed':
    case 'security':
      // These don't have direct Angular equivalents
      return type;
    default:
      return type;
  }
}

/**
 * Helper to format Angular type for display
 */
function formatAngularType(type: string): string {
  switch (type) {
    case 'feat':
      return 'Features';
    case 'fix':
      return 'Bug Fixes';
    case 'perf':
      return 'Performance Improvements';
    case 'security':
      return 'Security';
    case 'deprecated':
      return 'Deprecated';
    case 'removed':
      return 'Removed';
    default:
      return capitalizeFirstLetter(type);
  }
}

/**
 * Helper to group entries by scope
 */
function groupEntriesByScope(entries: ChangelogEntry[]): Record<string, ChangelogEntry[]> {
  const result: Record<string, ChangelogEntry[]> = {};

  for (const entry of entries) {
    const scope = entry.scope || '';

    if (!result[scope]) {
      result[scope] = [];
    }

    result[scope].push(entry);
  }

  return result;
}

/**
 * Helper to format an entry in Angular style
 */
function formatAngularEntry(entry: ChangelogEntry, includeScope: boolean): string {
  let result = '  * ';

  if (includeScope && entry.scope) {
    result += `**${entry.scope}:** `;
  }

  // Remove scope prefix if already added by the parent formatter
  let description = entry.description;
  if (!includeScope && entry.scope && description.startsWith(`**${entry.scope}**: `)) {
    description = description.substring(`**${entry.scope}**: `.length);
  }

  // Remove BREAKING prefix as it goes in a separate section
  if (description.startsWith('**BREAKING** ')) {
    description = description.substring('**BREAKING** '.length);
  }

  result += description;

  if (entry.issueIds && entry.issueIds.length > 0) {
    result += ` (${entry.issueIds.join(', ')})`;
  }

  result += '\n';
  return result;
}

/**
 * Generate the content for a changelog
 */
export function generateChangelogContent(
  changelog: Changelog,
  repoUrl?: string,
  format: ChangelogFormat = 'keep-a-changelog',
): string {
  // Debug: log arguments
  // eslint-disable-next-line no-console
  console.log('[DEBUG] generateChangelogContent called:', { changelog, repoUrl, format });
  if (format === 'angular') {
    return generateAngularChangelogContent(changelog, repoUrl);
  }

  // Default Keep-a-Changelog format
  let content = '# Changelog\n\n';
  content += `All notable changes to ${changelog.projectName} will be documented in this file.\n\n`;
  content += 'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),\n';
  content += 'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n\n';

  // Add unreleased changes if any
  if (changelog.unreleased.length > 0) {
    content += '## [Unreleased]\n\n';

    // Group by type
    const grouped = changelog.unreleased.reduce(
      (acc, entry) => {
        if (!acc[entry.type]) {
          acc[entry.type] = [];
        }
        acc[entry.type].push(entry);
        return acc;
      },
      {} as Record<string, ChangelogEntry[]>,
    );

    // Add entries by type
    for (const [type, entries] of Object.entries(grouped)) {
      content += `### ${capitalizeFirstLetter(type)}\n\n`;

      for (const entry of entries) {
        let entryText = `- ${entry.description}`;
        if (entry.issueIds && entry.issueIds.length > 0) {
          entryText += ` (${entry.issueIds.join(', ')})`;
        }
        content += `${entryText}.\n`;
      }

      content += '\n';
    }
  }

  // Add released versions
  for (const version of changelog.versions) {
    content += `## [${version.version}] - ${version.date}\n\n`;

    // Group by type
    const grouped = version.entries.reduce(
      (acc, entry) => {
        if (!acc[entry.type]) {
          acc[entry.type] = [];
        }
        acc[entry.type].push(entry);
        return acc;
      },
      {} as Record<string, ChangelogEntry[]>,
    );

    // Add entries by type
    for (const [type, entries] of Object.entries(grouped)) {
      content += `### ${capitalizeFirstLetter(type)}\n\n`;

      for (const entry of entries) {
        let entryText = `- ${entry.description}`;
        if (entry.issueIds && entry.issueIds.length > 0) {
          entryText += ` (${entry.issueIds.join(', ')})`;
        }
        content += `${entryText}.\n`;
      }

      content += '\n';
    }
  }

  // Add links section
  content += generateLinks(changelog, repoUrl);

  return content;
}

/**
 * Update or create a changelog file
 */
export function updateChangelog(
  packagePath: string,
  packageName: string,
  version: string,
  entries: ChangelogEntry[],
  repoUrl?: string,
  format: ChangelogFormat = 'keep-a-changelog',
): void {
  try {
    const changelogPath = path.join(packagePath, 'CHANGELOG.md');
    // Read existing changelog content if it exists
    let existingContent = '';
    if (fs.existsSync(changelogPath)) {
      existingContent = fs.readFileSync(changelogPath, 'utf8');
    }

    // Generate the new version section
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const newVersionContent = formatChangelogEntries(format, version, today, entries, packageName, repoUrl);

    let finalContent: string;

    if (existingContent) {
      // If we have existing content, we need to insert the new version at the top
      if (format === 'keep-a-changelog') {
        // For Keep-a-Changelog format, insert after the header
        const headerEndIndex = existingContent.indexOf('\n## ');
        if (headerEndIndex > 0) {
          // Insert the new version before the first existing version
          const beforeVersions = existingContent.substring(0, headerEndIndex);
          const afterVersions = existingContent.substring(headerEndIndex);
          finalContent = `${beforeVersions}\n${newVersionContent}\n${afterVersions}`;
        } else {
          // No existing versions, append to the end
          finalContent = `${existingContent}\n${newVersionContent}\n`;
        }
      } else {
        // For Angular format, insert after the header
        const headerEndIndex = existingContent.indexOf('\n## ');
        if (headerEndIndex > 0) {
          const beforeVersions = existingContent.substring(0, headerEndIndex);
          const afterVersions = existingContent.substring(headerEndIndex);
          finalContent = `${beforeVersions}\n${newVersionContent}\n${afterVersions}`;
        } else {
          finalContent = `${existingContent}\n${newVersionContent}\n`;
        }
      }
    } else {
      // Create new changelog with header
      if (format === 'keep-a-changelog') {
        finalContent = `# Changelog

All notable changes to ${packageName} will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

${newVersionContent}
`;
      } else {
        finalContent = `# Changelog

${newVersionContent}
`;
      }
    }

    // Write the final content to the changelog file
    log(`Writing changelog to: ${changelogPath}`, 'info');
    fs.writeFileSync(changelogPath, finalContent);

    log(`Updated changelog at ${changelogPath}`, 'success');
  } catch (error) {
    log(`Error updating changelog: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

/**
 * Helper to capitalize the first letter of a string
 */
function capitalizeFirstLetter(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1);
}
