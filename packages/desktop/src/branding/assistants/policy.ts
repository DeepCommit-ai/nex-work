/** Product identities refer to managed server definitions, not a fixed local allowlist. */
export {
  MANAGED_BUTLER_ID as NEXWORK_ASSISTANT_ID,
  MANAGED_CORE_IDS as NEXWORK_ASSISTANT_IDS,
} from '@/common/deptconfig/catalog';
import { MANAGED_CORE_IDS, MANAGED_BUTLER_ID } from '@/common/deptconfig/catalog';
export const LEGACY_ASSISTANT_ID = 'aionui-assistant';
export const isNexworkAssistant = (id: string): boolean =>
  (MANAGED_CORE_IDS as readonly string[]).includes(id.replace(/^builtin-/, ''));
export const resolveNexworkAssistantId = (id: string): string =>
  ['aionui-assistant', 'nexwork-assistant'].includes(id.replace(/^builtin-/, ''))
    ? MANAGED_BUTLER_ID
    : id.replace(/^builtin-/, '');
