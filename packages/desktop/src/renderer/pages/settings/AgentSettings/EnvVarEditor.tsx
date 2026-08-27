/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import { Button, Input } from '@arco-design/web-react';
import { Plus, Delete, PreviewOpen, PreviewClose } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { uuid } from '@/common/utils';
// [ENTERPRISE PATCH] spec 002 — server-controlled capability policy
import { useCapability } from '@/renderer/hooks/useCapability';

export type EnvVarRow = { id: string; key: string; value: string };

type EnvVarEditorProps = {
  value: EnvVarRow[];
  onChange: (rows: EnvVarRow[]) => void;
};

/**
 * [ENTERPRISE PATCH] Free-form agent environment.
 *
 * Spec: specs/002-server-controlled-capabilities/spec.md — `provider.userConfigurable`
 *
 * This is the one surface in the inventory where gating is not merely
 * concealment. The field accepts any key, `ANTHROPIC_BASE_URL` included, which
 * is exactly the variable spec 006 writes to pin every runtime at the company
 * gateway. A row typed here routes that runtime's traffic off the gateway, and
 * traffic that never reaches the gateway leaves no record anywhere — the gap is
 * undetectable after the fact.
 *
 * Gated here rather than at the route so that opening the settings page to an
 * administrator later does not silently hand the write path back with it. Read
 * stays open: seeing what is set is diagnostics, and taking that away would make
 * a misconfigured runtime harder to explain without making it any safer.
 */
const EnvVarEditor: React.FC<EnvVarEditorProps> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const editable = useCapability('provider.userConfigurable');

  const handleAdd = useCallback(() => {
    onChange([...value, { id: uuid(), key: '', value: '' }]);
  }, [value, onChange]);

  const handleRemove = useCallback(
    (id: string) => {
      onChange(value.filter((v) => v.id !== id));
    },
    [value, onChange]
  );

  const handleUpdateKey = useCallback(
    (id: string, key: string) => {
      onChange(value.map((v) => (v.id === id ? { ...v, key } : v)));
    },
    [value, onChange]
  );

  const handleUpdateValue = useCallback(
    (id: string, newValue: string) => {
      onChange(value.map((v) => (v.id === id ? { ...v, value: newValue } : v)));
    },
    [value, onChange]
  );

  const toggleVisibility = useCallback((id: string) => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return (
    <div>
      <div className='flex flex-col gap-10px'>
        {value.map((envVar) => {
          const isVisible = visibleIds.has(envVar.id);
          return (
            <div
              key={envVar.id}
              className='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto] items-center gap-8px'
            >
              <Input
                size='large'
                value={envVar.key}
                readOnly={!editable}
                onChange={(v) => handleUpdateKey(envVar.id, v)}
                placeholder={t('settings.envKeyPlaceholder')}
              />
              <Input
                size='large'
                type={isVisible ? 'text' : 'password'}
                value={envVar.value}
                readOnly={!editable}
                onChange={(v) => handleUpdateValue(envVar.id, v)}
                placeholder={t('settings.envValuePlaceholder')}
              />
              <Button
                type='text'
                size='small'
                icon={
                  isVisible ? <PreviewClose theme='outline' size={16} /> : <PreviewOpen theme='outline' size={16} />
                }
                onClick={() => toggleVisibility(envVar.id)}
                className='!h-36px !w-36px !rounded-10px !px-0 text-t-tertiary hover:text-t-secondary'
              />
              {editable ? (
                <Button
                  type='text'
                  size='small'
                  icon={<Delete theme='outline' size={16} />}
                  onClick={() => handleRemove(envVar.id)}
                  className='!h-36px !w-36px !rounded-10px !px-0 text-t-tertiary hover:text-danger'
                />
              ) : (
                <span className='w-36px' />
              )}
            </div>
          );
        })}
      </div>
      {editable ? (
        <Button
          type='text'
          size='small'
          icon={<Plus theme='outline' size={14} />}
          onClick={handleAdd}
          className='mt-8px !px-0 text-t-secondary hover:!text-primary-6'
        >
          {t('settings.addEnvVar')}
        </Button>
      ) : (
        <div className='mt-8px text-12px text-t-tertiary'>
          {t('settings.envManagedByAdmin', { defaultValue: '环境变量由管理员统一下发，此处不可修改。' })}
        </div>
      )}
    </div>
  );
};

export default EnvVarEditor;
