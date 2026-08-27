/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * [ENTERPRISE PATCH] Gateway provisioning — status resolution.
 *
 * Spec: specs/006-gateway-provisioning/spec.md (FR-2, FR-3, FR-4)
 *
 * Two runtime families reach the gateway by different means, which is precisely
 * why they drift apart today:
 *   - `acp` CLI agents read ANTHROPIC_BASE_URL from their env override
 *   - `aionrs` reads a `custom` provider row
 * This hook resolves both into one list so the surface can show a single answer.
 */

import { acpConversation, mode } from '@/common/adapter/ipcBridge';
import type { IProvider } from '@/common/config/storage';
import { classifyRuntime } from '@/common/gateway/provisionGateway';
import { GATEWAY_ENV_BASE_URL, type EnvEntry, type RuntimeGatewayStatus } from '@/common/gateway/types';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';
import { useCallback, useEffect, useState } from 'react';

export type RuntimeEnv = { runtimeId: string; runtimeName: string; agentType: string; env: EnvEntry[] };

/** The provider row aionrs uses to reach an OpenAI-compatible gateway. */
export const GATEWAY_PROVIDER_NAME = 'NexWork Gateway';

/**
 * Everything a save needs to know about the current aionrs provider row.
 *
 * `id` is what makes the write an update rather than another insert. Without it
 * every save appended a fresh `NexWork Gateway` row (verified against a live
 * backend: two saves, two rows) and the status read below — a `find` by name —
 * kept reporting the *first* one while later saves went to the last.
 */
export type GatewayProviderRow = { id: string; baseUrl: string; models: string[] };

const isCliAgent = (a: ManagedAgent): boolean => a.agent_type === 'acp';

/** Read every runtime's current gateway-relevant configuration. */
export const loadRuntimeEnvs = async (): Promise<{ runtimes: RuntimeEnv[]; provider?: GatewayProviderRow }> => {
  const agents = (await acpConversation.getManagedAgents.invoke()) ?? [];
  const cli = agents.filter(isCliAgent);

  const envs = await Promise.all(
    cli.map(async (a) => {
      let env: EnvEntry[] = [];
      try {
        const o = await acpConversation.getAgentOverrides.invoke({ id: a.id });
        env = o?.env_override ?? [];
      } catch {
        // A runtime whose overrides cannot be read is reported as unset rather
        // than skipped — an invisible runtime is the failure mode this closes.
        env = [];
      }
      return { runtimeId: a.id, runtimeName: a.name, agentType: a.agent_type, env };
    })
  );

  // aionrs is represented by its provider row, projected into the same shape so
  // the surface has one uniform list.
  const aionrs = agents.find((a) => a.agent_type === 'aionrs');
  let provider: GatewayProviderRow | undefined;
  if (aionrs) {
    try {
      const providers = (await mode.listProviders.invoke()) as IProvider[] | undefined;
      const row = providers?.find((p) => p.name === GATEWAY_PROVIDER_NAME);
      if (row) provider = { id: row.id, baseUrl: row.base_url ?? '', models: row.models ?? [] };
    } catch {
      provider = undefined;
    }
    // A row whose model list is empty cannot serve a send: `getAvailableModels`
    // iterates `provider.models`, so aionrs would have nothing to select. Report
    // it as unset rather than as a working gateway.
    const usable = provider && provider.baseUrl && provider.models.length > 0;
    envs.push({
      runtimeId: aionrs.id,
      runtimeName: aionrs.name,
      agentType: 'aionrs',
      env: usable ? [{ name: GATEWAY_ENV_BASE_URL, value: provider!.baseUrl }] : [],
    });
  }
  return { runtimes: envs, provider };
};

export const useGatewayStatus = (gatewayBaseUrl: string) => {
  const [runtimes, setRuntimes] = useState<RuntimeEnv[]>([]);
  const [provider, setProvider] = useState<GatewayProviderRow | undefined>();
  const [statuses, setStatuses] = useState<RuntimeGatewayStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { runtimes: rs, provider: row } = await loadRuntimeEnvs();
      setRuntimes(rs);
      setProvider(row);
      setStatuses(
        rs.map((r) => {
          const { state, currentValue } = classifyRuntime(r.env, gatewayBaseUrl);
          return { runtimeId: r.runtimeId, runtimeName: r.runtimeName, state, currentValue };
        })
      );
    } finally {
      setLoading(false);
    }
  }, [gatewayBaseUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { runtimes, provider, statuses, loading, refresh };
};
