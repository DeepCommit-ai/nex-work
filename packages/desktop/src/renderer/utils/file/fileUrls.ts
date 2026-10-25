/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getBaseUrl } from '@/common/adapter/httpBridge';
import type { ChatFileRef } from '@/common/types/chatFile';

const nativePathParts = (filePath: string): { path: string; rootLength: number; host?: string } | undefined => {
  // Only Windows paths use backslashes as separators. A backslash can be part
  // of a POSIX filename, and a native path's percent signs are always literal.
  let normalized = /^(?:[a-z]:[\\/]|\\\\)/i.test(filePath) ? filePath.replace(/\\/g, '/') : filePath;
  if (normalized.startsWith('//?/')) {
    normalized = /^\/\/\?\/UNC\//i.test(normalized) ? `//${normalized.slice(8)}` : normalized.slice(4);
  }
  if (normalized.startsWith('//./')) return undefined;
  if (/^[a-z]:\//i.test(normalized)) return { path: normalized, rootLength: 3 };
  if (normalized.startsWith('//')) {
    const match = /^\/\/([^/]+)\/([^/]+)(?:\/|$)/.exec(normalized);
    if (!match || /[@?#:%\\]/.test(match[1])) return undefined;
    return { path: normalized, rootLength: 3 + match[1].length + match[2].length, host: match[1] };
  }
  if (normalized.startsWith('/')) return { path: normalized, rootLength: 1 };
  return undefined;
};

const encodePath = (value: string): string => value.split('/').map(encodeURIComponent).join('/');

/** Encode a backend-native absolute path as a file URL without decoding its filename. */
export const toLocalFileHref = (filePath: string): string => {
  const parts = nativePathParts(filePath);
  if (!parts) throw new Error('A file URL requires an absolute native path');
  if (parts.host) {
    const origin = new URL(`file://${encodeURIComponent(parts.host)}/`).href;
    return origin + encodePath(parts.path.slice(parts.host.length + 3));
  }
  if (/^[a-z]:\//i.test(parts.path)) {
    return `file:///${parts.path.slice(0, 2)}${encodePath(parts.path.slice(2))}`;
  }
  return `file://${encodePath(parts.path)}`;
};

/** Get an absolute native file's parent while retaining POSIX, drive, or UNC roots. */
export const getLocalFileDirectory = (filePath: string): string | undefined => {
  const parts = nativePathParts(filePath);
  if (!parts) return undefined;
  const end = parts.path.lastIndexOf('/');
  return parts.path.slice(0, Math.max(end, parts.rootLength));
};

/** Build the raw-byte stream URL for a renderer-safe file reference. */
export const buildFileStreamUrl = (ref: ChatFileRef): string => {
  const params = new URLSearchParams({ kind: ref.kind });
  if (ref.kind === 'project') {
    params.set('pe_id', ref.pe_id);
    params.set('relative_path', ref.relative_path);
  } else {
    params.set('path', ref.path);
  }
  return `${getBaseUrl()}/api/fs/stream?${params.toString()}`;
};
