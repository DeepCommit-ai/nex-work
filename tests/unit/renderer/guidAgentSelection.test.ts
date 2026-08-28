import { afterEach, describe, expect, it } from 'vitest';

import type { Assistant } from '@/common/types/agent/assistantTypes';
import { normalizePolicy, setPolicy, STATIC_POLICY } from '@/common/capabilities/policy';
import {
  pickDefaultAssistantSelectionKey,
  resolveAssistantSelectionKey,
} from '@/renderer/pages/guid/hooks/useGuidAssistantSelection';

const revealClis = () =>
  setPolicy(normalizePolicy({ version: 'test', capabilities: { 'cli.visible': true } }, 'static'));

describe('guid assistant selection helpers', () => {
  afterEach(() => setPolicy(STATIC_POLICY));
  const assistants: Assistant[] = [
    assistant({ id: 'builtin-writer', source: 'builtin', runtimeKey: 'claude', sort_order: 20 }),
    assistant({ id: 'bare-aionrs', source: 'generated', runtimeKey: 'aionrs', sort_order: 10 }),
    assistant({ id: 'user-research', source: 'user', runtimeKey: 'gemini', sort_order: 30 }),
  ];

  it('prefers explicit custom assistant keys when the assistant exists', () => {
    expect(resolveAssistantSelectionKey('custom:user-research', assistants)).toBe('user-research');
  });

  it('does not accept legacy backend keys as assistant selection ids', () => {
    expect(resolveAssistantSelectionKey('claude', assistants)).toBeUndefined();
    expect(resolveAssistantSelectionKey('aionrs', assistants)).toBeUndefined();
  });

  it('defaults to the generated aionrs assistant when CLIs are visible', () => {
    revealClis();
    expect(pickDefaultAssistantSelectionKey(assistants)).toBe('bare-aionrs');
  });

  it('defaults to the enabled aionrs builtin (the Butler) under the concealing policy', () => {
    // The shipped policy conceals bare CLIs, so the default must be an
    // assistant the pill bar actually shows (spec 002).
    const withButler = [
      ...assistants,
      assistant({ id: 'builtin-butler', source: 'builtin', runtimeKey: 'aionrs', sort_order: 5 }),
    ];
    expect(pickDefaultAssistantSelectionKey(withButler)).toBe('builtin-butler');
  });

  it('falls back to the surviving bare CLI when nothing else is enabled', () => {
    expect(
      pickDefaultAssistantSelectionKey([assistant({ id: 'bare-aionrs', source: 'generated', runtimeKey: 'aionrs' })])
    ).toBe('bare-aionrs');
  });

  it('returns null when no assistants are available', () => {
    expect(pickDefaultAssistantSelectionKey([])).toBeNull();
  });
});

function assistant(
  overrides: Partial<Assistant> & { id: string; source: Assistant['source']; runtimeKey: string }
): Assistant {
  const agentId = `agent-${overrides.runtimeKey}`;
  const isAionrs = overrides.runtimeKey === 'aionrs';
  return {
    id: overrides.id,
    source: overrides.source,
    name: overrides.id,
    name_i18n: {},
    description_i18n: {},
    enabled: true,
    sort_order: overrides.sort_order ?? 0,
    agent_id: agentId,
    agent: isAionrs
      ? { type: 'aionrs', source: 'internal' }
      : { type: 'acp', source: 'builtin', acp_backend: overrides.runtimeKey },
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
    agent_status: 'online',
    team_selectable: true,
    deletable: overrides.source === 'user',
    ...overrides,
  };
}
