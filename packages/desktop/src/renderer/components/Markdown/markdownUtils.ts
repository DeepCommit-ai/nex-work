/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';

import { diffColors } from '@/renderer/styles/colors';

/**
 * Format raw code string, attempting JSON pretty-print.
 * Falls back to stripped trailing newline if parsing fails.
 */
export const formatCode = (code: string): string => {
  const content = String(code).replace(/\n$/, '');
  try {
    return JSON.stringify(
      JSON.parse(content),
      (_key, value) => {
        return value;
      },
      2
    );
  } catch (_error) {
    return content;
  }
};

/**
 * Conditional render helper — returns trueComponent when condition is true,
 * falseComponent otherwise.
 */
export const logicRender = <T, F>(condition: boolean, trueComponent: T, falseComponent?: F): T | F => {
  return condition ? trueComponent : (falseComponent as F);
};

const decodeHrefPath = (value: string): string =>
  value.replace(/(?:%[a-f\d]{2})+/gi, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  });

export type LocalFileLinkReference = {
  filePath: string;
  rawReference: string;
  line?: number;
  column?: number;
  endLine?: number;
};

export type LocalFileLinkOptions = {
  inputKind?: 'href' | 'path';
  /** Explicit containment root; defaults to baseDirectory for relative links. */
  rootDirectory?: string;
};

type LocalFileLocation = {
  line?: number;
  column?: number;
  endLine?: number;
  source?: 'hash' | 'colon';
};

type NativePath = { prefix: string; rootKey: string; parts: string[]; windows: boolean };
type ParsedHref = { path: string; location: LocalFileLocation; explicitFile: boolean; absoluteHint: boolean };

const hasControlCharacters = (value: string): boolean =>
  Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

const normalizeSegments = (
  initial: string[],
  tail: string,
  floor: number,
  windows: boolean,
  guardWindows = false
): string[] | null => {
  const parts = [...initial];
  for (const part of (windows ? tail.replace(/\\/g, '/') : tail).split('/')) {
    if (!part || part === '.') continue;
    if (guardWindows && part !== '..' && /^\.+[ .]+$/.test(part)) return null;
    if (part === '..') {
      if (parts.length <= floor) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts;
};

/** Interpret an already-decoded absolute filesystem identity, never a URL. */
const parseNativePath = (value: string): NativePath | null => {
  if (!value || hasControlCharacters(value)) return null;
  const input = /^\/[A-Za-z]:[\\/]/.test(value) ? value.slice(1) : value;
  const windows = /^[A-Za-z]:[\\/]/.test(input) || input.startsWith('\\\\') || input.startsWith('//');
  let path = windows ? input.replace(/\\/g, '/') : input;
  const extended = path.startsWith('//?/');
  if (extended) path = path.slice(4);
  let prefix: string;
  let rootKey: string;
  let tail: string;
  const drive = /^([A-Za-z]):\//.exec(path);
  const unc = /^(?:\/\/|UNC\/)([^/]+)\/([^/]+)(?:\/|$)/i.exec(path);
  if (drive) {
    prefix = extended ? '\\\\?\\' + drive[1] + ':\\' : drive[1] + ':/';
    rootKey = 'drive:' + drive[1].toLowerCase();
    tail = path.slice(drive[0].length);
  } else if (unc) {
    if ([unc[1], unc[2]].some((part) => !part || part === '.' || part === '..' || /[:?*|<>"]/.test(part))) return null;
    prefix = (extended ? '\\\\?\\UNC\\' : '\\\\') + unc[1] + '\\' + unc[2] + '\\';
    rootKey = 'unc:' + unc[1].toLowerCase() + '/' + unc[2].toLowerCase();
    tail = path.slice(unc[0].length);
  } else if (!extended && path.startsWith('/') && !path.startsWith('//')) {
    prefix = '/';
    rootKey = '/';
    tail = path.slice(1);
  } else return null;
  const parts = normalizeSegments([], tail, 0, windows);
  return parts ? { prefix, rootKey, parts, windows } : null;
};

const nativePathText = (path: NativePath, parts = path.parts): string =>
  path.prefix + parts.join(path.prefix.startsWith('\\\\') ? '\\' : '/');

const parseHashLocation = (hash: string): LocalFileLocation | null => {
  const match = /^#L(\d+)(?:-L(\d+))?$/.exec(hash);
  if (!match) return null;
  const line = Number(match[1]);
  const endLine = match[2] == null ? undefined : Number(match[2]);
  if (
    !Number.isSafeInteger(line) ||
    line < 1 ||
    (endLine != null && (!Number.isSafeInteger(endLine) || endLine < line))
  )
    return null;
  return { line, ...(endLine == null ? {} : { endLine }), source: 'hash' };
};

/** Split actual URI syntax before decoding the path once. Encoded #/? stay names. */
const parseHref = (input: string): ParsedHref | null => {
  const raw = input.trim();
  if (!raw || raw.startsWith('#') || (raw.startsWith('//') && !raw.startsWith('//?/')) || hasControlCharacters(raw))
    return null;
  let path: string;
  let hash = '';
  let host = '';
  const explicitFile = /^file:/i.test(raw);
  const windowsAbsolute = /^(?:\/?[A-Za-z]:[\\/]|\\\\)/.test(raw) || raw.startsWith('//?/');
  if (explicitFile) {
    if (!/^file:(?:[\\/]|[A-Za-z]:[\\/])/i.test(raw)) return null;
    try {
      const url = new URL(raw);
      if (url.search || url.username || url.password || url.port) return null;
      path = url.pathname;
      hash = url.hash;
      host = url.hostname;
    } catch {
      return null;
    }
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !windowsAbsolute) return null;
    const namespaceLength = /^(?:\\\\\?\\|\/\/\?\/)/.test(raw) ? 4 : 0;
    if (raw.indexOf('?', namespaceLength) >= 0) return null;
    const hashIndex = raw.indexOf('#');
    path = hashIndex < 0 ? raw : raw.slice(0, hashIndex);
    hash = hashIndex < 0 ? '' : raw.slice(hashIndex);
  }
  if (!path || /%(?:2f|5c)/i.test(path)) return null;
  let location: LocalFileLocation = {};
  const column = /^(.*):(\d+):(\d+)$/.exec(path);
  const line = column ? null : /^(.*):(\d+)$/.exec(path);
  if (column || line) {
    const match = (column ?? line)!;
    location = { line: Number(match[2]), ...(column ? { column: Number(match[3]) } : {}), source: 'colon' };
    if (
      !Number.isSafeInteger(location.line) ||
      location.line! < 1 ||
      (location.column != null && (!Number.isSafeInteger(location.column) || location.column < 1))
    )
      return null;
    path = match[1];
  }
  if (hash) {
    const parsed = parseHashLocation(decodeHrefPath(hash));
    if (!parsed) return null;
    location = parsed;
  }
  path = decodeHrefPath(path);
  if (!path || hasControlCharacters(path)) return null;
  if (host && host.toLowerCase() !== 'localhost') path = '\\\\' + host + path.replace(/\//g, '\\');
  const posixHint =
    raw.startsWith('/') &&
    (/^\/(?:Users|home|tmp|private|var|mnt|Volumes)(?:\/|$)/.test(path) || /(?:^|\/)[^/]*\.[^/]+$/.test(path));
  return { path, location, explicitFile, absoluteHint: explicitFile || windowsAbsolute || posixHint };
};

const formatReference = (filePath: string, location: LocalFileLocation): LocalFileLinkReference => {
  const { source, ...position } = location;
  const suffix =
    location.line == null
      ? ''
      : source === 'hash'
        ? '#L' + location.line + (location.endLine == null ? '' : '-L' + location.endLine)
        : ':' + location.line + (location.column == null ? '' : ':' + location.column);
  return { filePath, rawReference: filePath + suffix, ...position };
};

const isRelativeTarget = (path: string): boolean =>
  Boolean(path) &&
  !/^(?:[\\/]|[a-z][a-z\d+.-]*:|~(?:[\\/]|$))/i.test(path) &&
  !/[\\/]$/.test(path) &&
  !['.', '..'].includes(path);

const resolveWorkspacePath = (path: string, baseDirectory: string, rootDirectory = baseDirectory): string | null => {
  if (!isRelativeTarget(path)) return null;
  const base = parseNativePath(baseDirectory);
  const root = parseNativePath(rootDirectory);
  if (!base || !root || base.rootKey !== root.rootKey || base.parts.length < root.parts.length) return null;
  const equal = (left: string, right: string) =>
    base.windows ? left.toLowerCase() === right.toLowerCase() : left === right;
  if (!root.parts.every((part, index) => equal(part, base.parts[index]))) return null;
  const parts = normalizeSegments(base.parts, path, root.parts.length, base.windows, base.windows);
  return parts ? nativePathText(base, parts) : null;
};

/** Parse a Markdown file target; relative targets require an explicit filesystem base. */
export const resolveLocalFileLinkReference = (
  rawHref: string,
  resolvedHref?: string,
  baseDirectory?: string,
  options: LocalFileLinkOptions = {}
): LocalFileLinkReference | null => {
  const input = rawHref || resolvedHref || '';
  const raw = options.inputKind === 'path' ? input : input.trim();
  if (options.inputKind === 'path') {
    const native = parseNativePath(raw);
    // A known native path is already an identity; preserve literal separators,
    // percent characters, suffix whitespace and symlink-sensitive dot segments.
    const path = native ? raw : baseDirectory ? resolveWorkspacePath(raw, baseDirectory, options.rootDirectory) : null;
    return path ? formatReference(path, {}) : null;
  }
  const parsed = parseHref(raw);
  if (!parsed) return null;
  const native = parseNativePath(parsed.path);
  if (native) return parsed.absoluteHint ? formatReference(nativePathText(native), parsed.location) : null;
  const path = baseDirectory ? resolveWorkspacePath(parsed.path, baseDirectory, options.rootDirectory) : null;
  return path ? formatReference(path, parsed.location) : null;
};

export const resolveLocalFileLinkPath = (
  rawHref: string,
  resolvedHref?: string,
  baseDirectory?: string,
  options: LocalFileLinkOptions = {}
): string | null => resolveLocalFileLinkReference(rawHref, resolvedHref, baseDirectory, options)?.filePath ?? null;

/** Resolve a project-relative href without filesystem, drive or host assumptions. */
export const resolveRelativeFileLinkReference = (
  rawHref: string,
  relativeDirectory: string
): LocalFileLinkReference | null => {
  const parsed = parseHref(rawHref);
  if (
    !parsed ||
    parsed.explicitFile ||
    !isRelativeTarget(parsed.path) ||
    (relativeDirectory && !isRelativeTarget(relativeDirectory.replace(/[\\/]+$/, '')))
  )
    return null;
  const directory = normalizeSegments([], relativeDirectory, 0, true, true);
  const parts = directory && normalizeSegments(directory, parsed.path, 0, true, true);
  return parts?.length ? formatReference(parts.join('/'), parsed.location) : null;
};

export { toLocalFileHref } from '@/renderer/utils/file/fileUrls';

/**
 * Get line background style for diff rendering.
 * Highlights additions (green), deletions (red), and hunk headers (blue).
 */
export const getDiffLineStyle = (line: string, isDark: boolean): React.CSSProperties => {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return { backgroundColor: isDark ? diffColors.additionBgDark : diffColors.additionBgLight };
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return { backgroundColor: isDark ? diffColors.deletionBgDark : diffColors.deletionBgLight };
  }
  if (line.startsWith('@@')) {
    return { backgroundColor: isDark ? diffColors.hunkBgDark : diffColors.hunkBgLight };
  }
  return {};
};

export type DiagramSize = { width: number; height: number };

/**
 * Cap an inline SVG diagram at min(container, natural width): narrow diagrams
 * (e.g. top-down layouts) render 1:1 at their natural size instead of being
 * stretched across the message column; wide diagrams still fit the column.
 * Shared by MermaidBlock and WavedromBlock.
 */
export const withResponsiveSvg = (svg: string): string => {
  const intrinsicWidth = getSvgIntrinsicSize(svg)?.width;
  const maxWidth = intrinsicWidth ? `min(100%, ${intrinsicWidth}px)` : '100%';
  return svg.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
    if (/style\s*=/.test(attrs)) {
      return `<svg${attrs.replace(
        /style\s*=\s*(["'])(.*?)\1/i,
        (_styleMatch, quote: string, styleValue: string) =>
          ` style=${quote}${styleValue};max-width: ${maxWidth}; height: auto; display: block;${quote}`
      )}>`;
    }
    return `<svg${attrs} style="max-width: ${maxWidth}; height: auto; display: block;">`;
  });
};

/**
 * Extract a diagram SVG's natural size from its markup so callers can size it by
 * its own aspect ratio instead of by the container. Mermaid always emits a
 * viewBox; numeric width/height attributes are a fallback for hand-written SVGs.
 */
export const getSvgIntrinsicSize = (svg: string): DiagramSize | null => {
  const svgTag = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!svgTag) return null;

  const viewBox = /viewBox\s*=\s*["']\s*[\d.eE+-]+\s+[\d.eE+-]+\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s*["']/i.exec(svgTag);
  if (viewBox) {
    const width = parseFloat(viewBox[1]);
    const height = parseFloat(viewBox[2]);
    if (width > 0 && height > 0) return { width, height };
  }

  const widthAttr = /width\s*=\s*["']([\d.]+)\s*(?:px)?["']/i.exec(svgTag);
  const heightAttr = /height\s*=\s*["']([\d.]+)\s*(?:px)?["']/i.exec(svgTag);
  if (widthAttr && heightAttr) {
    const width = parseFloat(widthAttr[1]);
    const height = parseFloat(heightAttr[1]);
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
};
