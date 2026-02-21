declare module 'git-semver-tags' {
  interface Options {
    lernaTags?: boolean;
    package?: string;
    skipUnstable?: boolean;
    tagPrefix?: string;
  }
  // Declare the named export function
  export function getSemverTags(options?: Options): Promise<string[]>;
}
