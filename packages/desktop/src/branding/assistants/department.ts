import type { DeptConfig } from '@/common/deptconfig/types';
/** The service is authoritative; never replace its assistant or skill catalog locally. */
export function scopeNexworkDepartmentConfig(config: DeptConfig): DeptConfig {
  return config;
}
