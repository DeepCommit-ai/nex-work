/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  resolveLocalFileLinkPath,
  resolveLocalFileLinkReference,
  resolveRelativeFileLinkReference,
  toLocalFileHref,
} from '@/renderer/components/Markdown/markdownUtils';

describe('resolveLocalFileLinkPath', () => {
  it.each([
    ['file://localhost/Users/demo/README', '/Users/demo/README'],
    ['file:///README', '/README'],
    ['/report.md', '/report.md'],
    ['file://server/share/中文%20报告.md', '\\\\server\\share\\中文 报告.md'],
    ['\\\\server\\share\\report.md', '\\\\server\\share\\report.md'],
    ['\\\\?\\C:\\reports\\report.md', '\\\\?\\C:\\reports\\report.md'],
    ['\\\\?\\UNC\\server\\share\\report.md', '\\\\?\\UNC\\server\\share\\report.md'],
    ['file:///tmp/report%23draft%3F1.md', '/tmp/report#draft?1.md'],
    ['file:///tmp/literal%2520name.md', '/tmp/literal%20name.md'],
    ['file:///tmp/100%25%20中文.md', '/tmp/100% 中文.md'],
  ])('resolves unambiguous native/file URL identity %s', (href, expected) => {
    expect(resolveLocalFileLinkPath(href)).toBe(expected);
  });

  it('preserves known native names without decoding or parsing #?% as link syntax', () => {
    expect(resolveLocalFileLinkPath('/tmp/literal%20name#draft?.md', undefined, undefined, { inputKind: 'path' })).toBe(
      '/tmp/literal%20name#draft?.md'
    );
    expect(resolveLocalFileLinkPath('/README', undefined, undefined, { inputKind: 'path' })).toBe('/README');
    expect(resolveLocalFileLinkPath('/tmp/a\\b%20.md ', undefined, undefined, { inputKind: 'path' })).toBe(
      '/tmp/a\\b%20.md '
    );
  });

  it('recognizes extensionless workspace links and keeps a literal percent filename intact', () => {
    expect(resolveLocalFileLinkPath('docs/README', undefined, '/workspace')).toBe('/workspace/docs/README');
    expect(resolveLocalFileLinkPath('100%25%20report.md', undefined, '/workspace')).toBe('/workspace/100% report.md');
  });

  it('uses an explicit outer root for document-directory links without escaping it', () => {
    expect(
      resolveLocalFileLinkPath('../report.md', undefined, 'C:/workspace/docs', { rootDirectory: 'C:/workspace' })
    ).toBe('C:/workspace/report.md');
    expect(
      resolveLocalFileLinkPath('../../outside.md', undefined, 'C:/workspace/docs', { rootDirectory: 'C:/workspace' })
    ).toBeNull();
  });

  it('shares single-decoding and project-root containment for relative project identities', () => {
    expect(resolveRelativeFileLinkReference('../assets/a%23b%3Fc%2520.md#L5', 'docs')).toEqual({
      filePath: 'assets/a#b?c%20.md',
      rawReference: 'assets/a#b?c%20.md#L5',
      line: 5,
    });
    expect(resolveRelativeFileLinkReference('../../outside.md', 'docs')).toBeNull();
  });

  it.each([
    'file:///tmp/report.md',
    'C:/report.md',
    '\\\\server\\share\\report.md',
    '//example.com/report.md',
    'https://example.com/report.md',
    '#heading',
    '/settings',
    '~/report.md',
  ])('does not reinterpret a non-relative project link: %s', (href) => {
    expect(resolveRelativeFileLinkReference(href, 'docs')).toBeNull();
  });

  it('encodes literal reserved characters without decoding existing native percent characters', () => {
    expect(toLocalFileHref('/tmp/a#b?c%20.md')).toBe('file:///tmp/a%23b%3Fc%2520.md');
  });
  it('resolves a report link against an explicit Windows conversation workspace', () => {
    expect(resolveLocalFileLinkReference('runs/2026-10-25/report.md', undefined, 'C:\\NexWork\\conversation')).toEqual({
      filePath: 'C:/NexWork/conversation/runs/2026-10-25/report.md',
      rawReference: 'C:/NexWork/conversation/runs/2026-10-25/report.md',
    });
  });

  it('decodes relative Chinese filenames and normalizes segments within the workspace', () => {
    expect(
      resolveLocalFileLinkReference(
        './runs/tmp/../%E4%B8%AD%E6%96%87%20%E6%8A%A5%E5%91%8A.md#L12',
        undefined,
        'C:\\测试 用户\\任务目录'
      )
    ).toEqual({
      filePath: 'C:/测试 用户/任务目录/runs/中文 报告.md',
      rawReference: 'C:/测试 用户/任务目录/runs/中文 报告.md#L12',
      line: 12,
    });
  });

  it('resolves a POSIX workspace without losing its filesystem root', () => {
    expect(resolveLocalFileLinkPath('runs/report.md', undefined, '/workspace/demo')).toBe(
      '/workspace/demo/runs/report.md'
    );
  });

  it.each(['../outside.md', 'runs/../../outside.md', '%2e%2e/outside.md', '..\\outside.md', '..%20/outside.md'])(
    'rejects workspace escapes: %s',
    (href) => {
      expect(resolveLocalFileLinkPath(href, undefined, 'C:/workspace')).toBeNull();
    }
  );

  it.each([
    'https://example.com/report.md',
    'http://example.com/report.md',
    'mailto:test@example.com',
    '#heading',
    '//example.com/report.md',
    'javascript:alert(1)',
    'data:text/plain,report.md',
    '/settings',
  ])('does not turn a non-file link into a workspace file: %s', (href) => {
    expect(resolveLocalFileLinkPath(href, undefined, 'C:/workspace')).toBeNull();
  });

  it('does not guess a root for relative files when the workspace is missing or relative', () => {
    expect(resolveLocalFileLinkPath('runs/report.md')).toBeNull();
    expect(resolveLocalFileLinkPath('runs/report.md', undefined, 'relative-workspace')).toBeNull();
  });

  it('recognizes Windows absolute paths emitted as root-relative markdown links', () => {
    expect(resolveLocalFileLinkPath('/C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx')).toBe(
      'C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx'
    );
  });

  it('recognizes encoded file URLs', () => {
    expect(resolveLocalFileLinkPath('file:///C:/Users/Administrator/%E7%9C%8B%E6%9D%BF.xlsx')).toBe(
      'C:/Users/Administrator/看板.xlsx'
    );
  });

  it('recognizes common POSIX absolute paths', () => {
    expect(resolveLocalFileLinkPath('/Users/demo/outputs/report.xlsx')).toBe('/Users/demo/outputs/report.xlsx');
  });

  it('recognizes file-like POSIX absolute paths outside common home and temp roots', () => {
    expect(resolveLocalFileLinkPath('/opt/aionui/outputs/report.xlsx')).toBe('/opt/aionui/outputs/report.xlsx');
  });

  it('recognizes line suffixes without confusing Windows drive letters', () => {
    const reference = resolveLocalFileLinkReference('C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421');

    expect(reference).toEqual({
      filePath: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log',
      rawReference: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421',
      line: 1421,
    });
    expect(resolveLocalFileLinkPath('C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421')).toBe(
      'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log'
    );
  });

  it('recognizes line and column suffixes without including the line in the file path', () => {
    const reference = resolveLocalFileLinkReference(
      'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421:7'
    );

    expect(reference).toEqual({
      filePath: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log',
      rawReference: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421:7',
      line: 1421,
      column: 7,
    });
    expect(resolveLocalFileLinkPath('C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421:7')).toBe(
      'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log'
    );
  });

  it('recognizes POSIX hash line references', () => {
    expect(resolveLocalFileLinkReference('/Users/demo/file.ts#L10')).toEqual({
      filePath: '/Users/demo/file.ts',
      rawReference: '/Users/demo/file.ts#L10',
      line: 10,
    });

    expect(resolveLocalFileLinkReference('/Users/demo/file.ts#L10-L20')).toEqual({
      filePath: '/Users/demo/file.ts',
      rawReference: '/Users/demo/file.ts#L10-L20',
      line: 10,
      endLine: 20,
    });
  });

  it('recognizes file URL hash line references and normalizes raw references', () => {
    expect(resolveLocalFileLinkReference('file:///Users/demo/file.ts#L10')).toEqual({
      filePath: '/Users/demo/file.ts',
      rawReference: '/Users/demo/file.ts#L10',
      line: 10,
    });

    expect(resolveLocalFileLinkReference('file:///Users/demo/file.ts#L10-L20')).toEqual({
      filePath: '/Users/demo/file.ts',
      rawReference: '/Users/demo/file.ts#L10-L20',
      line: 10,
      endLine: 20,
    });

    expect(resolveLocalFileLinkReference('file:///Users/demo/My%20File.ts#L10')).toEqual({
      filePath: '/Users/demo/My File.ts',
      rawReference: '/Users/demo/My File.ts#L10',
      line: 10,
    });

    expect(resolveLocalFileLinkReference('file:///Users/demo/%E6%96%87%E4%BB%B6.ts#L10')).toEqual({
      filePath: '/Users/demo/文件.ts',
      rawReference: '/Users/demo/文件.ts#L10',
      line: 10,
    });
  });

  it('recognizes Windows file URL hash lines and ranges', () => {
    expect(resolveLocalFileLinkReference('file:///C:/Users/demo/file.ts#L10')).toEqual({
      filePath: 'C:/Users/demo/file.ts',
      rawReference: 'C:/Users/demo/file.ts#L10',
      line: 10,
    });

    expect(resolveLocalFileLinkReference('file:///C:/Users/demo/file.ts#L10-L20')).toEqual({
      filePath: 'C:/Users/demo/file.ts',
      rawReference: 'C:/Users/demo/file.ts#L10-L20',
      line: 10,
      endLine: 20,
    });
  });

  it('prioritizes hash line references over colon suffixes', () => {
    expect(resolveLocalFileLinkReference('/Users/demo/file.ts:10#L20')).toEqual({
      filePath: '/Users/demo/file.ts',
      rawReference: '/Users/demo/file.ts#L20',
      line: 20,
    });
  });

  it('rejects unsupported hash line formats and remote hash links', () => {
    expect(resolveLocalFileLinkReference('user.ts')).toBeNull();
    expect(resolveLocalFileLinkReference('./user.ts')).toBeNull();
    expect(resolveLocalFileLinkReference('../user.ts')).toBeNull();
    expect(resolveLocalFileLinkReference('/settings')).toBeNull();
    expect(resolveLocalFileLinkReference('https://aionui.com/docs#L10')).toBeNull();
    expect(resolveLocalFileLinkReference('https://github.com/org/repo/blob/main/file.ts#L10')).toBeNull();
    expect(resolveLocalFileLinkReference('/Users/demo/file.ts#l10')).toBeNull();
    expect(resolveLocalFileLinkReference('/Users/demo/file.ts#L10-l20')).toBeNull();
  });

  it('does not treat normal web links or app routes as local files', () => {
    expect(resolveLocalFileLinkPath('https://aionui.com/docs')).toBeNull();
    expect(resolveLocalFileLinkPath('/settings')).toBeNull();
  });

  it('formats local file paths as file URLs for browser link copying', () => {
    expect(toLocalFileHref('C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx')).toBe(
      'file:///C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx'
    );
    expect(toLocalFileHref('/var/folders/demo/report.xlsx')).toBe('file:///var/folders/demo/report.xlsx');
  });
});
