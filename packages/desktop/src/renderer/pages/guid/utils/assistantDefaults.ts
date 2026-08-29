import type { AssistantDetail } from '@/common/types/agent/assistantTypes';

export type ResolvedGuidAssistantDefaults = {
  modelId?: string;
  permissionMode?: string;
  thoughtLevel?: string;
  skillIds: string[];
  disabledBuiltinSkillIds: string[];
  mcpIds: string[];
  /**
   * Raw `defaults.mcps.mode` ('' when no detail). Carried so the effective-MCP
   * fallback can tell an admin's explicit "fixed to none" apart from "auto with
   * no history" — the two produce the same empty `mcpIds`.
   */
  mcpMode: string;
};

export const resolveGuidAssistantDefaults = (
  detail: AssistantDetail | null | undefined
): ResolvedGuidAssistantDefaults => {
  if (!detail) {
    return {
      modelId: undefined,
      permissionMode: undefined,
      thoughtLevel: undefined,
      skillIds: [],
      disabledBuiltinSkillIds: [],
      mcpIds: [],
      mcpMode: '',
    };
  }

  const modelId =
    detail.defaults.model.mode === 'fixed'
      ? detail.defaults.model.value
      : detail.defaults.model.mode === 'auto'
        ? detail.preferences.last_model_id
        : undefined;

  const permissionMode =
    detail.defaults.permission.mode === 'fixed'
      ? detail.defaults.permission.value
      : detail.defaults.permission.mode === 'auto'
        ? detail.preferences.last_permission_value
        : undefined;

  const thoughtLevelDefault = detail.defaults.thought_level ?? { mode: 'auto' };
  const thoughtLevel =
    thoughtLevelDefault.mode === 'fixed'
      ? thoughtLevelDefault.value
      : thoughtLevelDefault.mode === 'auto'
        ? detail.preferences.last_thought_level_value
        : undefined;

  const skillIds =
    detail.defaults.skills.mode === 'fixed'
      ? (detail.defaults.skills.value ?? [])
      : detail.defaults.skills.mode === 'auto'
        ? (detail.preferences.last_skill_ids ?? [])
        : [];

  const disabledBuiltinSkillIds =
    detail.defaults.skills.mode === 'fixed'
      ? (detail.capabilities.default_disabled_builtin_skill_ids ?? [])
      : detail.defaults.skills.mode === 'auto'
        ? (detail.preferences.last_disabled_builtin_skill_ids ?? [])
        : [];

  const mcpIds =
    detail.defaults.mcps.mode === 'fixed'
      ? (detail.defaults.mcps.value ?? [])
      : detail.defaults.mcps.mode === 'auto'
        ? (detail.preferences.last_mcp_ids ?? [])
        : [];

  return {
    modelId: modelId || undefined,
    permissionMode: permissionMode || undefined,
    thoughtLevel: thoughtLevel || undefined,
    skillIds,
    disabledBuiltinSkillIds,
    mcpIds,
    mcpMode: detail.defaults.mcps.mode,
  };
};

/**
 * [ENTERPRISE PATCH] spec 007 FR-4 — the MCP set a new conversation starts with.
 *
 * On a fresh install every assistant's `defaults.mcps` is `auto` with no
 * history, so the resolved list is empty and the direct-CLI lanes (Claude Code)
 * spawn with **no MCP at all** — the built-in browser silently missing, while
 * the aionrs factory injects every enabled server by default. Measured live:
 * same machine, Butler had the browser, claude did not.
 *
 * Rule: an explicit selection wins; an assistant's own defaults win; an empty
 * result falls back to **every enabled server in the catalog** — matching the
 * aionrs factory, so "enabled in the MCP directory" means "on by default in
 * every lane". The one empty that is respected is an admin's `fixed` mode with
 * an empty list: that is a decision, not an absence of one.
 */
export const resolveEffectiveDefaultMcpIds = (
  defaults: Pick<ResolvedGuidAssistantDefaults, 'mcpIds' | 'mcpMode'>,
  availableServers: readonly { id: string; enabled?: boolean }[]
): string[] => {
  if (defaults.mcpIds.length > 0) return defaults.mcpIds;
  if (defaults.mcpMode === 'fixed') return defaults.mcpIds;
  return availableServers.filter((server) => server.enabled !== false).map((server) => server.id);
};
