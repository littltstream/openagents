import { afterEach, expect, it, vi } from 'vitest';
import { agentJoinCommand } from './agent-join-instruction';

afterEach(() => vi.unstubAllEnvs());

it('directs an existing agent to the configured self-hosted workspace server', () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.chippilot.cn/');
  expect(agentJoinCommand('TEST-CODE')).toBe(
    'npx -y @openagents-org/agent-launcher@latest join TEST-CODE --endpoint "https://api.chippilot.cn"',
  );
});
