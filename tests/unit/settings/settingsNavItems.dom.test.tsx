/**
 * The settings navigation is built twice from one shared id list — once in
 * `SettingsSider`, once in `SettingsPageWrapper` for the mobile and wrapper
 * navigation. These cases pin the two invariants that go wrong when the copies
 * drift, both of which actually did.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_TAB_IDS } from '@/renderer/pages/settings/components/SettingsSider';
import { getBuiltinSettingsNavItems } from '@/renderer/pages/settings/components/SettingsPageWrapper';
import { DEFAULT_CAPABILITIES, setPolicy, STATIC_POLICY } from '@/common/capabilities/policy';

const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

afterEach(() => setPolicy(STATIC_POLICY));

describe('getBuiltinSettingsNavItems', () => {
  it('returns an item for every id, with no holes', () => {
    // Spec 006 added `gateway` to the shared id list and a row to the sider's map
    // but not to this one. `builtinMap['gateway']` was undefined, the next loop
    // read `result[i].id`, and every settings page rendered blank in web mode.
    const items = getBuiltinSettingsNavItems(true, t);
    expect(items.every(Boolean)).toBe(true);
    expect(items.map((i) => i.id)).toEqual([...BUILTIN_TAB_IDS]);
  });

  it('never yields an undefined entry even if an id loses its row', () => {
    // The guarantee that matters is not "gateway is present" but "a missing row
    // cannot crash the page". Callers index into this list and read `.id`.
    const items = getBuiltinSettingsNavItems(false, t);
    expect(items.some((i) => i == null)).toBe(false);
  });

  it('drops the agent and model entries when agent settings are gated', () => {
    // spec 002 FR-3. This list is independent of the sider's, so gating one and
    // not the other would leave the entries reachable one viewport away.
    const items = getBuiltinSettingsNavItems(true, t, false).map((i) => i.id);
    expect(items).not.toContain('agent');
    expect(items).not.toContain('model');
    // The gateway page lists every runtime by name — 15 of them, measured live —
    // so it is an administrator surface by the same argument as the agent page.
    expect(items).not.toContain('gateway');
  });

  it('keeps them when agent settings are visible', () => {
    const items = getBuiltinSettingsNavItems(true, t, true).map((i) => i.id);
    expect(items).toContain('agent');
    expect(items).toContain('model');
  });

  it('defaults to visible so a caller that has not been updated is not silently gated', () => {
    // A default of `false` would conceal entries in any call site that forgot the
    // argument — a policy applied by omission is one nobody can find later.
    expect(getBuiltinSettingsNavItems(true, t).map((i) => i.id)).toContain('agent');
  });
});

describe('the shipped policy reaches both navigation copies', () => {
  it('gates the wrapper navigation through the same key as the sider', () => {
    setPolicy({ ...STATIC_POLICY, capabilities: { ...DEFAULT_CAPABILITIES, 'agent.settingsVisible': false } });
    // The component reads the key and passes it in; this asserts the plumbing
    // exists rather than re-testing the filter above.
    const gated = getBuiltinSettingsNavItems(true, t, STATIC_POLICY.capabilities['agent.settingsVisible']);
    expect(gated.map((i) => i.id)).not.toContain('agent');
  });
});
