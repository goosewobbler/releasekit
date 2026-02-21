/**
 * Changelog Templates
 *
 * Default templates for different changelog formats
 */

/**
 * Get default template header for the specified format
 */
export function getDefaultTemplate(format: 'keep-a-changelog' | 'angular'): string {
  return format === 'keep-a-changelog' ? getKeepAChangelogTemplate() : getAngularTemplate();
}

/**
 * Get default template for Keep a Changelog format
 */
function getKeepAChangelogTemplate(): string {
  return `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;
}

/**
 * Get default template for Angular changelog format
 */
function getAngularTemplate(): string {
  return `# Changelog

`;
}
