/** Product names only. Runtime environment variables and storage paths remain compatible. */
export const SKILL_NAMES: Record<string, string> = {
  'aionui-config': 'nexwork-config',
  'aionui-troubleshooting': 'nexwork-troubleshooting',
  'aionui-webui-public': 'nexwork-webui-public',
  'aionui-webui-setup': 'nexwork-webui-setup',
};
export const MCP_NAMES: Record<string, string> = {
  'aionui-browser': 'nexwork-browser',
  'aionui-image-generation': 'nexwork-image-generation',
  'AionUi Image Generation': 'nexwork-image-generation',
  'builtin-image-gen': 'nexwork-image-generation',
};
export const renameSkill = (name: string): string => SKILL_NAMES[name] ?? name;
export const renameMcp = (name: string): string => MCP_NAMES[name] ?? name;
/** Replace product prose without rewriting uppercase backend protocol/environment tokens. */
export const brandToolText = (text: string): string => text.replace(/Aion(?:Ui|UI| UI)/g, 'NexWork');

/** Rename the owned server's editable configuration key without changing transport values. */
export function renameMcpConfig(value: string, oldName: string, name: string): string {
  if (!value.trim()) return value;
  const original = JSON.parse(value) as { mcpServers?: Record<string, unknown> };
  if (original.mcpServers) {
    if (oldName !== name && oldName in original.mcpServers && name in original.mcpServers)
      throw new Error(`MCP configuration name collision: ${name}`);
    original.mcpServers = Object.fromEntries(
      Object.entries(original.mcpServers).map(([key, transport]) => [key === oldName ? name : key, transport])
    );
  }
  return JSON.stringify(original);
}
