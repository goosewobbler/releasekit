# CI/CD Integration

`package-versioner` is designed to work seamlessly in CI/CD pipelines, making it easy to automate versioning as part of your release workflow.

## JSON Output Mode

For programmatic consumption in CI/CD scripts, `package-versioner` provides a structured JSON output option:

```bash
# Output results in JSON format
npx package-versioner --json

# Combine with dry-run for planning
npx package-versioner --dry-run --json
```

This will suppress all normal console output and instead output a single JSON object containing:

```json
{
  "dryRun": false,                            // Whether this was a dry run
  "updates": [                                // Array of packages that were updated
    {
      "packageName": "@scope/package-a",     // Package name
      "newVersion": "1.2.3",                 // New version number
      "filePath": "/path/to/package.json"    // Path to the updated package.json
    }
  ],
  "changelogs": [                            // Structured changelog data per package
    {
      "packageName": "@scope/package-a",     // Package name
      "version": "1.2.3",                   // New version
      "previousVersion": "v1.2.2",          // Previous tag (null if none)
      "revisionRange": "v1.2.2..HEAD",      // Git revision range used
      "repoUrl": "https://github.com/org/repo", // Repository URL (null if unknown)
      "entries": [                           // Parsed changelog entries
        { "type": "added", "description": "New feature", "scope": "core" },
        { "type": "fixed", "description": "Bug fix" }
      ]
    }
  ],
  "commitMessage": "chore(release): v1.2.3", // The commit message that was used
  "tags": [                                  // Array of tags that were created
    "v1.2.3"                                 // or package-specific tags in targeted mode
  ]
}
```

### Benefits of JSON Output

The structured JSON output provides several advantages for CI/CD integration:

- **Reliable Parsing**: Unlike text logs that might change format or include ANSI color codes, the JSON structure remains consistent
- **Programmatic Access**: Easily extract specific values like version numbers for subsequent steps
- **Conditional Workflows**: Trigger different CI actions based on the presence of updates or specific version changes
- **Audit Trail**: Store the JSON output as artifacts for version change tracking
- **Error Handling**: Better detect and respond to versioning issues in your pipeline

## Sample CI/CD Integration Patterns

Here are some common ways to incorporate `package-versioner` into your CI/CD pipeline:

### GitHub Actions Workflow Example

```yaml
name: Release

on:
  push:
    branches: [main]

jobs:
  version:
    runs-on: ubuntu-latest
    outputs:
      changes_detected: ${{ steps.version.outputs.changes_detected }}
      new_version: ${{ steps.version.outputs.new_version }}
    
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0  # Important for git history
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
      
      - name: Determine version
        id: version
        run: |
          # Run in JSON mode for parsing
          VERSION_OUTPUT=$(npx package-versioner --json)
          echo "Version output: $VERSION_OUTPUT"
          
          # Use jq to parse the JSON output
          CHANGES_DETECTED=$(echo "$VERSION_OUTPUT" | jq -r '.updates | length > 0')
          echo "changes_detected=$CHANGES_DETECTED" >> $GITHUB_OUTPUT
          
          if [ "$CHANGES_DETECTED" = "true" ]; then
            # Extract the first package's new version as representative version
            NEW_VERSION=$(echo "$VERSION_OUTPUT" | jq -r '.updates[0].newVersion')
            echo "new_version=$NEW_VERSION" >> $GITHUB_OUTPUT
          fi
  
  publish:
    needs: version
    if: needs.version.outputs.changes_detected == 'true'
    runs-on: ubuntu-latest
    steps:
      # Publishing steps using the detected version
      - run: echo "Would publish version ${{ needs.version.outputs.new_version }}"
```

### GitLab CI Pipeline Example

```yaml
stages:
  - version
  - publish

determine_version:
  stage: version
  script:
    - npm ci
    - |
      VERSION_OUTPUT=$(npx package-versioner --json)
      echo "VERSION_OUTPUT=$VERSION_OUTPUT" >> version.env
      
      # Parse values for use in later stages
      CHANGES_DETECTED=$(echo "$VERSION_OUTPUT" | jq -r '.updates | length > 0')
      echo "CHANGES_DETECTED=$CHANGES_DETECTED" >> version.env
      
      if [ "$CHANGES_DETECTED" = "true" ]; then
        NEW_VERSION=$(echo "$VERSION_OUTPUT" | jq -r '.updates[0].newVersion')
        echo "NEW_VERSION=$NEW_VERSION" >> version.env
      fi
  artifacts:
    reports:
      dotenv: version.env

publish:
  stage: publish
  needs: determine_version
  script:
    - echo "Publishing version $NEW_VERSION"
  rules:
    - if: $CHANGES_DETECTED == "true"
```

## Working with Tags in CI

When using the targeted mode with `-t` flag, `package-versioner` creates package-specific tags (e.g., `@scope/package-a@1.2.0`) but not a global tag. If your release process needs a global tag, you can add a step to your CI/CD pipeline:

```bash
# Create a global tag based on the representative version
NEW_VERSION=$(echo "$VERSION_OUTPUT" | jq -r '.updates[0].newVersion')
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
git push origin "v$NEW_VERSION"
```

## Environment Variables

`package-versioner` respects the following environment variables:

- `NO_COLOR=1`: Disables colored output in logs (automatically detected in CI environments)
- `CI=true`: Most CI environments set this automatically, which helps the tool adjust its output behaviour

## Skipping CI for Version Commits

If you want to prevent additional CI runs when version commits are made, you can include CI skip flags in your commit message template in `version.config.json`:

```json
{
  "commitMessage": "chore(release): ${version} [skip ci]",
  // other configuration options...
}
```

Common CI skip patterns include:
- `[skip ci]` or `[ci skip]` - Works in GitHub Actions, GitLab CI, CircleCI
- `[skip-ci]` - Alternative format supported by some CI systems
- `[no ci]` - Another variant 

Each CI system might have slightly different syntax, so check your CI provider's documentation for the exact skip token to use.

## Tips for Reliable CI/CD Integration

1. **Always use `--json`** in CI/CD pipelines for consistent output parsing
2. **Use the `fetch-depth: 0`** option in GitHub Actions (or equivalent in other CIs) to ensure access to the full Git history
3. **Store the JSON output** as a build artifact for debugging and auditing
4. **Consider dry runs** in your preview/staging branches to validate version changes before they're applied
5. **Use `--project-dir`** when running from a different directory than your project root
6. **Be mindful of Git credentials** - ensure your CI has proper permissions for creating commits and tags 