// Extend types for @manypkg/get-packages
declare module '@manypkg/get-packages' {
  export interface Package {
    packageJson: {
      name: string;
      [key: string]: unknown;
    };
    dir: string;
  }

  export interface Packages {
    packages: Package[];
    root: string;
  }

  export function getPackagesSync(dir: string): Packages;
}
