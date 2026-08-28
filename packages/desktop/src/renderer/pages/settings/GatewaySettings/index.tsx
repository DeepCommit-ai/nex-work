/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * [ENTERPRISE PATCH] Gateway settings surface.
 *
 * Spec: specs/006-gateway-provisioning/spec.md
 *
 * One URL + key provisions every runtime, and the list below reports which
 * runtimes actually reach the gateway. The reporting half is not decoration:
 * a runtime that routes around the gateway leaves no trace in collection, and
 * the gap cannot be noticed after the fact.
 */

import { acpConversation, mode } from '@/common/adapter/ipcBridge';
import { parseGatewayModels, planProvisioning } from '@/common/gateway/provisionGateway';
import type { GatewayConfig, GatewayProbe, RuntimeGatewayStatus } from '@/common/gateway/types';
import { Button, Form, Input, Message, Tag } from '@arco-design/web-react';
import { CheckOne, Caution, Close, Refresh } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import { GATEWAY_PROVIDER_NAME, useGatewayStatus } from './useGatewayStatus';

/**
 * Ask the gateway for its model list before provisioning anything (FR-5, FR-7).
 *
 * This runs through the backend's anonymous fetch-models endpoint rather than a
 * renderer fetch, so no cross-origin question arises and the same code path is
 * exercised on desktop and web.
 *
 * Two things ride on this one call:
 *   - **Reachability.** A URL that merely parses proves nothing. Without the
 *     probe a typo in the port persists, every runtime reports `gateway`, and
 *     the surface asserts a health it never checked.
 *   - **The model list.** An aionrs provider row with no models cannot serve a
 *     send at all, because `getAvailableModels` iterates `provider.models`.
 */
const probeGateway = async (config: GatewayConfig): Promise<GatewayProbe> => {
  try {
    const res = await mode.fetchModelList.invoke({
      platform: 'custom',
      base_url: config.baseUrl,
      api_key: config.apiKey,
    });
    const models = parseGatewayModels(res?.models);
    if (models.length === 0) return { status: 'failed', detail: 'no models returned' };
    return { status: 'ok', models };
  } catch (e) {
    return { status: 'failed', detail: String(e) };
  }
};

const StateTag: React.FC<{ status: RuntimeGatewayStatus }> = ({ status }) => {
  const { t } = useTranslation();
  if (status.state === 'gateway') {
    return (
      <Tag color='green' icon={<CheckOne theme='filled' size={14} />}>
        {t('settings.gateway.state.gateway', { defaultValue: '已指向网关' })}
      </Tag>
    );
  }
  if (status.state === 'overridden') {
    return (
      <Tag color='orange' icon={<Caution theme='filled' size={14} />}>
        {t('settings.gateway.state.overridden', { defaultValue: '手动覆盖' })}
      </Tag>
    );
  }
  // `unset` must read as a problem, not as a neutral default.
  return (
    <Tag color='red' icon={<Close theme='filled' size={14} />}>
      {t('settings.gateway.state.unset', { defaultValue: '未配置' })}
    </Tag>
  );
};

const GatewaySettings: React.FC = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm<GatewayConfig>();
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [resolved, setResolved] = useState<string[]>([]);
  const [probe, setProbe] = useState<GatewayProbe | undefined>();
  const { runtimes, provider, statuses, loading, refresh } = useGatewayStatus(baseUrl);

  const conflicts = useMemo(() => statuses.filter((s) => s.state === 'overridden'), [statuses]);
  const unset = useMemo(() => statuses.filter((s) => s.state === 'unset'), [statuses]);

  const save = useCallback(async () => {
    const values = await form.validate();
    const config: GatewayConfig = { baseUrl: values.baseUrl.trim(), apiKey: (values.apiKey ?? '').trim() };
    setSaving(true);
    try {
      // FR-5: the probe informs the write, it never gates it. A save against an
      // unreachable gateway must still persist — the operator has to be able to
      // type the right URL in and correct it, and a rejected save loses the key
      // they just entered.
      const result = await probeGateway(config);
      setProbe(result);

      const { toWrite } = planProvisioning(runtimes, config, resolved);

      const provisionOne = async (w: { runtimeId: string; env: (typeof toWrite)[number]['env'] }) => {
        const rt = runtimes.find((r) => r.runtimeId === w.runtimeId);
        if (rt?.agentType !== 'aionrs') {
          // PUT 是整体替换：command_override（受管 claude 的钉子，issue #8）必须
          // 先读出来原样带过，否则每次保存网关配置都会把它清掉。
          const cur = await acpConversation.getAgentOverrides.invoke({ id: w.runtimeId });
          return acpConversation.setAgentOverrides.invoke({ id: w.runtimeId, command_override: cur?.command_override ?? null, env_override: w.env });
        }
        // aionrs reaches the gateway through a provider row, not env. The row
        // carries the model list, without which nothing can be sent, and it is
        // updated in place — creating unconditionally appended a duplicate
        // `NexWork Gateway` row on every save.
        const models = result.status === 'ok' ? result.models : (provider?.models ?? []);
        return provider
          ? mode.updateProvider.invoke({
              id: provider.id,
              platform: 'custom',
              name: GATEWAY_PROVIDER_NAME,
              base_url: config.baseUrl,
              ...(config.apiKey ? { api_key: config.apiKey } : {}),
              models,
            })
          : mode.createProvider.invoke({
              name: GATEWAY_PROVIDER_NAME,
              platform: 'custom',
              base_url: config.baseUrl,
              api_key: config.apiKey,
              models,
            });
      };

      // allSettled, not all: a partial failure must report which runtimes were
      // provisioned. An all-or-nothing error would hide that some already point
      // at the gateway while others silently do not.
      const results = await Promise.allSettled(toWrite.map(provisionOne));
      const failed = results.filter((r) => r.status === 'rejected').length;

      setBaseUrl(config.baseUrl);
      // FR-6: never echo the key back.
      form.setFieldValue('apiKey', '');
      if (result.status === 'failed') {
        // Reported, not swallowed: the values are saved, but claiming the
        // runtimes "reach the gateway" when the gateway never answered is the
        // exact lie FR-7 forbids.
        Message.warning(
          t('settings.gateway.probeFailed', {
            defaultValue: '已保存，但网关没有响应，请检查地址与密钥：{{msg}}',
            msg: result.detail,
          })
        );
      } else if (failed > 0) {
        Message.warning(
          t('settings.gateway.savedPartial', {
            defaultValue: '已下发 {{ok}} 个运行时，{{failed}} 个失败',
            ok: toWrite.length - failed,
            failed,
          })
        );
      } else {
        Message.success(
          t('settings.gateway.saved', { defaultValue: '已保存并下发到 {{count}} 个运行时', count: toWrite.length })
        );
      }
      await refresh();
    } catch (e) {
      // FR-5 / FR-7: a failure is reported, never leaves the surface unusable.
      Message.error(t('settings.gateway.saveFailed', { defaultValue: '保存失败：{{msg}}', msg: String(e) }));
    } finally {
      setSaving(false);
    }
  }, [form, runtimes, provider, resolved, refresh, t]);

  return (
    <SettingsPageWrapper>
      <div className='flex flex-col gap-16px'>
        <Form form={form} layout='vertical' initialValues={{ baseUrl: '', apiKey: '' }}>
          <Form.Item
            field='baseUrl'
            label={t('settings.gateway.baseUrl', { defaultValue: '网关地址' })}
            rules={[
              { required: true, message: t('settings.gateway.baseUrlRequired', { defaultValue: '请填写网关地址' }) },
            ]}
          >
            <Input placeholder='http://litellm.internal:4000' allowClear />
          </Form.Item>
          <Form.Item field='apiKey' label={t('settings.gateway.apiKey', { defaultValue: '网关密钥' })}>
            <Input.Password
              placeholder={t('settings.gateway.apiKeyKeep', { defaultValue: '留空表示不修改已保存的密钥' })}
            />
          </Form.Item>
          <Button type='primary' loading={saving} onClick={() => void save()}>
            {t('settings.gateway.save', { defaultValue: '保存并下发到所有运行时' })}
          </Button>
        </Form>

        {probe && (
          // The green per-runtime tag only says the URL matches; this line is
          // the only place the surface says whether the gateway actually answered.
          <div
            className={
              probe.status === 'ok' ? 'text-13px text-[rgb(var(--success-6))]' : 'text-13px text-[rgb(var(--danger-6))]'
            }
          >
            {probe.status === 'ok'
              ? t('settings.gateway.probeOk', {
                  defaultValue: '网关已响应，可用模型 {{count}} 个。',
                  count: probe.models.length,
                })
              : t('settings.gateway.probeFailedHint', {
                  defaultValue: '网关未响应——配置已保存，但流量不会成功送达。',
                })}
          </div>
        )}

        <div className='flex items-center justify-between'>
          <span className='font-medium'>{t('settings.gateway.runtimes', { defaultValue: '运行时状态' })}</span>
          <Button size='small' icon={<Refresh size={14} />} loading={loading} onClick={() => void refresh()}>
            {t('settings.gateway.refresh', { defaultValue: '刷新' })}
          </Button>
        </div>

        {unset.length > 0 && (
          <div className='text-[rgb(var(--danger-6))] text-13px'>
            {t('settings.gateway.unsetWarning', {
              defaultValue: '{{count}} 个运行时未指向网关——它们的流量不会被记录。',
              count: unset.length,
            })}
          </div>
        )}

        <div className='flex flex-col gap-8px'>
          {statuses.map((s) => (
            <div key={s.runtimeId} className='flex items-center justify-between gap-12px py-8px'>
              <div className='min-w-0 flex-1'>
                <div className='truncate'>{s.runtimeName}</div>
                {s.state === 'overridden' && (
                  <div className='text-12px text-[rgb(var(--gray-6))] truncate'>
                    {t('settings.gateway.currentValue', { defaultValue: '当前指向：{{v}}', v: s.currentValue })}
                  </div>
                )}
              </div>
              <StateTag status={s} />
              {s.state === 'overridden' && !resolved.includes(s.runtimeId) && (
                <Button size='mini' onClick={() => setResolved((r) => [...r, s.runtimeId])}>
                  {t('settings.gateway.useGateway', { defaultValue: '改用网关' })}
                </Button>
              )}
            </div>
          ))}
        </div>

        {conflicts.length > 0 && (
          <div className='text-12px text-[rgb(var(--gray-6))]'>
            {t('settings.gateway.conflictHint', {
              defaultValue: '手动覆盖的运行时不会被自动改写，需逐个确认。',
            })}
          </div>
        )}
      </div>
    </SettingsPageWrapper>
  );
};

export default GatewaySettings;
