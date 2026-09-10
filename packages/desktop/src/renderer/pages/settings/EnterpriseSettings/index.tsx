/** Enterprise connection settings; authenticated identity comes from the desktop sync service. */
import { enterpriseStore } from '@/renderer/services/enterpriseStore';
import { applyDeptConfig } from '@/renderer/services/deptConfigService';
import { managedAgents } from '@/common/adapter/ipcBridge';
import type { ManagedSyncErrorCode, ManagedSyncStatus } from '@/common/deptconfig/catalog';
import { Alert, Button, Form, Input, Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import { isElectronDesktop } from '@/renderer/utils/platform';
import ManagedAgentStatus, { ENTERPRISE_CARD_CLASS, ENTERPRISE_ERROR_KEYS } from './ManagedAgentStatus';

const EnterpriseSettings: React.FC = () => {
  const { t } = useTranslation();
  const desktop = isElectronDesktop();
  const [form] = Form.useForm<{ serverUrl: string; deptKey: string }>();
  const [applying, setApplying] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [formError, setFormError] = useState<ManagedSyncErrorCode>();
  const [statusError, setStatusError] = useState(false);
  const [status, setStatus] = useState<ManagedSyncStatus>({ phase: 'idle', push: 'disconnected', assistantIds: [] });

  useEffect(() => {
    let active = true;
    let received = false;
    const off = desktop
      ? managedAgents.changed.on((next) => {
          received = true;
          if (active) {
            setStatus(next);
            setStatusError(false);
          }
        })
      : undefined;
    void (async () => {
      try {
        const [serverUrl, deptKey, current] = await Promise.all([
          enterpriseStore.getServerUrl(),
          enterpriseStore.getDeptKey(),
          desktop ? managedAgents.status.invoke() : undefined,
        ]);
        if (!active) return;
        if (serverUrl) form.setFieldValue('serverUrl', serverUrl);
        setHasStoredKey(Boolean(deptKey));
        if (current && !received) setStatus(current);
      } catch {
        if (active) setStatusError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      off?.();
    };
  }, [desktop, form]);

  const changeConnection = (): void => {
    form.setFieldsValue({ serverUrl: status.connection?.serverUrl ?? '', deptKey: '' });
    setFormError(undefined);
    setEditing(true);
  };

  const apply = useCallback(async () => {
    let values: { serverUrl: string; deptKey: string };
    try {
      values = await form.validate();
    } catch {
      return;
    }
    setApplying(true);
    setFormError(undefined);
    try {
      const deptKey = values.deptKey?.trim() || (await enterpriseStore.getDeptKey()) || '';
      if (!deptKey) {
        form.setFields({ deptKey: { error: { message: t('settings.enterprise.keyRequired') } } });
        return;
      }
      const result = await applyDeptConfig(values.serverUrl.trim(), deptKey);
      if (result.status === 'failed') {
        setFormError(result.errorCode ?? 'UPDATE_FAILED');
      } else {
        setHasStoredKey(true);
        form.setFieldValue('deptKey', '');
        setEditing(false);
        if (result.report.failures.length) setFormError('UPDATE_FAILED');
        else Message.success(t('settings.enterprise.connection.saved'));
      }
    } catch {
      setFormError('UPDATE_FAILED');
    } finally {
      setApplying(false);
    }
  }, [form, t]);

  const checkConnection = async (): Promise<void> => {
    setChecking(true);
    try {
      const result = await managedAgents.sync.invoke();
      setStatus(result.status);
      setStatusError(false);
      if (!result.success)
        Message.error(
          t(`settings.enterprise.connection.errors.${ENTERPRISE_ERROR_KEYS[result.errorCode ?? 'UPDATE_FAILED']}`)
        );
    } catch {
      setStatusError(true);
    } finally {
      setChecking(false);
    }
  };

  const showForm = !loading && (!desktop || !status.connection?.serverUrl || editing || Boolean(formError));
  const connectionForm = showForm && (
    <section className={ENTERPRISE_CARD_CLASS}>
      <div className='text-14px leading-22px mb-8px'>{t('settings.enterprise.connection.settings')}</div>
      <div className='text-13px text-t-secondary mb-20px'>{t('settings.enterprise.intro')}</div>
      <Form
        form={form}
        layout='vertical'
        initialValues={{ serverUrl: form.getFieldValue('serverUrl') ?? '', deptKey: '' }}
        disabled={applying}
      >
        <Form.Item
          field='serverUrl'
          label={t('settings.enterprise.serverUrl')}
          rules={[
            { required: true, message: t('settings.enterprise.serverUrlRequired') },
            {
              validator: (value: string, callback) => {
                try {
                  const url = new URL(value.trim());
                  if (
                    !['http:', 'https:'].includes(url.protocol) ||
                    url.username ||
                    url.password ||
                    url.search ||
                    url.hash
                  )
                    throw new Error();
                } catch {
                  callback(t('settings.enterprise.connection.errors.invalidConnection'));
                  return;
                }
                callback();
              },
            },
          ]}
        >
          <Input placeholder={t('settings.enterprise.connection.addressPlaceholder')} allowClear />
        </Form.Item>
        <Form.Item field='deptKey' label={t('settings.enterprise.deptKey')}>
          <Input.Password
            autoComplete='new-password'
            placeholder={hasStoredKey ? t('settings.enterprise.keyKeep') : t('settings.enterprise.keyPlaceholder')}
          />
        </Form.Item>
        {formError && (
          <div className='mb-16px'>
            <Alert
              type='error'
              content={t(`settings.enterprise.connection.errors.${ENTERPRISE_ERROR_KEYS[formError]}`)}
            />
          </div>
        )}
        <div className='flex gap-12px'>
          <Button type='primary' loading={applying} disabled={checking} onClick={() => void apply()}>
            {t('settings.enterprise.apply')}
          </Button>
          {status.connection?.serverUrl && (
            <Button
              disabled={applying}
              onClick={() => {
                setEditing(false);
                setFormError(undefined);
                form.setFieldValue('deptKey', '');
              }}
            >
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </Form>
    </section>
  );

  return (
    <SettingsPageWrapper>
      <div className='flex flex-col gap-16px w-full pb-16px text-t-primary'>
        {statusError && <Alert type='warning' content={t('settings.enterprise.connection.statusUnavailable')} />}
        {desktop ? (
          <ManagedAgentStatus
            status={
              statusError || loading
                ? {
                    ...status,
                    connection: { ...status.connection, state: statusError ? 'error' : 'checking' },
                  }
                : status
            }
            applying={applying}
            checking={checking}
            onCheck={() => void checkConnection()}
            onChange={changeConnection}
          >
            {connectionForm}
          </ManagedAgentStatus>
        ) : (
          connectionForm
        )}
      </div>
    </SettingsPageWrapper>
  );
};

export default EnterpriseSettings;
