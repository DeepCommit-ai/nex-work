import type { DeptConfig } from '@/common/deptconfig/types';
import { NEXWORK_ASSISTANT_ID, NEXWORK_ASSISTANT_IDS, resolveNexworkAssistantId } from './policy';

/** Keep older config servers from restoring retired assistants after an upgrade. */
export function scopeNexworkDepartmentConfig(config: DeptConfig): DeptConfig {
  const incoming = config.assistants.map((assistant) => ({
    ...assistant,
    id: resolveNexworkAssistantId(assistant.id),
  }));
  return {
    ...config,
    assistants: NEXWORK_ASSISTANT_IDS.map((id) => {
      const current = incoming.find((assistant) => assistant.id === id);
      return Object.assign(
        { id, agent_id: current?.agent_id ?? (id === NEXWORK_ASSISTANT_ID ? undefined : '2d23ff1c') },
        current?.fixed_model ? { fixed_model: current.fixed_model } : {}
      );
    }),
    skills: {},
  };
}
