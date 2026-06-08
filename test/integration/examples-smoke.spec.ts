import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { buildWorkflow, render } from '../../scripts/examples-smoke/generate-smoke-workflow.js';
import { SCENARIOS } from '../../scripts/examples-smoke/scenarios.js';

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
}

interface Workflow {
  jobs: Record<string, { needs?: string; steps: Step[] }>;
}

function workflow(): Workflow {
  return buildWorkflow() as unknown as Workflow;
}

function stepsOf(jobId: string): Step[] {
  return workflow().jobs[jobId]?.steps ?? [];
}

describe('examples smoke-test generator', () => {
  it('should emit one smoke job per scenario plus a prepare job', () => {
    const jobIds = Object.keys(workflow().jobs);
    expect(jobIds).toContain('prepare');
    for (const scenario of SCENARIOS) {
      expect(jobIds).toContain(`smoke-${scenario.id}`);
    }
  });

  it('should make every smoke job depend on the prepare job', () => {
    for (const scenario of SCENARIOS) {
      expect(workflow().jobs[`smoke-${scenario.id}`].needs).toBe('prepare');
    }
  });

  it('should extract pnpm/action-setup into every scenario that installs with pnpm', () => {
    // The whole point: each smoke job must run the example's real pnpm setup, so
    // a missing pnpm/action-setup would surface as `pnpm: command not found`.
    for (const scenario of SCENARIOS) {
      const uses = stepsOf(`smoke-${scenario.id}`).map((s) => s.uses);
      expect(uses).toContain('pnpm/action-setup@v5');
    }
  });

  it('should never run actions/checkout in a smoke job (the workspace must start empty)', () => {
    // A checkout would put the releasekit repo's pnpm/cargo on PATH and mask a
    // missing setup step. The fixture is restored from a bundle instead.
    for (const scenario of SCENARIOS) {
      const usesCheckout = stepsOf(`smoke-${scenario.id}`).some((s) => s.uses?.startsWith('actions/checkout'));
      expect(usesCheckout).toBe(false);
    }
  });

  it('should set up the rust toolchain and probe cargo for the cargo scenario', () => {
    const steps = stepsOf('smoke-monorepo-rust');
    expect(steps.map((s) => s.uses)).toContain('dtolnay/rust-toolchain@stable');
    // Config-derived probe — catches `cargo: command not found` even though the
    // dry run short-circuits the real `cargo publish`.
    const cargoProbe = steps.find((s) => s.run === 'cargo --version');
    expect(cargoProbe).toBeDefined();
  });

  it('should not add a cargo probe to npm-only scenarios', () => {
    for (const scenario of SCENARIOS) {
      if (scenario.fixture === 'npm-cargo-monorepo') continue;
      const hasCargoProbe = stepsOf(`smoke-${scenario.id}`).some((s) => s.run === 'cargo --version');
      expect(hasCargoProbe).toBe(false);
    }
  });

  it('should always invoke releasekit with --dry-run so publish never fires', () => {
    for (const scenario of SCENARIOS) {
      const releaseStep = stepsOf(`smoke-${scenario.id}`).find((s) => /\breleasekit\b/.test(s.run ?? ''));
      expect(releaseStep, `${scenario.id} must run releasekit`).toBeDefined();
      expect(releaseStep?.run).toContain('--dry-run');
    }
  });

  it('should not leak any secrets/token references into the smoke workflow', () => {
    // The dry run uses no secrets; the example env that references them is stripped
    // during extraction. Assert nothing slipped through.
    const yaml = render();
    expect(yaml).not.toMatch(/secrets\./);
    expect(yaml).not.toMatch(/NODE_AUTH_TOKEN|CARGO_REGISTRY_TOKEN|NPM_TOKEN/);
  });

  it('should produce a workflow that round-trips as valid YAML', () => {
    expect(() => parseYaml(render())).not.toThrow();
  });

  it('should mark the generated workflow as do-not-edit', () => {
    expect(render()).toContain('GENERATED FILE — do not edit by hand');
  });
});
