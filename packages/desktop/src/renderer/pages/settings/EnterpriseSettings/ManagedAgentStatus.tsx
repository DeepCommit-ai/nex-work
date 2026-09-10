import React, { useEffect, useState } from 'react';
import { Alert, Button, Message, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { managedAgents } from '@/common/adapter/ipcBridge';
import type { ManagedSyncStatus } from '@/common/deptconfig/catalog';

/** Show installation separately from the notification connection. */
const ManagedAgentStatus: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ManagedSyncStatus>({ phase: 'idle', push: 'disconnected', assistantIds: [] });
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const off = managedAgents.changed.on(setStatus);
    void managedAgents.status
      .invoke()
      .then(setStatus)
      .catch(() => {});
    return off;
  }, []);
  const sync = async (): Promise<void> => {
    setChecking(true);
    try {
      const result = await managedAgents.sync.invoke();
      setStatus(result.status);
      if (!result.success) Message.error(t('settings.enterprise.managed.failed'));
    } catch {
      Message.error(t('settings.enterprise.managed.failed'));
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className='flex flex-col gap-8px text-13px text-t-primary'>
      <Typography.Text bold>{t('settings.enterprise.managed.title')}</Typography.Text>
      <div>
        {t('settings.enterprise.managed.phaseLabel')}：{t(`settings.enterprise.managed.phase.${status.phase}`)}
      </div>
      <div>
        {t('settings.enterprise.managed.pushLabel')}：{t(`settings.enterprise.managed.push.${status.push}`)}
      </div>
      {status.version && <div>{t('settings.enterprise.managed.version', { version: status.version })}</div>}
      {status.checkedAt && (
        <div>{t('settings.enterprise.managed.checked', { at: new Date(status.checkedAt).toLocaleString() })}</div>
      )}
      <Typography.Text type='secondary'>{t('settings.enterprise.managed.schedule')}</Typography.Text>
      {status.error && <Alert type='warning' content={t('settings.enterprise.managed.failed')} />}
      <div>
        <Button
          loading={checking || status.phase === 'syncing'}
          disabled={status.phase === 'idle' || status.phase === 'unauthorized'}
          onClick={() => void sync()}
        >
          {t('settings.enterprise.managed.sync')}
        </Button>
      </div>
    </div>
  );
};

export default ManagedAgentStatus;
