import type { z } from 'zod';
import { ConfigError } from './errors.js';

export interface UnsetEnvReference {
  path: PropertyKey[];
  name: string;
}

interface ConfigIssue {
  path: PropertyKey[];
  message: string;
}

type ZodIssue = z.core.$ZodIssue;

const LLM_MODEL_PATH = ['notes', 'releaseNotes', 'llm', 'model'];

const unsetEnvByOwner = new WeakMap<object, Map<PropertyKey, string>>();

function configValidationError(issues: ConfigIssue[]): ConfigError {
  const lines = issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
  return new ConfigError(`Config validation errors:\n${lines}`);
}

function unsetEnvMessage(name: string): string {
  return `{env:${name}} is not set`;
}

function isRootTypeMismatch(issue: ZodIssue): boolean {
  return issue.path.length === 0 && (issue.code === 'invalid_type' || issue.code === 'invalid_value');
}

// Zod reports a failed union as "Invalid input" at the union's path; when exactly one branch matched the value's
// type, its issues say what's actually wrong.
function flattenIssues(issues: readonly ZodIssue[], prefix: PropertyKey[] = []): ConfigIssue[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    if (issue.code === 'invalid_union') {
      const matched = issue.errors.filter((branch) => !branch.every(isRootTypeMismatch));
      if (matched.length === 1) {
        return flattenIssues(matched[0], path);
      }
    }
    return [{ path, message: issue.message }];
  });
}

function samePath(a: PropertyKey[], b: PropertyKey[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

export function zodConfigError(error: z.ZodError, unsetEnv: UnsetEnvReference[]): ConfigError {
  return configValidationError(
    flattenIssues(error.issues).map((issue) => {
      const ref = unsetEnv.find((r) => samePath(r.path, issue.path));
      return ref ? { path: issue.path, message: unsetEnvMessage(ref.name) } : issue;
    }),
  );
}

/** Records each unset reference against the parsed object that would have held it, for checks after load. */
export function rememberUnsetEnv(config: unknown, unsetEnv: UnsetEnvReference[]): void {
  for (const { path, name } of unsetEnv) {
    const owner = path
      .slice(0, -1)
      .reduce<unknown>(
        (node, key) => (node && typeof node === 'object' ? (node as Record<PropertyKey, unknown>)[key] : undefined),
        config,
      );
    if (owner && typeof owner === 'object') {
      const refs = unsetEnvByOwner.get(owner) ?? new Map<PropertyKey, string>();
      refs.set(path[path.length - 1], name);
      unsetEnvByOwner.set(owner, refs);
    }
  }
}

/** Carries `from`'s unset references to `to`, a copy of it built after load. */
export function copyUnsetEnv(from: object, to: object): void {
  const refs = unsetEnvByOwner.get(from);
  if (refs) {
    unsetEnvByOwner.set(to, new Map(refs));
  }
}

/** Whether a notes run calls the LLM: at least one task is on, and neither CHANGELOG_NO_LLM nor the run skips it. */
export function runsLlmTasks(llm: { tasks?: object } | undefined, skipReleaseNotes?: boolean): boolean {
  return (
    llm !== undefined &&
    !process.env.CHANGELOG_NO_LLM &&
    !skipReleaseNotes &&
    Object.values(llm.tasks ?? {}).some(Boolean)
  );
}

/** `llm.model` is optional at load so runs that skip notes work without it; call this before running an LLM task. */
export function assertLlmModel<T extends { model?: string }>(llm: T): asserts llm is T & { model: string } {
  if (llm.model) {
    return;
  }
  const name = unsetEnvByOwner.get(llm)?.get('model');
  throw configValidationError([
    { path: LLM_MODEL_PATH, message: name ? unsetEnvMessage(name) : 'required to run LLM tasks' },
  ]);
}
