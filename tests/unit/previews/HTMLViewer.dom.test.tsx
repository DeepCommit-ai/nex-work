/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

const writeRendererLogInvoke = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const readContentInvoke = vi.hoisted(() => vi.fn());

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      readContent: { invoke: readContentInvoke },
      getImageBase64: { invoke: vi.fn(() => Promise.resolve('')) },
      readFile: { invoke: vi.fn(() => Promise.resolve('')) },
    },
    application: {
      writeRendererLog: { invoke: writeRendererLogInvoke },
    },
  },
}));

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <div data-testid='monaco-editor'>{value}</div>,
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    useMessage: () => [{ info: vi.fn(), success: vi.fn(), error: vi.fn() }, null],
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import HTMLViewer from '@/renderer/pages/conversation/Preview/components/viewers/HTMLViewer';
import HTMLRenderer from '@/renderer/pages/conversation/Preview/components/renderers/HTMLRenderer';

function createConsoleMessageEvent({
  level,
  line,
  message,
  sourceId,
}: {
  level: number;
  line: number;
  message: string;
  sourceId: string;
}): Event {
  const event = new Event('console-message');
  Object.defineProperties(event, {
    level: { value: level },
    line: { value: line },
    message: { value: message },
    sourceId: { value: sourceId },
  });
  return event;
}

describe('HTMLViewer', () => {
  it('uses an encoded Windows file directory for relative HTML resources', () => {
    const { container } = render(<HTMLViewer content='<h1>Test</h1>' file_path={'C:\\报告 #100%\\index.html'} />);
    expect(container.querySelector('iframe')?.contentDocument?.querySelector('base')?.getAttribute('href')).toBe(
      'file:///C:/%E6%8A%A5%E5%91%8A%20%23100%25/'
    );
  });

  it('renders iframe with HTML content', () => {
    const { container } = render(<HTMLViewer content='<h1>Test</h1>' />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
  });

  it('hides toolbar when hideToolbar is true', () => {
    const { container } = render(<HTMLViewer content='<h1>Test</h1>' hideToolbar />);
    expect(container.querySelector('[class*="toolbar"]')).not.toBeInTheDocument();
  });

  it('accepts file_path prop', () => {
    const { container } = render(<HTMLViewer content='<h1>Test</h1>' file_path='/test/index.html' />);
    expect(container.querySelector('iframe')).toBeInTheDocument();
  });
});

describe('HTMLRenderer', () => {
  const electronAPI = {};

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    vi.clearAllMocks();
  });

  it('loads project HTML assets by the owning file reference without an absolute path', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: electronAPI });
    readContentInvoke.mockImplementation(({ file }: { file: { relative_path: string } }) => {
      if (file.relative_path === 'reports/style.css') return Promise.resolve('.report { color: green }');
      if (file.relative_path === 'assets/图 #1.png') return Promise.resolve('data:image/png;base64,cGl4ZWw=');
      return Promise.reject(new Error('unexpected project asset'));
    });
    const { container } = render(
      <HTMLRenderer
        content={'<link rel="stylesheet" href="style.css"><img src="../assets/%E5%9B%BE%20%231.png">'}
        fileRef={{ kind: 'project', pe_id: 'owning-project-root', relative_path: 'reports/index.html' }}
      />
    );
    await waitFor(() => {
      const source = container.querySelector('webview')?.getAttribute('src') || '';
      expect(decodeURIComponent(source)).toContain('.report { color: green }');
    });
    expect(readContentInvoke).toHaveBeenCalledWith({
      file: { kind: 'project', pe_id: 'owning-project-root', relative_path: 'assets/图 #1.png' },
      encoding: 'dataurl',
    });
    expect(decodeURIComponent(container.querySelector('webview')?.getAttribute('src') || '')).toContain(
      'data:image/png;base64,cGl4ZWw='
    );
  });

  it('does not read a project HTML resource outside its root', async () => {
    const { container } = render(
      <HTMLRenderer
        content='<img src="../../outside.png">'
        fileRef={{ kind: 'project', pe_id: 'root', relative_path: 'index.html' }}
      />
    );
    await waitFor(() => expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toContain('outside.png'));
    expect(readContentInvoke).not.toHaveBeenCalled();
  });

  it.each([
    ['C:\\报告 #100%\\index.html', 'file:///C:/%E6%8A%A5%E5%91%8A%20%23100%25/index.html'],
    ['/Users/demo/报告 #100%/index.html', 'file:///Users/demo/%E6%8A%A5%E5%91%8A%20%23100%25/index.html'],
    ['\\\\server\\share\\report #1.html', 'file://server/share/report%20%231.html'],
  ])('opens the exact local HTML path without interpreting filename punctuation: %s', (filePath, expected) => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: electronAPI });
    const { container } = render(<HTMLRenderer content='<h1>Test</h1>' file_path={filePath} />);
    expect(container.querySelector('webview')?.getAttribute('src')).toBe(expected);
  });

  it('waits for project resources before mounting executable HTML', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: electronAPI });
    let complete: ((value: string) => void) | undefined;
    readContentInvoke.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        })
    );
    const { container } = render(
      <HTMLRenderer
        content='<script src="lib.js"></script><script>renderChart()</script>'
        fileRef={{ kind: 'project', pe_id: 'pe-wait', relative_path: 'report.html' }}
      />
    );
    expect(container.querySelector('webview')).toBeNull();
    await waitFor(() => expect(complete).toBeDefined());
    complete?.('function renderChart() {}');
    await waitFor(() =>
      expect(container.querySelector('webview')?.getAttribute('src')).toContain('function%20renderChart')
    );
  });

  it('gives dirty Windows HTML an encoded base directory for relative links', () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: electronAPI });
    const { container } = render(
      <HTMLRenderer content='<h1>Unsaved</h1>' file_path={'C:\\报告 #100%\\index.html'} isDirty />
    );
    const source = container.querySelector('webview')?.getAttribute('src') || '';
    const html = decodeURIComponent(source.slice(source.indexOf(',') + 1));
    expect(html).toContain('<base href="file:///C:/%E6%8A%A5%E5%91%8A%20%23100%25/">');
  });

  it('loads clean local HTML files through file URL in Electron', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: electronAPI,
    });

    const { container } = render(
      <HTMLRenderer
        content='<script src="https://cdn.example.com/app.js"></script><script>localStorage.getItem("theme")</script>'
        file_path='/workspace/financial-wechat-miniapp.html'
      />
    );

    const webview = container.querySelector('webview');
    expect(webview).toBeInTheDocument();
    expect(webview?.getAttribute('src')).toBe('file:///workspace/financial-wechat-miniapp.html');
  });

  it('keeps dirty local HTML content in memory in Electron', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: electronAPI,
    });

    const dirtyProps = {
      content: '<h1>Unsaved edit</h1>',
      file_path: '/workspace/index.html',
      isDirty: true,
    } as React.ComponentProps<typeof HTMLRenderer> & { isDirty: boolean };

    const { container } = render(<HTMLRenderer {...dirtyProps} />);

    const webview = container.querySelector('webview');
    expect(webview).toBeInTheDocument();
    expect(webview?.getAttribute('src')).toContain('data:text/html');
    expect(webview?.getAttribute('src')).toContain('Unsaved%20edit');
  });

  it('writes preview source selection to the renderer log bridge', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: electronAPI,
    });

    render(<HTMLRenderer content='<h1>Test</h1>' file_path='/workspace/financial-wechat-miniapp.html' />);

    await waitFor(() =>
      expect(writeRendererLogInvoke).toHaveBeenCalledWith({
        level: 'info',
        tag: 'HTMLRenderer',
        message: 'html_preview_source_selected',
        data: expect.objectContaining({
          source: 'file',
          reason: 'clean-local-file',
          fileName: 'financial-wechat-miniapp.html',
          hasFilePath: true,
          contentLength: 13,
          src: 'file://financial-wechat-miniapp.html',
        }),
      })
    );
  });

  it('writes level 2 preview console messages as renderer warnings', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: electronAPI,
    });

    const { container } = render(<HTMLRenderer content='<h1>Test</h1>' file_path='/workspace/index.html' />);
    const webview = container.querySelector('webview');

    await waitFor(() => expect(writeRendererLogInvoke).toHaveBeenCalled());
    vi.clearAllMocks();

    webview?.dispatchEvent(
      createConsoleMessageEvent({
        level: 2,
        line: 64,
        message: 'cdn.tailwindcss.com should not be used in production.',
        sourceId: 'https://cdn.tailwindcss.com/',
      })
    );

    await waitFor(() =>
      expect(writeRendererLogInvoke).toHaveBeenCalledWith({
        level: 'warn',
        tag: 'HTMLRenderer',
        message: 'html_preview_console_warning',
        data: {
          level: 2,
          line: 64,
          message: 'cdn.tailwindcss.com should not be used in production.',
          source: 'https://cdn.tailwindcss.com/',
        },
      })
    );
  });
});
