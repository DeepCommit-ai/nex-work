/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownView from '@/renderer/components/Markdown';
import { useLocalFilePreview } from '@/renderer/pages/conversation/Preview/hooks/useLocalFilePreview';

const copyTextMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const previewMocks = vi.hoisted(() => ({
  openPreview: vi.fn(),
  metadata: vi.fn().mockResolvedValue({ size: 128, lastModified: 1 }),
  read: vi.fn().mockResolvedValue('Synthetic report fixture'),
  external: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      getContentMetadata: { invoke: previewMocks.metadata },
      readContent: { invoke: previewMocks.read },
    },
  },
}));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  useOptionalPreviewContext: () => null,
  usePreviewContext: () => ({ openPreview: previewMocks.openPreview }),
}));
vi.mock('@/renderer/pages/conversation/explorer/currentProjectStore', () => ({ getCurrentProject: () => null }));
vi.mock('@/renderer/services/clientBusinessSettings', () => ({ getClientBusinessSetting: async () => 1 }));

vi.mock('@/renderer/components/Markdown/ShadowView', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/Markdown/CodeBlock', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <code>{children}</code>,
}));

vi.mock('@/renderer/components/media/LocalImageView', () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

vi.mock('@/renderer/utils/chat/latexDelimiters', () => ({
  convertLatexDelimiters: (text: string) => text,
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: previewMocks.external,
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: copyTextMock,
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button type='button' {...props}>
      {icon}
      {children}
    </button>
  ),
  Message: {
    error: vi.fn(),
  },
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@icon-park/react', () => ({
  Copy: () => <span data-testid='copy-icon' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('MarkdownView local file links', () => {
  beforeEach(() => {
    copyTextMock.mockClear();
    previewMocks.openPreview.mockClear();
    previewMocks.metadata.mockClear();
    previewMocks.read.mockClear();
    previewMocks.external.mockClear();
  });

  it('routes a relative workspace report click through ChatFileRef metadata and content preview', async () => {
    const Harness = () => {
      const open = useLocalFilePreview('C:\\NexWork\\conversation');
      return (
        <MarkdownView baseDirectory='C:\\NexWork\\conversation' onLocalFileLink={open}>
          {'[runs/2026-10-25/report.md](runs/2026-10-25/report.md)'}
        </MarkdownView>
      );
    };
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'runs/2026-10-25/report.md' }));

    await waitFor(() =>
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        'Synthetic report fixture',
        'markdown',
        expect.objectContaining({
          fileRef: { kind: 'local', path: 'C:/NexWork/conversation/runs/2026-10-25/report.md' },
          file_path: 'C:/NexWork/conversation/runs/2026-10-25/report.md',
          workspace: 'C:\\NexWork\\conversation',
        }),
        { replace: true }
      )
    );
    expect(previewMocks.read).toHaveBeenCalledWith({
      file: { kind: 'local', path: 'C:/NexWork/conversation/runs/2026-10-25/report.md' },
      encoding: 'utf8',
    });
    expect(previewMocks.external).not.toHaveBeenCalled();
  });

  it.each([
    'https://example.com/report.md',
    'http://example.com/report.md',
    'mailto:test@example.com',
    '#heading',
    '//example.com/report.md',
  ])('keeps non-file targets outside the workspace preview: %s', (href) => {
    render(<MarkdownView baseDirectory='C:/workspace' onLocalFileLink={vi.fn()}>{`[target](${href})`}</MarkdownView>);
    expect(screen.getByRole('link', { name: 'target' })).toHaveAttribute('href', href);
    expect(screen.queryByRole('button', { name: 'target' })).not.toBeInTheDocument();
  });

  it('does not resolve a relative report using the renderer URL when the workspace is absent', () => {
    const onLocalFileLink = vi.fn();
    render(<MarkdownView onLocalFileLink={onLocalFileLink}>{'[report](runs/report.md)'}</MarkdownView>);
    expect(screen.getByRole('link', { name: 'report' })).toHaveAttribute('href', 'runs/report.md');
    expect(screen.queryByRole('button', { name: 'report' })).not.toBeInTheDocument();
  });

  it('renders local file links as app controls instead of browser anchors', () => {
    const onLocalFileLink = vi.fn();

    render(
      <MarkdownView onLocalFileLink={onLocalFileLink}>
        {'[report.xlsx](/C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx)'}
      </MarkdownView>
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'report.xlsx' }));
    expect(onLocalFileLink).toHaveBeenCalledWith(
      'C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx',
      expect.objectContaining({
        filePath: 'C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copyTextMock).toHaveBeenCalledWith('C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx');
  });

  it('renders line references as file chips and copies the full reference', () => {
    const onLocalFileLink = vi.fn();

    render(
      <MarkdownView onLocalFileLink={onLocalFileLink}>
        {'[2026-06-19.log](C:/Users/Administrator/AppData/Roaming/AionUi/logs/2026-06-19.log:1421)'}
      </MarkdownView>
    );

    const fileButton = screen.getByRole('button', { name: /2026-06-19\.log\s+L1421/ });
    fireEvent.click(fileButton);

    expect(onLocalFileLink).toHaveBeenCalledWith(
      'C:/Users/Administrator/AppData/Roaming/AionUi/logs/2026-06-19.log',
      expect.objectContaining({
        filePath: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/2026-06-19.log',
        rawReference: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/2026-06-19.log:1421',
        line: 1421,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copyTextMock).toHaveBeenCalledWith('C:/Users/Administrator/AppData/Roaming/AionUi/logs/2026-06-19.log:1421');
  });

  it('renders line and column references as file chips and copies the full reference', () => {
    const onLocalFileLink = vi.fn();

    render(
      <MarkdownView onLocalFileLink={onLocalFileLink}>
        {'[app.log](C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421:7)'}
      </MarkdownView>
    );

    const fileButton = screen.getByRole('button', { name: /app\.log\s+L1421:7/ });
    fireEvent.click(fileButton);

    expect(onLocalFileLink).toHaveBeenCalledWith(
      'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log',
      expect.objectContaining({
        filePath: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log',
        rawReference: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421:7',
        line: 1421,
        column: 7,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copyTextMock).toHaveBeenCalledWith('C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421:7');
  });

  it('renders hash range references as file chips and copies normalized local references', () => {
    const onLocalFileLink = vi.fn();

    render(
      <MarkdownView onLocalFileLink={onLocalFileLink}>
        {'[user.js 1-260行](/Users/demo/project/user.js#L1-L260)'}
      </MarkdownView>
    );

    expect(screen.queryByRole('link', { name: /user\.js/ })).not.toBeInTheDocument();

    const fileButton = screen.getByRole('button', { name: /user\.js 1-260行\s+L1-L260/ });
    fireEvent.click(fileButton);

    expect(onLocalFileLink).toHaveBeenCalledWith(
      '/Users/demo/project/user.js',
      expect.objectContaining({
        filePath: '/Users/demo/project/user.js',
        rawReference: '/Users/demo/project/user.js#L1-L260',
        line: 1,
        endLine: 260,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copyTextMock).toHaveBeenCalledWith('/Users/demo/project/user.js#L1-L260');
  });

  it('does not render a no-op open button when no local file handler is provided', () => {
    render(<MarkdownView>{'[report.xlsx](/C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx)'}</MarkdownView>);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'report.xlsx' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copyTextMock).toHaveBeenCalledWith('C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx');
  });

  it('keeps ordinary http links as browser anchors', () => {
    render(<MarkdownView>{'[docs](https://aionui.com/docs)'}</MarkdownView>);

    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('href', 'https://aionui.com/docs');
  });

  it('keeps http hash links as browser anchors', () => {
    render(<MarkdownView>{'[docs](https://aionui.com/docs#L10)'}</MarkdownView>);

    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('href', 'https://aionui.com/docs#L10');
  });

  it('adds empty alt text to external raw HTML images without alt text', () => {
    const { container } = render(
      <MarkdownView allowHtml>{'<img src="https://example.com/generated.png" />'}</MarkdownView>
    );

    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', 'https://example.com/generated.png');
    expect(image).toHaveAttribute('alt', '');
  });
});
