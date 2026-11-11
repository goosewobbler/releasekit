import { afterEach } from 'vitest';

// Commands chdir into --project-dir, often a temp folder the test then deletes.
const cwd = process.cwd();
afterEach(() => process.chdir(cwd));
