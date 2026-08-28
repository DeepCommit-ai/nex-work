import { afterEach, describe, expect, it } from 'vitest';
import { normalizePolicy, setPolicy, STATIC_POLICY } from '@/common/capabilities/policy';
import { resolveAgentDisplayName } from '@/renderer/utils/model/agentDisplayName';

afterEach(() => setPolicy(STATIC_POLICY));

describe('resolveAgentDisplayName（issue #9）', () => {
  it('prefers the server-delivered name', () => {
    setPolicy(
      normalizePolicy(
        { version: 'v6', capabilities: { 'cli.visible': false }, agentNames: { '2d23ff1c': '通用引擎' } },
        'remote'
      )
    );
    expect(resolveAgentDisplayName('2d23ff1c', 'Claude Code')).toBe('通用引擎');
  });

  it('falls back to a neutral label when locked and no server name — un-provisioned machines must not leak vendor names either', () => {
    setPolicy(normalizePolicy({ version: 'v6', capabilities: { 'cli.visible': false } }, 'remote'));
    expect(resolveAgentDisplayName('2d23ff1c', 'Claude Code')).toBe('智能引擎');
  });

  it('keeps the local name in open (cli.visible=true) mode — upstream behavior intact', () => {
    setPolicy(normalizePolicy({ version: 'v6', capabilities: { 'cli.visible': true } }, 'remote'));
    expect(resolveAgentDisplayName('2d23ff1c', 'Claude Code')).toBe('Claude Code');
  });
});
