import { warn } from '@releasekit/core';
import type { ChangelogEntry, LLMCategory, ScopeConfig } from '../core/types.js';

export interface ScopeError {
  entryIndex: number;
  providedScope: string;
  allowedScopes: string[];
}

export interface ScopeValidationResult {
  // The configured `invalidScopeAction` defines the resolution, so callers never corrective-retry the LLM over
  // scopes; `errors` is for logging only.
  valid: true;
  entries: ChangelogEntry[];
  errors: ScopeError[];
}

export function getAllowedScopesFromCategories(categories: LLMCategory[]): Map<string, string[]> {
  const scopeMap = new Map<string, string[]>();
  for (const cat of categories) {
    if (cat.scopes && cat.scopes.length > 0) {
      scopeMap.set(cat.name, cat.scopes);
    }
  }
  return scopeMap;
}

/**
 * Commit scopes are typically short (`core`), not the full npm name (`@acme/core`), so `scopes.mode: 'packages'`
 * accepts the full, unscoped (`acme/core`) and bare forms to avoid stripping a valid package scope.
 */
function expandPackageScopes(packageNames: string[]): string[] {
  const forms = new Set<string>();
  for (const name of packageNames) {
    forms.add(name);
    forms.add(name.replace(/^@/, ''));
    const slash = name.lastIndexOf('/');
    forms.add(slash >= 0 ? name.slice(slash + 1) : name);
  }
  return [...forms];
}

/** Returns `null` for unrestricted, `[]` for none. */
export function resolveAllowedScopes(
  scopeConfig: ScopeConfig | undefined,
  categories?: LLMCategory[],
  packageNames?: string[],
): string[] | null {
  if (!scopeConfig || scopeConfig.mode === 'unrestricted') {
    return null;
  }
  if (scopeConfig.mode === 'none') {
    return [];
  }
  if (scopeConfig.mode === 'packages') {
    return expandPackageScopes(packageNames ?? []);
  }

  if (scopeConfig.mode === 'restricted') {
    const explicit = scopeConfig.rules?.allowed ?? [];
    const all = new Set(explicit);

    if (categories) {
      const fromCategories = getAllowedScopesFromCategories(categories);
      for (const scopes of fromCategories.values()) {
        for (const s of scopes) {
          all.add(s);
        }
      }
    }

    return [...all];
  }

  return null;
}

export function validateScope(
  scope: string | undefined,
  allowedScopes: string[] | null,
  caseSensitive = false,
): string | undefined {
  if (!scope || allowedScopes === null) {
    return scope;
  }
  if (allowedScopes.length === 0) {
    return undefined;
  }

  const normalise = (s: string) => (caseSensitive ? s : s.toLowerCase());
  const isAllowed = allowedScopes.some((a) => normalise(a) === normalise(scope));
  return isAllowed ? scope : undefined;
}

export function validateEntryScopes(
  entries: ChangelogEntry[],
  scopeConfig: ScopeConfig | undefined,
  categories?: LLMCategory[],
  packageNames?: string[],
): ScopeValidationResult {
  const allowedScopes = resolveAllowedScopes(scopeConfig, categories, packageNames);
  if (allowedScopes === null) {
    return { valid: true, entries, errors: [] };
  }

  const caseSensitive = scopeConfig?.rules?.caseSensitive ?? false;
  const action = scopeConfig?.rules?.invalidScopeAction ?? 'remove';
  const fallback = scopeConfig?.rules?.fallbackScope;
  const errors: ScopeError[] = [];

  if (
    action === 'fallback' &&
    fallback !== undefined &&
    validateScope(fallback, allowedScopes, caseSensitive) === undefined
  ) {
    warn(
      `scopes.rules.fallbackScope "${fallback}" is not in the allowed scope list (${allowedScopes.length ? allowedScopes.join(', ') : '<empty>'}); substituted scopes will violate the allow-list. Add "${fallback}" to the allow list or change invalidScopeAction.`,
    );
  }

  const validatedEntries = entries.map((entry, index) => {
    const cleaned = validateScope(entry.scope, allowedScopes, caseSensitive);
    if (entry.scope && cleaned === undefined) {
      errors.push({
        entryIndex: index,
        providedScope: entry.scope,
        allowedScopes,
      });
      const replacement = action === 'keep' ? entry.scope : action === 'fallback' ? fallback : undefined;
      return { ...entry, scope: replacement };
    }
    return entry.scope !== cleaned ? { ...entry, scope: cleaned } : entry;
  });

  return { valid: true, entries: validatedEntries, errors };
}
