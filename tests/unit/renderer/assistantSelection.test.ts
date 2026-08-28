/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { normalizePolicy, setPolicy, STATIC_POLICY } from '@/common/capabilities/policy';
import { assistantOrderAfterToggle, selectableAssistants } from '@/renderer/utils/model/assistantSelection';

/** The shipped policy conceals CLIs; ordering tests need them visible. */
const revealClis = () =>
  setPolicy(normalizePolicy({ version: 'test', capabilities: { 'cli.visible': true } }, 'static'));
const restorePolicy = () => setPolicy(STATIC_POLICY);

const mk = (id: string, source: Assistant['source'], sort_order: number, enabled = true): Assistant =>
  ({
    id,
    source,
    name: id,
    name_i18n: {},
    description_i18n: {},
    enabled,
    sort_order,
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
    agent_status: 'online',
    team_selectable: true,
    deletable: source === 'user',
  }) as Assistant;

describe('selectableAssistants', () => {
  beforeEach(revealClis);
  afterEach(restorePolicy);

  it('keeps the legacy source order when no preference exists', () => {
    const result = selectableAssistants([
      mk('builtin-a', 'builtin', 5),
      mk('user-b', 'user', 20),
      mk('cli-a', 'generated', 30),
      mk('user-a', 'user', 10),
      mk('cli-b', 'generated', 40),
    ]);
    expect(result.map((a) => a.id)).toEqual(['cli-a', 'cli-b', 'user-a', 'user-b', 'builtin-a']);
  });

  it('drops disabled assistants', () => {
    const result = selectableAssistants([
      mk('cli-on', 'generated', 10, true),
      mk('cli-off', 'generated', 20, false),
      mk('user-off', 'user', 30, false),
    ]);
    expect(result.map((a) => a.id)).toEqual(['cli-on']);
  });

  it('keeps CLI agents ahead of official even when official has a lower sort_order', () => {
    const result = selectableAssistants([mk('official', 'builtin', 1), mk('cli', 'generated', 999)]);
    expect(result[0].id).toBe('cli');
  });

  it('applies one preferred order across CLI, custom, and official assistants', () => {
    const assistants = [mk('official', 'builtin', 1), mk('custom', 'user', 1), mk('cli', 'generated', 1)];

    const result = selectableAssistants(assistants, ['official', 'cli', 'custom']);

    expect(result.map((assistant) => assistant.id)).toEqual(['official', 'cli', 'custom']);
  });

  it('ignores duplicate and stale IDs, then appends new assistants deterministically', () => {
    const assistants = [mk('official-new', 'builtin', 2), mk('custom-known', 'user', 1), mk('cli-new', 'generated', 3)];

    const result = selectableAssistants(assistants, ['missing', 'custom-known', 'custom-known']);

    expect(result.map((assistant) => assistant.id)).toEqual(['custom-known', 'cli-new', 'official-new']);
  });
});

describe('selectableAssistants under the concealing default policy (spec 002)', () => {
  // No revealClis here: STATIC_POLICY ships with `cli.visible: false`.
  afterEach(restorePolicy);

  const aionrs = (id: string, sort_order: number): Assistant =>
    ({ ...mk(id, 'generated', sort_order), agent: { type: 'aionrs' } }) as Assistant;

  it('drops bare-CLI assistants when named assistants exist', () => {
    const result = selectableAssistants([
      mk('cli-claude', 'generated', 10),
      mk('builtin-writer', 'builtin', 20),
      mk('user-review', 'user', 30),
    ]);
    expect(result.map((a) => a.id)).toEqual(['user-review', 'builtin-writer']);
  });

  it('keeps exactly one aionrs fallback when everything enabled is a bare CLI (fresh install)', () => {
    const result = selectableAssistants([
      mk('cli-claude', 'generated', 10),
      aionrs('cli-aionrs', 20),
      mk('cli-codex', 'generated', 30),
    ]);
    expect(result.map((a) => a.id)).toEqual(['cli-aionrs']);
  });

  it('falls back to the first bare CLI when no aionrs assistant exists', () => {
    const result = selectableAssistants([mk('cli-claude', 'generated', 10), mk('cli-codex', 'generated', 20)]);
    expect(result.map((a) => a.id)).toEqual(['cli-claude']);
  });

  it('still returns an empty list when nothing is enabled', () => {
    expect(selectableAssistants([mk('cli-off', 'generated', 10, false)])).toEqual([]);
  });

  it('applies the preferred order to the surviving named assistants', () => {
    const result = selectableAssistants(
      [mk('cli', 'generated', 1), mk('official', 'builtin', 1), mk('custom', 'user', 1)],
      ['official', 'cli', 'custom']
    );
    expect(result.map((a) => a.id)).toEqual(['official', 'custom']);
  });
});

describe('assistantOrderAfterToggle', () => {
  beforeEach(revealClis);
  afterEach(restorePolicy);

  const assistants = [
    mk('cli', 'generated', 1),
    mk('custom', 'user', 1),
    mk('official', 'builtin', 1),
    mk('disabled', 'builtin', 2, false),
  ];

  it('removes a disabled assistant from the enabled order', () => {
    expect(assistantOrderAfterToggle(assistants, ['official', 'cli', 'custom'], 'cli', false)).toEqual([
      'official',
      'custom',
    ]);
  });

  it('appends a re-enabled assistant to the end', () => {
    expect(assistantOrderAfterToggle(assistants, ['official', 'cli', 'custom'], 'disabled', true)).toEqual([
      'official',
      'cli',
      'custom',
      'disabled',
    ]);
  });
});
