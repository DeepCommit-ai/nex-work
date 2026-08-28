import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * [ENTERPRISE PATCH] 临时下线的功能挂这里:入口保留,点进来只看到"暂未开通"。
 *
 * 直接删入口会让两份导航(SettingsSider 与 SettingsPageWrapper 各持一份)再踩一次
 * spec 006 的坑——两边不同步时设置页整个白屏。保留入口、内容占位,改动面最小。
 */
const FeatureNotAvailable: React.FC = () => {
  const { t } = useTranslation();
  return <div className='flex flex-col items-center justify-center h-full min-h-200px text-14px text-[var(--color-text-3)]'>{t('settings.featureNotAvailable', { defaultValue: '暂未开通' })}</div>;
};

export default FeatureNotAvailable;
