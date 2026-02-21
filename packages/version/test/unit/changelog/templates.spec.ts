import { describe, expect, it } from 'vitest';
import { getDefaultTemplate } from '../../../src/changelog/templates.js';

describe('Changelog Templates', () => {
  describe('getDefaultTemplate', () => {
    it('returns Keep a Changelog template when specified', () => {
      const template = getDefaultTemplate('keep-a-changelog');

      // Verify template content
      expect(template).toContain('# Changelog');
      expect(template).toContain('All notable changes to this project will be documented in this file.');
      expect(template).toContain('[Keep a Changelog]');
      expect(template).toContain('[Semantic Versioning]');
      expect(template).toContain('https://keepachangelog.com');
      expect(template).toContain('https://semver.org');
    });

    it('returns Angular template when specified', () => {
      const template = getDefaultTemplate('angular');

      // Verify template content
      expect(template).toContain('# Changelog');
      // Angular template is very minimal
      expect(template.trim().split('\n').length).toBeLessThan(5);
    });

    it('returns different templates for different formats', () => {
      const keepAChangelogTemplate = getDefaultTemplate('keep-a-changelog');
      const angularTemplate = getDefaultTemplate('angular');

      // Templates should be different
      expect(keepAChangelogTemplate).not.toEqual(angularTemplate);

      // Keep a Changelog template should be longer
      expect(keepAChangelogTemplate.length).toBeGreaterThan(angularTemplate.length);
    });
  });
});
