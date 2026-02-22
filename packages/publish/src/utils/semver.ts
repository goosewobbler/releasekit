import semver from 'semver';

export function isPrerelease(version: string): boolean {
  return semver.prerelease(version) !== null;
}

export function getDistTag(version: string, defaultTag = 'latest'): string {
  const pre = semver.prerelease(version);
  if (pre && pre.length > 0) {
    const identifier = pre[0];
    return typeof identifier === 'string' ? identifier : 'next';
  }
  return defaultTag;
}
