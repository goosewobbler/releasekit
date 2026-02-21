import { getGitConfig, setGitConfig } from './utils/gitUserConfig.js';

let originalGitUserName: string | undefined;
let originalGitUserEmail: string | undefined;

function isIntegrationRun() {
  return process.env.VITEST_INTEGRATION === 'true';
}

export default async function setup() {
  if (isIntegrationRun()) {
    // Save current config
    originalGitUserName = getGitConfig('user.name');
    originalGitUserEmail = getGitConfig('user.email');
    // Set test values
    setGitConfig('user.name', 'Test User');
    setGitConfig('user.email', 'test@example.com');

    return async () => {
      // Restore config after all tests
      setGitConfig('user.name', originalGitUserName);
      setGitConfig('user.email', originalGitUserEmail);
    };
  }
  // If not integration, do nothing
  return undefined;
}
