declare module 'git-semver-tags' {
  interface Options {
    lernaTags?: boolean;
    package?: string;
    skipUnstable?: boolean;
    tagPrefix?: string;
  }
  export function getSemverTags(options?: Options): Promise<string[]>;
}
