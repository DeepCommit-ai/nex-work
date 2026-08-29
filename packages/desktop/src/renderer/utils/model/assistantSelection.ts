/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isAionrsAssistant, type Assistant } from '@/common/types/agent/assistantTypes';
import { can } from '@/common/capabilities/policy';

/**
 * Single source of truth for which assistants appear in a *selection* list
 * (home pill bar, team creation, scheduled-task dropdown, …) and in what order.
 *
 * Rules (see PRD F-AHM-06 / F-AHM-07):
 *  - Only enabled assistants are selectable.
 *  - A stored enabled-order preference takes priority across every source.
 *  - Without a preference, preserve the legacy bare CLI → user → official
 *    order so an upgrade does not reshuffle an existing user's picker.
 *  - New assistants missing from a stored preference append in legacy order.
 *
 * Note: a bare CLI assistant surfaces with `source === 'generated'`.
 */

/**
 * [ENTERPRISE PATCH] 系统默认助手:每个选择列表永远把它钉在第一位,
 * 无论 legacy 分组还是用户的自定义排序偏好——"默认"必须一眼可见。
 */
export const DEFAULT_ASSISTANT_ID = 'default-assistant';

const pinSystemDefaultFirst = (ordered: Assistant[]): Assistant[] => {
  const idx = ordered.findIndex((assistant) => assistant.id === DEFAULT_ASSISTANT_ID);
  if (idx <= 0) return ordered;
  return [ordered[idx], ...ordered.slice(0, idx), ...ordered.slice(idx + 1)];
};

/** Legacy group weight — lower comes first. Bare CLI < user-created < official. */
const sourceGroupWeight = (source: string): number => {
  switch (source) {
    case 'generated':
      return 0;
    case 'user':
      return 1;
    case 'builtin':
      return 2;
    default:
      return 1;
  }
};

/**
 * [ENTERPRISE PATCH] Conceal bare-CLI assistants (spec 002).
 *
 * A `generated` assistant *is* a CLI: its name is the runtime's name ("Claude
 * Code", "Codex CLI", …). On a fresh install they are the only enabled
 * assistants, so every selection surface rendered a CLI roster. When the policy
 * hides CLI identity they are dropped from selection lists.
 *
 * If dropping them would empty the list (the fresh-install state), exactly one
 * is kept — preferring the aionrs default the guid page already prefers — so
 * every surface still has a resolvable default: concealment must never be the
 * reason a message cannot be sent (002 FR-7, operability fails open). Surfaces
 * that render the survivor are responsible for a neutral label.
 */
const concealBareCliAssistants = (ordered: Assistant[]): Assistant[] => {
  if (can('cli.visible')) return ordered;
  const named = ordered.filter((assistant) => assistant.source !== 'generated');
  if (named.length > 0) return named;
  const fallback = ordered.find((assistant) => isAionrsAssistant(assistant)) ?? ordered[0];
  return fallback ? [fallback] : [];
};

const compareLegacyAssistantOrder = (left: Assistant, right: Assistant): number => {
  const groupDelta = sourceGroupWeight(left.source) - sourceGroupWeight(right.source);
  if (groupDelta !== 0) return groupDelta;

  const orderDelta = left.sort_order - right.sort_order;
  if (orderDelta !== 0) return orderDelta;

  return left.id.localeCompare(right.id);
};

/**
 * Return enabled assistants in the user's preferred cross-source order.
 * Stale IDs and duplicates in `preferredOrder` are ignored.
 */
export const selectableAssistants = (assistants: Assistant[], preferredOrder?: readonly string[]): Assistant[] => {
  const legacyOrdered = assistants
    .filter((assistant) => assistant.enabled !== false)
    .toSorted(compareLegacyAssistantOrder);

  if (!preferredOrder || preferredOrder.length === 0) {
    return pinSystemDefaultFirst(concealBareCliAssistants(legacyOrdered));
  }

  const enabledById = new Map(legacyOrdered.map((assistant) => [assistant.id, assistant]));
  const orderedAssistants: Assistant[] = [];
  const includedIds = new Set<string>();

  for (const assistantId of preferredOrder) {
    const assistant = enabledById.get(assistantId);
    if (!assistant || includedIds.has(assistantId)) continue;
    includedIds.add(assistantId);
    orderedAssistants.push(assistant);
  }

  for (const assistant of legacyOrdered) {
    if (includedIds.has(assistant.id)) continue;
    includedIds.add(assistant.id);
    orderedAssistants.push(assistant);
  }

  return pinSystemDefaultFirst(concealBareCliAssistants(orderedAssistants));
};

/** Build the persisted enabled order after an assistant is toggled. */
export const assistantOrderAfterToggle = (
  assistants: Assistant[],
  preferredOrder: readonly string[],
  assistantId: string,
  enabled: boolean
): string[] => {
  const currentOrder = selectableAssistants(assistants, preferredOrder)
    .map((assistant) => assistant.id)
    .filter((id) => id !== assistantId);

  return enabled ? [...currentOrder, assistantId] : currentOrder;
};
