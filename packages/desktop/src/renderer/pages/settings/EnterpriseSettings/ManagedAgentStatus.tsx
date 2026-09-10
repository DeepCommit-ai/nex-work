import React from 'react';
import { Alert, Badge, Button, Collapse } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { ManagedConnection, ManagedSyncStatus } from '@/common/deptconfig/catalog';

export const ENTERPRISE_CARD_CLASS = 'px-16px md:px-24px lg:px-28px py-14px md:py-16px bg-2 rd-16px';
export const ENTERPRISE_ERROR_KEYS = {
  INVALID_CONNECTION: 'invalidConnection',
  INVALID_KEY: 'invalidKey',
  SERVICE_UNREACHABLE: 'serviceUnreachable',
  SERVICE_ERROR: 'serviceError',
  INVALID_CONFIG: 'invalidConfig',
  UPDATE_FAILED: 'updateFailed',
  REPORT_FAILED: 'reportFailed',
  CONFIGURATION_DRIFT: 'configurationDrift',
} as const;

const badgeStatus = {
  unconfigured: 'default',
  checking: 'processing',
  connected: 'success',
  unreachable: 'warning',
  unauthorized: 'error',
  error: 'error',
} as const;

type Props = {
  status: ManagedSyncStatus;
  checking: boolean;
  applying: boolean;
  onCheck: () => void;
  onChange: () => void;
  children: React.ReactNode;
};

/** Keep authenticated identity visible while separating updates from service reachability. */
const ManagedAgentStatus: React.FC<Props> = ({ status, checking, applying, onCheck, onChange, children }) => {
  const { t, i18n } = useTranslation();
  const connection = status.connection;
  const state: ManagedConnection['state'] =
    applying && !connection?.serverUrl ? 'checking' : (connection?.state ?? 'unconfigured');
  const stale = Boolean(connection?.dept && state !== 'connected');
  const updateState =
    status.phase === 'syncing'
      ? 'updating'
      : status.phase === 'error' || status.phase === 'unauthorized'
        ? 'failed'
        : status.installedAt
          ? 'ready'
          : 'pending';
  const formatTime = (time: number): string => new Date(time).toLocaleString(i18n.language);

  return (
    <>
      <section className={ENTERPRISE_CARD_CLASS}>
        <div className='flex items-center justify-between gap-16px flex-wrap mb-16px'>
          <div className='text-14px leading-22px'>{t('settings.enterprise.connection.title')}</div>
          <div role='status' aria-live='polite'>
            <Badge status={badgeStatus[state]} text={t(`settings.enterprise.connection.state.${state}`)} />
          </div>
        </div>
        <dl className='m-0 flex flex-col gap-16px text-14px'>
          <div className='flex flex-col md:flex-row gap-8px md:gap-24px'>
            <dt className='text-t-secondary md:w-120px shrink-0'>{t('settings.enterprise.serverUrl')}</dt>
            <dd className='m-0 break-all'>
              {connection?.serverUrl ?? t('settings.enterprise.connection.notConfigured')}
            </dd>
          </div>
          <div className='flex flex-col md:flex-row gap-8px md:gap-24px'>
            <dt className='text-t-secondary md:w-120px shrink-0'>{t('settings.enterprise.connection.department')}</dt>
            <dd className='m-0 break-all'>
              {connection?.dept
                ? t('settings.enterprise.connection.departmentId', { dept: connection.dept })
                : t('settings.enterprise.connection.unverified')}
            </dd>
          </div>
          <div className='flex flex-col md:flex-row gap-8px md:gap-24px'>
            <dt className='text-t-secondary md:w-120px shrink-0'>{t('settings.enterprise.managed.title')}</dt>
            <dd className='m-0'>{t(`settings.enterprise.connection.updates.${updateState}`)}</dd>
          </div>
        </dl>
        {stale && <div className='mt-16px text-13px text-t-secondary'>{t('settings.enterprise.connection.stale')}</div>}
        {connection?.serverUrl && (
          <div className='flex gap-12px flex-wrap mt-20px'>
            <Button
              loading={checking || state === 'checking'}
              disabled={applying || status.phase === 'syncing'}
              onClick={onCheck}
            >
              {t('settings.enterprise.connection.check')}
            </Button>
            <Button disabled={applying} onClick={onChange}>
              {t('settings.enterprise.connection.change')}
            </Button>
          </div>
        )}
      </section>
      {children}
      <section className={ENTERPRISE_CARD_CLASS}>
        <Collapse bordered={false} destroyOnHide>
          <Collapse.Item name='technical' header={t('settings.enterprise.connection.details')}>
            <div className='flex flex-col gap-12px text-13px text-t-primary'>
              <div>
                {t('settings.enterprise.managed.pushLabel')}：{t(`settings.enterprise.managed.push.${status.push}`)}
              </div>
              {status.version && <div>{t('settings.enterprise.managed.version', { version: status.version })}</div>}
              {status.checkedAt && (
                <div>{t('settings.enterprise.managed.checked', { at: formatTime(status.checkedAt) })}</div>
              )}
              {connection?.verifiedAt && (
                <div>{t('settings.enterprise.connection.verifiedAt', { at: formatTime(connection.verifiedAt) })}</div>
              )}
              <div className='text-t-secondary'>{t('settings.enterprise.managed.schedule')}</div>
              {status.error && (
                <Alert
                  type='warning'
                  content={
                    <>
                      <div>
                        {t(
                          `settings.enterprise.connection.errors.${ENTERPRISE_ERROR_KEYS[status.errorCode ?? 'UPDATE_FAILED']}`
                        )}
                      </div>
                      <div className='mt-4px'>
                        {t('settings.enterprise.connection.errorCode', { code: status.errorCode ?? 'UPDATE_FAILED' })}
                      </div>
                    </>
                  }
                />
              )}
            </div>
          </Collapse.Item>
        </Collapse>
      </section>
    </>
  );
};

export default ManagedAgentStatus;
