# Bootstrap Guide — First Release

This document covers the one-time setup required before the self-referential release workflow can operate autonomously. After this is done, every subsequent release uses `@releasekit/version` to version itself and `@releasekit/notes` to write its own GitHub Release notes.

## Overview

The release workflow builds the packages from source and then runs the built CLIs to handle versioning and release note generation. This avoids the chicken-and-egg problem of needing a published version to release the first version. The only thing that cannot be bootstrapped automatically is the initial NPM package registration and repository secret configuration — which this guide covers.

---

## Prerequisites

- Node.js >=20, pnpm >=10 installed locally
- Access to the `goosewobbler` NPM account (or the org that owns `@releasekit`)
- Admin access to the `goosewobbler/releasekit` GitHub repository
- An LLM API key for release note enhancement (Anthropic recommended — see below)

---

## Step 1: Register the NPM Packages

The packages must exist on NPM before OIDC trusted publishing will work. Publish them manually once from your local machine.

```bash
# From the repo root
pnpm install
pnpm build

# Publish @releasekit/version
cd packages/version
# Confirm version is 0.1.0 in package.json before proceeding
npm publish --access public

# Publish @releasekit/notes
cd ../notes
# Confirm version is 0.1.0 in package.json before proceeding
npm publish --access public

cd ../..
```

> If either package name is already taken on NPM, you'll need to either claim it or adjust the scope.

---

## Step 2: Configure NPM OIDC Trusted Publishing

OIDC trusted publishing means the release workflow authenticates to NPM without storing a long-lived token as a GitHub secret. This is configured on the NPM side.

1. Log in to [npmjs.com](https://www.npmjs.com) and go to your account settings
2. Navigate to **Access Tokens** → **Generate New Token** → **Granular Access Token**
3. For each package (`@releasekit/version`, `@releasekit/notes`):
   - Go to the package page → **Settings** → **Publish access**
   - Enable **Automated publishing** under the **Publishing** section
   - Select **GitHub Actions** as the publishing environment
   - Set repository to `goosewobbler/releasekit`
   - Set workflow path to `.github/workflows/_release-publish.reusable.yml`

The workflow permissions block that enables this:

```yaml
permissions:
  id-token: write   # OIDC token for npm
  contents: write   # push version bump commits and tags
```

This is already configured in `_release-publish.reusable.yml`.

---

## Step 3: Create the Deploy Key

The release workflow pushes version bump commits and git tags back to the repository. This requires a deploy key with write access (the default `GITHUB_TOKEN` cannot push to protected branches).

```bash
# Generate a dedicated keypair (no passphrase)
ssh-keygen -t ed25519 -C "releasekit-deploy-key" -f ./releasekit-deploy-key -N ""
```

**Add the public key to GitHub:**

1. Go to `github.com/goosewobbler/releasekit` → **Settings** → **Deploy keys**
2. Click **Add deploy key**
3. Title: `releasekit-deploy-key`
4. Key: paste the contents of `releasekit-deploy-key.pub`
5. Check **Allow write access**
6. Click **Add key**

**Add the private key as a secret:**

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `DEPLOY_KEY`
4. Value: paste the contents of `releasekit-deploy-key` (the private key)

```bash
# Clean up — do not commit these files
rm releasekit-deploy-key releasekit-deploy-key.pub
```

---

## Step 4: Configure LLM Enhancement (Anthropic)

The `_release-post` phase uses `@releasekit/notes` with LLM enhancement to generate rich release notes. You'll need an Anthropic API key.

**Add the API key as a secret:**

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `ANTHROPIC_API_KEY`
4. Value: your Anthropic API key (starts with `sk-ant-...`)

The workflow passes this as an environment variable when invoking `releasekit-notes`:

```yaml
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

The `notes.config.json` (or CLI flags) in the workflow configures which Claude model to use and which LLM tasks to run (summarize, enhance).

---

## Step 5: Verify Secrets

After the above steps, your repository should have these secrets configured:

| Secret | Purpose | Required |
|---|---|---|
| `DEPLOY_KEY` | SSH key for pushing commits and tags | Yes |
| `ANTHROPIC_API_KEY` | Anthropic Claude for release note generation | Yes (if using LLM enhancement) |

The following are **not** needed with OIDC trusted publishing:
- ~~`NPM_TOKEN`~~ — replaced by OIDC
- ~~`TURBO_TOKEN`~~ — optional, only needed for Turbo remote caching

---

## Step 6: Tag the Initial State

Before the first automated release, tag the initial commit so `@releasekit/version` has a baseline to calculate from.

```bash
# Tag the initial state for each package
git tag @releasekit/version@v0.1.0
git tag @releasekit/notes@v0.1.0
git push origin @releasekit/version@v0.1.0
git push origin @releasekit/notes@v0.1.0
```

These tags match the `tagTemplate` in `version.config.json`:

```json
{
  "tagTemplate": "${packageName}@v${version}"
}
```

Without these baseline tags, the version tool cannot determine what has changed since the last release.

---

## Step 7: Run the Release Workflow

Go to `github.com/goosewobbler/releasekit` → **Actions** → **Release** → **Run workflow**.

For the first automated release, use:

- **Packages:** `all`
- **Bump type:** `patch` (or `minor` if you have new features since 0.1.0)
- **Dry run:** `true` (recommended for first run — verify the output before committing)

Review the workflow output. When satisfied:

- Re-run with **Dry run:** `false`

The workflow will:

1. Build both packages from source
2. Run `node packages/version/dist/index.js` to calculate version bumps and update `package.json` files
3. Commit the version bumps with `[skip ci]` in the message and push the git tags
4. Publish to NPM via OIDC
5. Run `node packages/notes/dist/cli.js` to generate release notes using the Anthropic API
6. Create GitHub Releases for each package with the generated notes

---

## Troubleshooting

**`npm publish` fails with "You must be logged in"**
Run `npm login` and authenticate with the account that owns the `@releasekit` scope.

**OIDC authentication fails in CI**
Confirm the workflow file path in the NPM trusted publisher settings matches exactly. The path is case-sensitive.

**`DEPLOY_KEY` errors on push**
Verify the public key was added with write access. Check that the private key secret has no trailing newline or whitespace.

**Version tool finds no changes**
Confirm the baseline tags from Step 6 are pushed to origin. The tool uses `git-semver-tags` to find the last release point.

**Release notes are empty or generic**
Check that `ANTHROPIC_API_KEY` is set and valid. The workflow will fall back to non-enhanced notes if the API call fails — check the `_release-post` job logs for LLM task errors.

---

## Ongoing Releases

After bootstrap, all future releases run entirely through the GitHub Actions workflow. The self-referential loop is:

```
Release workflow triggered
  └── Build from source (turbo build)
       └── @releasekit/version (built) → calculates + applies version bumps
            └── @releasekit/notes (built) → generates GitHub Release notes
                 └── GitHub Release created
```

No manual `npm publish` or version editing is ever needed again.
