import { z } from 'zod';

/** Changelog entry as `version --json` emits it. Extra fields are kept (`looseObject`). */
export const VersionChangelogEntrySchema = z.looseObject({
  type: z.string(),
  description: z.string(),
  issueIds: z.array(z.string()).optional(),
  prNumber: z.string().optional(),
  scope: z.string().optional(),
  originalType: z.string().optional(),
  breaking: z.boolean().optional(),
});

export const VersionPackageChangelogSchema = z.looseObject({
  packageName: z.string(),
  version: z.string(),
  previousVersion: z.string().nullable(),
  revisionRange: z.string(),
  repoUrl: z.string().nullable(),
  entries: z.array(VersionChangelogEntrySchema),
});

const VersionPackageUpdateSchema = z.looseObject({
  packageName: z.string(),
  newVersion: z.string(),
  filePath: z.string(),
  tag: z.string().optional(),
});

/** Full `VersionOutput` contract shared by publish and any stage that replays version JSON. */
export const VersionOutputSchema = z.looseObject({
  dryRun: z.boolean(),
  updates: z.array(VersionPackageUpdateSchema),
  changelogs: z.array(VersionPackageChangelogSchema),
  commitMessage: z.string().optional(),
  tags: z.array(z.string()),
  baselineTags: z.array(z.string()).optional(),
});
