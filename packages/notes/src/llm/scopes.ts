import type { ChangelogEntry, LLMCategory, ScopeConfig, ScopeRules } from '../core/types.js';

/**
 * Extract allowed scopes from explicit category `scopes` arrays.
 */
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
 * Build the complete allowed scope list from config + categories.
 * Returns `null` for unrestricted, `[]` for none, populated array for restricted/packages.
 */
export function resolveAllowedScopes(
  scopeConfig: ScopeConfig | undefined,
  categories?: LLMCategory[],
  packageNames?: string[],
): string[] | null {
  if (!scopeConfig || scopeConfig.mode === 'unrestricted') return null;
  if (scopeConfig.mode === 'none') return [];
  if (scopeConfig.mode === 'packages') return packageNames ?? [];

  if (scopeConfig.mode === 'restricted') {
    const explicit = scopeConfig.rules?.allowed ?? [];
    const all = new Set(explicit);

    if (categories) {
      const fromCategories = getAllowedScopesFromCategories(categories);
      for (const scopes of fromCategories.values()) {
        for (const s of scopes) all.add(s);
      }
    }

    return [...all];
  }

  return null;
}

/**
 * Validate a single scope against the allowed list.
 */
export function validateScope(
  scope: string | undefined,
  allowedScopes: string[] | null,
  rules?: ScopeRules,
): string | undefined {
  if (!scope || allowedScopes === null) return scope;
  if (allowedScopes.length === 0) return undefined;

  const caseSensitive = rules?.caseSensitive ?? false;
  const normalise = (s: string) => (caseSensitive ? s : s.toLowerCase());
  const isAllowed = allowedScopes.some((a) => normalise(a) === normalise(scope));

  if (isAllowed) return scope;

  switch (rules?.invalidScopeAction ?? 'remove') {
    case 'keep':
      return scope;
    case 'fallback':
      return rules?.fallbackScope;
    case 'remove':
    default:
      return undefined;
  }
}

/**
 * Post-process entries after LLM returns, applying scope validation.
 */
export function validateEntryScopes(
  entries: ChangelogEntry[],
  scopeConfig: ScopeConfig | undefined,
  categories?: LLMCategory[],
): ChangelogEntry[] {
  const allowedScopes = resolveAllowedScopes(scopeConfig, categories);
  if (allowedScopes === null) return entries;

  return entries.map((entry) => ({
    ...entry,
    scope: validateScope(entry.scope, allowedScopes, scopeConfig?.rules),
  }));
}
