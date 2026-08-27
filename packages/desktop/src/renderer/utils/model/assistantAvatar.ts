/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { can } from '@/common/capabilities/policy';
import { resolveBackendAssetUrl } from '@/renderer/utils/platform';

export type AssistantAvatar =
  | { kind: 'image'; value: string }
  | { kind: 'emoji'; value: string }
  | { kind: 'fallback' };

export function isBackendRelativeAssetPath(value: string): boolean {
  return value.startsWith('/api/') || value.startsWith('/assets/');
}

export function isLikelyLocalFilePath(value: string): boolean {
  if (value.startsWith('file://')) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (/^\/[A-Za-z]:[\\/]/.test(value)) return true;

  const unixLocalPathPrefixes = ['/Users/', '/home/', '/var/', '/tmp/', '/private/', '/Volumes/', '/mnt/'];
  return unixLocalPathPrefixes.some((prefix) => value.startsWith(prefix));
}

/**
 * [ENTERPRISE PATCH] The backend's built-in vendor logo catalog.
 *
 * Spec: specs/002-server-controlled-capabilities/spec.md (FR-3)
 *
 * Every vendor mark the backend serves lives under this prefix — verified live:
 * `/api/agents/management` returns 41 distinct icon paths, all of them here.
 * A user-chosen avatar is an emoji or an asset from somewhere else, so the
 * prefix is what separates "the vendor's mark" from "the avatar somebody picked
 * for this assistant". Only the first is concealed; blanking both would leave
 * every assistant looking identical, which defeats picking one by what it does.
 */
const VENDOR_LOGO_PREFIX = '/api/assets/logos/';

export function isVendorLogoPath(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().startsWith(VENDOR_LOGO_PREFIX);
}

/**
 * [ENTERPRISE PATCH] spec 002 FR-3 — this is where identity is actually withheld.
 *
 * The gate lives here rather than in `resolveAgentAvatar` because eight call
 * sites reach this function directly and bypass that wrapper: the guid assistant
 * picker, the cron dialog and its job metadata, team assistant selection,
 * conversation identity, preset assistant info and the inline agent editor.
 * Gating the wrapper alone left the guid page — the first screen a clerk sees —
 * showing every vendor logo.
 */
export function resolveAssistantAvatar(avatar: string | undefined): AssistantAvatar {
  const value = avatar?.trim();
  if (!value) return { kind: 'fallback' };
  if (isVendorLogoPath(value) && !can('cli.visible')) return { kind: 'fallback' };

  if (isLikelyLocalFilePath(value)) {
    return { kind: 'fallback' };
  }
  if (value.startsWith('/') && !isBackendRelativeAssetPath(value)) {
    return { kind: 'fallback' };
  }

  const resolved = resolveBackendAssetUrl(value) ?? value;
  const isImage = /\.(svg|png|jpe?g|webp|gif)$/i.test(resolved) || /^(https?:|data:|\/)/i.test(resolved);
  if (isImage) {
    return { kind: 'image', value: resolved };
  }

  return { kind: 'emoji', value };
}
