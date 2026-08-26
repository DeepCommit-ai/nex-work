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

const isCliAgent = (a: ManagedAgent): boolean => a.agent_type === 'acp';

/** Read every runtime's current gateway-relevant configuration. */
export const loadRuntimeEnvs = async (): Promise<RuntimeEnv[]> => {
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
  if (aionrs) {
    let baseUrl = '';
    try {
      const providers = (await mode.listProviders.invoke()) as IProvider[] | undefined;
      baseUrl = providers?.find((p) => p.name === GATEWAY_PROVIDER_NAME)?.base_url ?? '';
    } catch {
      baseUrl = '';
    }
    envs.push({
      runtimeId: aionrs.id,
      runtimeName: aionrs.name,
      agentType: 'aionrs',
      env: baseUrl ? [{ name: GATEWAY_ENV_BASE_URL, value: baseUrl }] : [],
    });
  }
  return envs;
};

export const useGatewayStatus = (gatewayBaseUrl: string) => {
  const [runtimes, setRuntimes] = useState<RuntimeEnv[]>([]);
  const [statuses, setStatuses] = useState<RuntimeGatewayStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rs = await loadRuntimeEnvs();
      setRuntimes(rs);
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

  return { runtimes, statuses, loading, refresh };
};
