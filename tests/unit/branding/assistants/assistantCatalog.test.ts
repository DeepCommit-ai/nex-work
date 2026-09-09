import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { buildNexworkCorpus } from '@/branding/assistants/runtime';
import { NEXWORK_ASSISTANT_IDS } from '@/branding/assistants/policy';
import { scopeNexworkDepartmentConfig } from '@/branding/assistants/department';
import metadata from '@/branding/assistants/metadata.json';
import upstream from '@/branding/assistants/upstream.json';
import i18nConfig from '@/common/config/i18n-config.json';
import { planWrites } from '@/common/deptconfig/applyConfig';
import packageJson from '../../../../package.json';

describe('NexWork shipped assistants', () => {
  const corpus = buildNexworkCorpus();
  const active = corpus.manifest.assistants.filter((assistant) => assistant.default_enabled);

  it('keeps the vendored resource baseline aligned with the packaged backend', () => {
    expect(upstream.backendVersion).toBe(packageJson.aioncoreVersion);
    expect(
      active
        .filter((assistant) => assistant.id !== 'nexwork-assistant')
        .every((assistant) => assistant.agent_ref === '2d23ff1c')
    ).toBe(true);
  });

  it('enables exactly four assistants, keeping the old butler disabled', () => {
    expect(active.map((assistant) => assistant.id).toSorted()).toEqual([...NEXWORK_ASSISTANT_IDS].toSorted());
    expect(corpus.manifest.assistants.find((assistant) => assistant.id === 'aionui-assistant')?.default_enabled).toBe(
      false
    );
  });

  it('supplies product rules and localized names for every supported language', () => {
    expect(Object.keys(metadata).toSorted()).toEqual([...i18nConfig.supportedLanguages].toSorted());
    for (const assistant of active) {
      for (const locale of i18nConfig.supportedLanguages) {
        const rules = corpus.files[`rules/${assistant.id}.${locale}.md`]?.toString();
        expect(rules).toContain('NexWork');
        expect(rules).not.toMatch(/aionui|aion\s+ui|aioncore|AionUi Butler/i);
      }
    }
  });

  it('keeps the three specialized office skills while excluding application configuration', () => {
    expect(active.flatMap((assistant) => assistant.enabled_skills).toSorted()).toEqual([
      'officecli-docx',
      'officecli-pptx',
      'officecli-xlsx',
    ]);
    expect(
      active.every((assistant) =>
        ['aionui-config', 'nexwork-config'].every((name) =>
          (assistant.disabled_builtin_skills as string[]).includes(name)
        )
      )
    ).toBe(true);
  });

  it('retains every other upstream assistant and its unmodified rules for history', () => {
    const files = JSON.parse(gunzipSync(Buffer.from(upstream.gzipBase64, 'base64')).toString()) as Record<
      string,
      string
    >;
    const original = JSON.parse(Buffer.from(files['assistants.json'], 'base64').toString()) as {
      assistants: { id: string; default_enabled: boolean }[];
    };
    const retained = new Set<string>([...NEXWORK_ASSISTANT_IDS, 'aionui-assistant']);
    for (const assistant of original.assistants.filter((item) => !retained.has(item.id))) {
      expect(corpus.manifest.assistants.find((item) => item.id === assistant.id)).toEqual({
        ...assistant,
        default_enabled: false,
      });
      for (const [name, content] of Object.entries(files).filter(([name]) =>
        name.startsWith(`rules/${assistant.id}.`)
      )) {
        expect(corpus.files[name]).toEqual(Buffer.from(content, 'base64'));
      }
    }
  });

  it('does not revive custom and generated assistants when replaying an older department', () => {
    const config = scopeNexworkDepartmentConfig({
      version: 'old',
      dept: 'test',
      agents: ['2d23ff1c', '632f31d2'],
      model_aliases: [],
      assistants: [
        { id: 'aionui-assistant', fixed_model: 'office-model' },
        { id: 'oa-form-assistant', agent_id: '2d23ff1c' },
      ],
      skills: { 'oa-form-filler': 'old skill' },
    });
    const writes = planWrites(config, {
      agents: config.agents.map((id) => ({ id, enabled: true })),
      assistants: [...NEXWORK_ASSISTANT_IDS, 'aionui-assistant', 'oa-form-assistant', 'bare:2d23ff1c'].map((id) => ({
        id,
        enabled: true,
      })),
    });
    expect(config.assistants.find((assistant) => assistant.id === 'nexwork-assistant')?.fixed_model).toBe(
      'office-model'
    );
    expect(
      writes
        .filter((write) => write.kind === 'assistant.disable')
        .map((write) => write.id)
        .toSorted()
    ).toEqual(['aionui-assistant', 'bare:2d23ff1c', 'oa-form-assistant']);
    expect(config.skills).toEqual({});
  });
});
