# Security Policy

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please
report it privately via GitHub Security Advisories:

**https://github.com/goosewobbler/releasekit/security/advisories/new**

Please do not open a public issue for security vulnerabilities.

## What to Include

When reporting, please include:

- A description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact
- Any suggested mitigations

We will respond within 48 hours and keep you updated on the investigation.

## Scope

### In Scope

- Vulnerabilities in any `@releasekit/*` package
- Security issues in CI/CD workflows
- Dependency vulnerabilities that affect runtime behavior

### Out of Scope

- Issues requiring local access to a user's machine
- Issues only reproducible in test environments
- Theoretical vulnerabilities without practical exploitation
- Denial of service attacks against our CI/CD infrastructure

### Important Context

ReleaseKit is **release tooling**, not a runtime library. Packages like
`@releasekit/version`, `@releasekit/publish`, and `@releasekit/notes` are
designed to run in development and CI environments, not in production
applications. Production exploits from this tool are unlikely, as it's not
deployed to end-user systems.

## Supported Versions

We currently support the latest minor version of each package. Security fixes
are backported to the current major version line.

## Security Measures

We have the following security measures in place:

- **Dependabot**: Automated dependency updates with weekly scans
- **CodeQL**: Static analysis for JavaScript/TypeScript
- **PR reviews**: All changes require review before merge
- **Secrets**: No secrets are committed to the repository

## Disclosure Policy

We follow responsible disclosure:

1. Report received and acknowledged within 48 hours
2. Investigation and fix development
3. Patch release prepared
4. Advisory published via GitHub Security Advisories
5. Public disclosure after patch is available

Thank you for helping keep ReleaseKit secure!
