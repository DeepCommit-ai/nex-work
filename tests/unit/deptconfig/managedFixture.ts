import type { ManagedCatalog, CatalogRelease } from '@/common/deptconfig/catalog';
import type { DeptConfig } from '@/common/deptconfig/types';
import { sha256 } from '@process/services/managedagents/files';

export const catalogFixture = (): ManagedCatalog => ({
  schema_version: 1,
  common_rules: 'Use NexWork and verify results.',
  agents: ['default-assistant', 'office-assistant', 'nexwork-butler'].map((id) => ({
    id,
    name: id,
    name_i18n: {},
    description: '',
    description_i18n: {},
    engine: id === 'nexwork-butler' ? 'aion' : 'claude-code',
    mandatory: id === 'default-assistant',
    rules: id === 'office-assistant' ? 'Use {{skill:office-docs}}.' : '',
    skills: id === 'office-assistant' ? ['office-docs'] : [],
  })),
  skills: {
    'office-docs': {
      files: {
        'SKILL.md': '---\nname: office-docs\ndescription: Office work\n---\nVersion one',
        'scripts/read.txt': 'read me',
      },
    },
  },
});
export const releaseFixture = (revision = 1, catalog = catalogFixture()): CatalogRelease => {
  const content = JSON.stringify(catalog);
  return { revision, content, digest: sha256(content), published_at: revision * 1000 };
};
export const configFixture = (revision = 1): DeptConfig => ({
  version: `v14/agents/${revision}`,
  dept: 'default',
  agent_catalog: releaseFixture(revision),
  agents: ['2d23ff1c', '632f31d2'],
  model_aliases: ['test-model'],
  assistants: catalogFixture().agents.map((a) => ({
    id: a.id,
    name: a.name,
    agent_id: a.engine === 'aion' ? '632f31d2' : '2d23ff1c',
  })),
  gateway: { base_url: 'http://gateway.test', api_key: 'test-gateway-key' },
  capabilities: {},
});
