import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IMAGE_GEN_ENV_KEYS } from '@/common/config/imageGenerationMcpEnv';
import { BUILTIN_IMAGE_GEN_NAME, type IMcpServer, type IProvider } from '@/common/config/storage';
import { resolveImageGenerationMigrationConfig, runBackendMigrations } from '@/process/utils/runBackendMigrations';

const {
  batchImportServersMock,
  configFileGetMock,
  configFileSetMock,
  httpRequestMock,
  listServersMock,
  resolveMcpNodeCommandMock,
  testMcpConnectionMock,
  updateServerMock,
} = vi.hoisted(() => ({
  batchImportServersMock: vi.fn(),
  configFileGetMock: vi.fn(),
  configFileSetMock: vi.fn(),
  httpRequestMock: vi.fn(),
  listServersMock: vi.fn(),
  resolveMcpNodeCommandMock: vi.fn(),
  testMcpConnectionMock: vi.fn(),
  updateServerMock: vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: httpRequestMock,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: {
    listServers: { invoke: listServersMock },
    batchImportServers: { invoke: batchImportServersMock },
    updateServer: { invoke: updateServerMock },
    testMcpConnection: { invoke: testMcpConnectionMock },
  },
}));

vi.mock('@/common/config/configMigration', () => ({
  migrateConfigStorage: vi.fn().mockResolvedValue(undefined),
  migrateLegacyMcpConfigToDb: vi.fn().mockResolvedValue(undefined),
  migrateProviders: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/process/utils/initStorage', () => ({
  getBuiltinMcpScriptPath: (name: string) => `/mock/${name}.js`,
}));

// [ENTERPRISE PATCH] spec 007 FR-3 — the node resolver probes real binaries;
// pin it in unit tests. getDataPath touches Electron paths and real symlinks.
vi.mock('@/process/utils/mcpNodeCommand', () => ({
  resolveMcpNodeCommand: resolveMcpNodeCommandMock,
}));

vi.mock('@/process/utils/utils', () => ({
  getDataPath: () => '/mock-data',
}));

vi.mock('@/process/utils/migrateAssistants', () => ({
  migrateAssistantsToBackend: vi.fn().mockResolvedValue(true),
}));

const provider: IProvider = {
  id: 'provider-1',
  platform: 'gemini',
  name: 'Gemini',
  base_url: 'https://generativelanguage.googleapis.com',
  api_key: 'provider-key',
  models: ['gemini-image'],
  enabled: true,
};

const imageEnv = {
  [IMAGE_GEN_ENV_KEYS.providerId]: 'provider-1',
  [IMAGE_GEN_ENV_KEYS.platform]: 'gemini',
  [IMAGE_GEN_ENV_KEYS.baseUrl]: 'https://generativelanguage.googleapis.com',
  [IMAGE_GEN_ENV_KEYS.apiKey]: 'provider-key',
  [IMAGE_GEN_ENV_KEYS.model]: 'gemini-image',
};

const imageServer = (): IMcpServer => ({
  id: 'image-server-id',
  name: BUILTIN_IMAGE_GEN_NAME,
  description: 'Built-in image generation tool powered by AI models. Configure the model in Settings > Tools.',
  enabled: true,
  builtin: true,
  transport: {
    type: 'stdio',
    command: 'node',
    args: ['/mock/builtin-mcp-image-gen.js'],
    env: imageEnv,
  },
  created_at: 1,
  updated_at: 1,
  original_json: JSON.stringify(
    {
      mcpServers: {
        [BUILTIN_IMAGE_GEN_NAME]: {
          command: 'node',
          args: ['/mock/builtin-mcp-image-gen.js'],
          env: imageEnv,
        },
      },
    },
    null,
    2
  ),
});

const configFile = {
  get: configFileGetMock,
  set: configFileSetMock,
};

beforeEach(() => {
  vi.clearAllMocks();
  configFileGetMock.mockResolvedValue(undefined);
  configFileSetMock.mockResolvedValue(undefined);
  resolveMcpNodeCommandMock.mockResolvedValue({ command: 'node', source: 'path' });
  batchImportServersMock.mockResolvedValue([]);
  updateServerMock.mockImplementation(async ({ id, data }) => ({
    ...imageServer(),
    id,
    ...data,
  }));
  testMcpConnectionMock.mockResolvedValue({ success: false, error: 'Command not found: npx' });
  httpRequestMock.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === '/api/settings/client') {
      return {
        'tools.imageGenerationModel': {
          id: 'provider-1',
          name: 'Gemini',
          platform: 'gemini',
          use_model: 'gemini-image',
        },
      };
    }
    if (method === 'GET' && path === '/api/providers') {
      return [provider];
    }
    return undefined;
  });
});

describe('resolveImageGenerationMigrationConfig', () => {
  it('uses backend client preference when local config file no longer has the image model', () => {
    const backendConfig = {
      id: 'gemini',
      name: 'Gemini',
      platform: 'gemini',
      base_url: 'https://example.test',
      api_key: 'backend-key',
      use_model: 'gemini-image',
    };

    expect(resolveImageGenerationMigrationConfig({ 'tools.imageGenerationModel': backendConfig }, undefined)).toEqual(
      backendConfig
    );
  });
});

describe('runBackendMigrations', () => {
  it('does not write image generation business config back to local config storage', async () => {
    listServersMock.mockResolvedValue([imageServer()]);
    configFileGetMock.mockImplementation(async (key: string) => {
      if (key === 'tools.imageGenerationModel') {
        return {
          id: 'provider-1',
          name: 'Gemini',
          platform: 'gemini',
          use_model: 'gemini-image',
          switch: true,
        };
      }
      return undefined;
    });
    httpRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/api/settings/client') {
        return {};
      }
      if (method === 'GET' && path === '/api/providers') {
        return [provider];
      }
      return undefined;
    });

    await runBackendMigrations(configFile as never);

    expect(configFileSetMock).not.toHaveBeenCalledWith('tools.imageGenerationModel', expect.anything());
  });

  it('does not sync the built-in image MCP server when bootstrap makes no effective change', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    listServersMock.mockResolvedValue([imageServer()]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).not.toHaveBeenCalled();
    expect(testMcpConnectionMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '[Migration] image MCP bootstrap decision, server id: %s, transport changed: %s, json changed: %s, will update: %s',
      'image-server-id',
      'no',
      'no',
      'no'
    );
  });

  it('does not sync agents when only the stored image MCP JSON representation differs', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    listServersMock.mockResolvedValue([
      {
        ...imageServer(),
        original_json: '{"legacy":true}',
      },
    ]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledOnce();
    expect(testMcpConnectionMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '[Migration] image MCP bootstrap decision, server id: %s, transport changed: %s, json changed: %s, will update: %s',
      'image-server-id',
      'no',
      'yes',
      'yes'
    );
  });
});

/**
 * [ENTERPRISE PATCH] spec 007 FR-3 — the browser MCP transport is fed verbatim
 * into Claude Code's `--mcp-config`, and claude resolves a bare `node` from its
 * inherited PATH. When boot-time probing finds PATH node unusable, the resolved
 * absolute command must land both in a fresh import and in the every-boot
 * reconcile of an existing row.
 */
describe('builtin browser MCP node command (spec 007 FR-3)', () => {
  const MANAGED_NODE = '/mock-data/runtime/node/node-v24.11.0-darwin-arm64/bin/node';

  const browserServer = (command: string): IMcpServer => ({
    id: 'browser-server-id',
    name: 'aionui-browser',
    description:
      "Control AionUi's built-in browser (the side preview panel): open pages, click, type and read content. " +
      'Sign-in state is shared across tabs and preserved between sessions.',
    enabled: true,
    builtin: true,
    transport: {
      type: 'stdio',
      command,
      args: ['/mock/builtin-mcp-browser.js'],
    },
    original_json: JSON.stringify(
      { mcpServers: { 'aionui-browser': { command, args: ['/mock/builtin-mcp-browser.js'] } } },
      null,
      2
    ),
  });

  it('imports a fresh browser server with the resolved managed node command', async () => {
    resolveMcpNodeCommandMock.mockResolvedValue({ command: MANAGED_NODE, source: 'managed' });
    listServersMock.mockResolvedValue([]);

    await runBackendMigrations(configFile as never);

    const imported = batchImportServersMock.mock.calls.at(0)?.[0]?.servers as IMcpServer[];
    const browser = imported.find((server) => server.name === 'aionui-browser');
    expect(browser?.transport).toMatchObject({ type: 'stdio', command: MANAGED_NODE });
    expect(browser?.original_json).toContain(MANAGED_NODE);
  });

  it('rewrites a stale bare-node transport on boot once PATH node stops working', async () => {
    resolveMcpNodeCommandMock.mockResolvedValue({ command: MANAGED_NODE, source: 'managed' });
    listServersMock.mockResolvedValue([imageServer(), browserServer('node')]);

    await runBackendMigrations(configFile as never);

    const browserUpdate = updateServerMock.mock.calls.find(([arg]) => arg.id === 'browser-server-id');
    expect(browserUpdate).toBeDefined();
    expect(browserUpdate![0].data.transport.command).toBe(MANAGED_NODE);
    expect(browserUpdate![0].data.original_json).toContain(MANAGED_NODE);
  });

  it('leaves a healthy bare-node transport untouched (zero upstream drift)', async () => {
    listServersMock.mockResolvedValue([imageServer(), browserServer('node')]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).not.toHaveBeenCalled();
  });
});
