/** Node-only default role for the bundled Claude runtime. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const NEXWORK_OUTPUT_STYLE = 'NexWork';

/** Install minimal product rules without changing credentials, permissions, or other settings. */
export function prepareNexworkClaudeProfile(configDir: string): void {
  if (!path.isAbsolute(configDir)) throw new Error('Claude configuration directory must be absolute');
  const settingsPath = path.join(configDir, 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings))
      throw new Error('Invalid Claude settings');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const styleDir = path.join(configDir, 'output-styles');
  mkdirSync(styleDir, { recursive: true });
  writeFileSync(
    path.join(styleDir, 'nexwork.md'),
    `---\nname: ${NEXWORK_OUTPUT_STYLE}\ndescription: NexWork general assistant\nkeep-coding-instructions: false\n---\nUse the instructions and tools provided for the current conversation.\n`,
    { mode: 0o600 }
  );
  if (settings.outputStyle === NEXWORK_OUTPUT_STYLE) return;
  const temporary = `${settingsPath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ ...settings, outputStyle: NEXWORK_OUTPUT_STYLE }, null, 2) + '\n', {
    mode: 0o600,
  });
  renameSync(temporary, settingsPath);
}

/** Provision the effective managed directory before the desktop becomes ready. */
export async function configureNexworkClaude(port: number, fetchImpl: typeof fetch = fetch): Promise<void> {
  const url = `http://127.0.0.1:${port}/api/agents/2d23ff1c/overrides`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Cannot read Claude configuration (${response.status})`);
  const { data } = (await response.json()) as {
    data: { command_override?: string | null; env_override?: { name: string; value: string }[] };
  };
  if (!data) throw new Error('Missing Claude configuration');
  const env = data.env_override ?? [];
  const existing = env.find((entry) => entry.name === 'CLAUDE_CONFIG_DIR')?.value.trim();
  const selected = existing || path.join(os.homedir(), '.nexwork-claude');
  const configDir = selected.startsWith('~/') ? path.join(os.homedir(), selected.slice(2)) : selected;
  prepareNexworkClaudeProfile(configDir);
  if (existing === configDir) return;
  const written = await fetchImpl(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command_override: data.command_override ?? null,
      env_override: [
        ...env.filter((entry) => entry.name !== 'CLAUDE_CONFIG_DIR'),
        { name: 'CLAUDE_CONFIG_DIR', value: configDir },
      ],
    }),
  });
  if (!written.ok) throw new Error(`Cannot configure Claude product rules (${written.status})`);
}
