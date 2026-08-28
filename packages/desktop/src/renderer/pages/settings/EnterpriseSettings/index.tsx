/**
 * [ENTERPRISE PATCH] 企业接入 —— 员工唯一要动手的一页。
 *
 * Spec: cynapse `doc/spec/2026-08-27-服务端控制agent-design.md`（FR-1、FR-2）
 *
 * 输入配置服务地址 + 部门 key，其余全部由服务端下发：可见哪些助手、跑在哪个
 * agent 上、网关地址与凭据、Claude Code 隔离目录、能力开关。之后每次启动自动
 * 全量重放（FR-2b），这页只在换 key / 排错时才需要再打开。
 *
 * 这页**不受** `agent.settingsVisible` 控制：员工被锁掉的是 agent/model/gateway
 * 的自助配置，而这页是配置的入口——锁了它，配置就永远进不来。
 */

import { enterpriseStore, type EnterpriseApplyState } from '@/renderer/services/enterpriseStore';
import { applyDeptConfig, type ApplyOutcome } from '@/renderer/services/deptConfigService';
import { Alert, Button, Form, Input, Message, Typography } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SettingsPageWrapper from '../components/SettingsPageWrapper';

const EnterpriseSettings: React.FC = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm<{ serverUrl: string; deptKey: string }>();
  const [applying, setApplying] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [state, setState] = useState<EnterpriseApplyState | undefined>();
  const [outcome, setOutcome] = useState<ApplyOutcome | undefined>();

  useEffect(() => {
    void (async () => {
      const [serverUrl, deptKey, applyState] = await Promise.all([
        enterpriseStore.getServerUrl(),
        enterpriseStore.getDeptKey(),
        enterpriseStore.getApplyState(),
      ]);
      if (serverUrl) form.setFieldValue('serverUrl', serverUrl);
      setHasStoredKey(Boolean(deptKey));
      setState(applyState);
    })();
  }, [form]);

  const apply = useCallback(async () => {
    const values = await form.validate();
    const serverUrl = values.serverUrl.trim();
    // key 只写不回显：留空 = 用已保存的那份。
    const deptKey = values.deptKey?.trim() || (await enterpriseStore.getDeptKey()) || '';
    if (!deptKey) {
      Message.error(t('settings.enterprise.keyRequired', { defaultValue: '请填写部门密钥' }));
      return;
    }
    setApplying(true);
    try {
      const result = await applyDeptConfig(serverUrl, deptKey);
      setOutcome(result);
      setState(await enterpriseStore.getApplyState());
      form.setFieldValue('deptKey', '');
      if (result.status === 'failed') {
        Message.error(t('settings.enterprise.failed', { defaultValue: '接入失败：{{msg}}', msg: result.detail }));
      } else {
        setHasStoredKey(true);
        if (result.report.failures.length) {
          Message.warning(
            t('settings.enterprise.partial', {
              defaultValue: '配置已应用，但有 {{n}} 项失败，详情见下方',
              n: result.report.failures.length,
            })
          );
        } else {
          Message.success(
            t('settings.enterprise.applied', { defaultValue: '配置 {{v}} 已应用', v: result.report.version })
          );
        }
      }
    } catch (e) {
      // applyDeptConfig 内部已把可预期的失败收敛成 { status: 'failed' }；
      // 落到这里的是意料之外的抛出（IPC 异常、存储写失败等）。绝不能被吞——
      // "点了没反应"正是这套东西要消灭的静默失败。
      console.error('[enterprise] 应用配置时未捕获的异常', e);
      setOutcome({ status: 'failed', detail: `应用出错：${e instanceof Error ? e.message : String(e)}` });
      Message.error(t('settings.enterprise.failed', { defaultValue: '接入失败：{{msg}}', msg: String(e) }));
    } finally {
      setApplying(false);
    }
  }, [form, t]);

  return (
    <SettingsPageWrapper>
      <div className='flex flex-col gap-16px max-w-640px'>
        <Typography.Paragraph className='text-13px text-[var(--color-text-3)] m-0'>
          {t('settings.enterprise.intro', {
            defaultValue:
              '输入公司配置服务地址与部门密钥。助手清单、模型路由与采集配置由服务端统一下发，之后每次启动自动同步。',
          })}
        </Typography.Paragraph>

        <Form form={form} layout='vertical' initialValues={{ serverUrl: '', deptKey: '' }}>
          <Form.Item
            field='serverUrl'
            label={t('settings.enterprise.serverUrl', { defaultValue: '配置服务地址' })}
            rules={[
              {
                required: true,
                message: t('settings.enterprise.serverUrlRequired', { defaultValue: '请填写配置服务地址' }),
              },
            ]}
          >
            <Input placeholder='http://cynapse.internal:54001' allowClear />
          </Form.Item>
          <Form.Item field='deptKey' label={t('settings.enterprise.deptKey', { defaultValue: '部门密钥' })}>
            <Input.Password
              placeholder={
                hasStoredKey
                  ? t('settings.enterprise.keyKeep', { defaultValue: '已保存，留空表示沿用，重新输入以更换' })
                  : t('settings.enterprise.keyPlaceholder', { defaultValue: '向管理员领取' })
              }
            />
          </Form.Item>
          <Button type='primary' loading={applying} onClick={() => void apply()}>
            {t('settings.enterprise.apply', { defaultValue: '连接并应用配置' })}
          </Button>
        </Form>

        {state && (
          <Alert
            type={state.phase === 'applied' ? 'success' : 'warning'}
            content={
              state.phase === 'applied'
                ? t('settings.enterprise.stateApplied', {
                    defaultValue: '当前配置 {{v}}，应用于 {{at}}',
                    v: state.version,
                    at: new Date(state.at).toLocaleString(),
                  })
                : // applying 停留在这，说明上次重放没走完（FR-2c）。下次启动会自动重跑；
                  // 也可以现在手动点一次。
                  t('settings.enterprise.stateApplying', {
                    defaultValue: '配置 {{v}} 上次未应用完整，下次启动将自动重试',
                    v: state.version,
                  })
            }
          />
        )}

        {outcome?.status === 'applied' && (
          <div className='flex flex-col gap-8px text-13px'>
            <div>
              {t('settings.enterprise.summary', {
                defaultValue:
                  '本轮：新建 {{imp}} 个，钉模型 {{pin}} 项，改指 {{re}} 项，启用助手 {{on}} 个，停用 {{off}} 个；当前可见助手 {{final}} 个',
                imp: outcome.report.imported.length,
                pin: outcome.report.modelPinned.length,
                re: outcome.report.repointed.length,
                on: outcome.report.assistantsEnabled.length,
                off: outcome.report.assistantsDisabled.length,
                final: outcome.report.finalAssistants.length,
              })}
            </div>
            {outcome.report.failures.map((f) => (
              <Alert key={f} type='error' content={f} />
            ))}
            {outcome.drift.map((d) => (
              <Alert
                key={d}
                type='warning'
                content={t('settings.enterprise.drift', { defaultValue: '服务端比对：{{d}}', d })}
              />
            ))}
            {outcome.reportDetail && <Alert type='warning' content={outcome.reportDetail} />}
          </div>
        )}
      </div>
    </SettingsPageWrapper>
  );
};

export default EnterpriseSettings;
