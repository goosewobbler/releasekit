import type { ChangelogEntry, LLMCategory, ScopeConfig } from '../core/types.js';

export interface ScopeError {
  entryIndex: number;
  providedScope: string;
  allowedScopes: string[];
}

export interface ScopeValidationResult {
  valid: boolean;
  entries: ChangelogEntry[];
  errors: ScopeError[];
}

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
 * Check whether a single scope value is valid against the allowed list.
 * Returns the scope if valid, undefined if invalid.
 */
export function validateScope(
  scope: string | undefined,
  allowedScopes: string[] | null,
  caseSensitive = false,
): string | undefined {
  if (!scope || allowedScopes === null) return scope;
  if (allowedScopes.length === 0) return undefined;

  const normalise = (s: string) => (caseSensitive ? s : s.toLowerCase());
  const isAllowed = allowedScopes.some((a) => normalise(a) === normalise(scope));
  return isAllowed ? scope : undefined;
}

/**
 * Validate scopes on all entries and apply the configured `invalidScopeAction`
 * (`remove` | `keep` | `fallback`, default `remove`). Always returns
 * `valid: true` once the action has been applied — the action defines the
 * resolution, so callers should not trigger a corrective retry on the LLM.
 *
 * `errors` is populated for logging/inspection but does not signal failure.
 */
export function validateEntryScopes(
  entries: ChangelogEntry[],
  scopeConfig: ScopeConfig | undefined,
  categories?: LLMCategory[],
): ScopeValidationResult {
  const allowedScopes = resolveAllowedScopes(scopeConfig, categories);
  if (allowedScopes === null) return { valid: true, entries, errors: [] };

  const caseSensitive = scopeConfig?.rules?.caseSensitive ?? false;
  const action = scopeConfig?.rules?.invalidScopeAction ?? 'remove';
  const fallback = scopeConfig?.rules?.fallbackScope;
  const errors: ScopeError[] = [];

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
