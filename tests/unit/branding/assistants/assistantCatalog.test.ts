import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { buildNexworkCorpus } from '@/branding/assistants/runtime';
import { scopeNexworkDepartmentConfig } from '@/branding/assistants/department';
import metadata from '@/branding/assistants/metadata.json';
import upstream from '@/branding/assistants/upstream.json';
import i18nConfig from '@/common/config/i18n-config.json';
import packageJson from '../../../../package.json';

describe('minimal bootstrap and retained history', () => {
  const corpus = buildNexworkCorpus();
  it('uses the packaged backend baseline without enabling retired specialists', () => {
    expect(upstream.backendVersion).toBe(packageJson.aioncoreVersion);
    expect(corpus.manifest.assistants.filter((a) => a.default_enabled)).toEqual([]);
    expect(corpus.manifest.assistants.some((a) => a.id === 'nexwork-assistant')).toBe(true);
  });
  it('ships the minimal default identity in every supported language', () => {
    expect(Object.keys(metadata).toSorted()).toEqual([...i18nConfig.supportedLanguages].toSorted());
    for (const names of Object.values(metadata)) {
      expect(Object.keys(names)).toEqual(['default-assistant']);
      expect(names['default-assistant'].name).toBeTruthy();
    }
  });
  it('retains all original rules and assets for old conversations', () => {
    const original = JSON.parse(gunzipSync(Buffer.from(upstream.gzipBase64, 'base64')).toString()) as Record<
      string,
      string
    >;
    for (const [name, content] of Object.entries(original)) {
      if (name !== 'assistants.json') expect(corpus.files[name]).toEqual(Buffer.from(content, 'base64'));
    }
  });
  it('does not discard server-defined assistants, prompts or skills', () => {
    const config = {
      version: 'new',
      dept: 'default',
      agents: ['2d23ff1c'],
      model_aliases: [],
      assistants: [{ id: 'company-helper', agent_id: '2d23ff1c' }],
      skills: { 'company-skill': 'published skill' },
    };
    expect(scopeNexworkDepartmentConfig(config)).toEqual(config);
  });
});
