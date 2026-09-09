/** Product-owned assistant identities; independent of either execution engine. */
export const NEXWORK_ASSISTANT_ID = 'nexwork-assistant';
export const LEGACY_ASSISTANT_ID = 'aionui-assistant';
export const NEXWORK_ASSISTANT_IDS = [NEXWORK_ASSISTANT_ID, 'word-creator', 'ppt-creator', 'excel-creator'] as const;

/** Whether this assistant belongs to the shipped NexWork catalog. */
export const isNexworkAssistant = (id: string): boolean =>
  (NEXWORK_ASSISTANT_IDS as readonly string[]).includes(id.replace(/^builtin-/, ''));

/** Resolve persisted navigation and old department references to the new identity. */
export const resolveNexworkAssistantId = (id: string): string =>
  id.replace(/^builtin-/, '') === LEGACY_ASSISTANT_ID ? NEXWORK_ASSISTANT_ID : id.replace(/^builtin-/, '');
