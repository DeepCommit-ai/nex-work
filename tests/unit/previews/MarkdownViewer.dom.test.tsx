/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const previewMocks = vi.hoisted(() => ({
  openPreview: vi.fn(),
  currentProject: null as string | null,
}));
const copyTextMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/common', () => ({
  ipcBridge: {
    project: { resolveRef: { invoke: vi.fn() } },
    fs: {
      fetchRemoteImage: { invoke: vi.fn() },
      getImageBase64: { invoke: vi.fn() },
      getFileMetadata: { invoke: vi.fn() },
      readFile: { invoke: vi.fn() },
      // ChatFileRef content endpoints — local file links open via a Local ref.
      getContentMetadata: { invoke: vi.fn() },
      readContent: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/pages/conversation/explorer/currentProjectStore', () => ({
  getCurrentProject: () => previewMocks.currentProject,
}));
vi.mock('@/renderer/services/clientBusinessSettings', () => ({ getClientBusinessSetting: async () => 1 }));

vi.mock('@/common/chat/chatLib', () => ({
  joinPath: (base: string, rel: string) => `${base}/${rel}`,
}));

vi.mock('@/renderer/hooks/chat/useAutoScroll', () => ({
  useAutoScroll: () => {},
}));

vi.mock('@/renderer/hooks/ui/useTextSelection', () => ({
  useTextSelection: () => ({ selectedText: '', selectionPosition: null, clearSelection: vi.fn() }),
}));

vi.mock('@/renderer/hooks/chat/useTypingAnimation', () => ({
  useTypingAnimation: ({ content }: { content: string }) => ({
    displayedContent: content,
    isAnimating: false,
  }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: copyTextMock,
}));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({
    openPreview: previewMocks.openPreview,
  }),
}));

vi.mock('@/renderer/utils/chat/latexDelimiters', () => ({
  convertLatexDelimiters: (text: string) => text,
}));

vi.mock('@/renderer/pages/conversation/Preview/components/editors/MarkdownEditor', () => ({
  default: () => <div data-testid='markdown-editor' />,
}));

vi.mock('@/renderer/pages/conversation/Preview/components/renderers/SelectionToolbar', () => ({
  default: () => <div data-testid='selection-toolbar' />,
}));

vi.mock('@/renderer/pages/conversation/Preview/hooks/useScrollSyncHelpers', () => ({
  useContainerScroll: vi.fn(),
  useContainerScrollTarget: vi.fn(),
}));

vi.mock('@/renderer/components/Markdown/MermaidBlock', () => ({
  default: () => <div data-testid='mermaid-block' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
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

import MarkdownViewer from '@/renderer/pages/conversation/Preview/components/viewers/MarkdownViewer';
import { ipcBridge } from '@/common';
import { useLocalFilePreview } from '@/renderer/pages/conversation/Preview/hooks/useLocalFilePreview';

const fileMetadata = (path: string) => ({
  name: path.split(/[\\/]/).pop() || path,
  path,
  size: 128,
  type: 'file',
  lastModified: 1_717_000_000,
});

describe('MarkdownViewer', () => {
  beforeEach(() => {
    previewMocks.openPreview.mockClear();
    previewMocks.currentProject = null;
    vi.mocked(ipcBridge.project.resolveRef.invoke).mockReset();
    copyTextMock.mockClear();
    vi.mocked(ipcBridge.fs.getFileMetadata.invoke).mockReset();
    vi.mocked(ipcBridge.fs.getImageBase64.invoke).mockReset();
    vi.mocked(ipcBridge.fs.readFile.invoke).mockReset();
    vi.mocked(ipcBridge.fs.fetchRemoteImage.invoke).mockReset();
    // Default: file exists (metadata resolves); tests that read set readContent.
    vi.mocked(ipcBridge.fs.getContentMetadata.invoke).mockReset().mockResolvedValue(fileMetadata('/x'));
    vi.mocked(ipcBridge.fs.readContent.invoke).mockReset().mockResolvedValue('');
  });

  it('renders markdown content in preview mode', () => {
    render(<MarkdownViewer content='# Hello World' />);
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('renders MarkdownEditor in source mode', () => {
    render(<MarkdownViewer content='# Test' viewMode='source' />);
    expect(screen.getByTestId('markdown-editor')).toBeInTheDocument();
  });

  it('hides toolbar when hideToolbar is true', () => {
    render(<MarkdownViewer content='# Test' hideToolbar />);
    expect(screen.queryByText('preview.preview')).not.toBeInTheDocument();
  });

  it('opens local file links in the preview panel instead of browser windows', async () => {
    const filePath = '/Users/demo/Desktop/chart.jpg';
    vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('data:image/jpeg;base64,abc123');

    render(<MarkdownViewer content={`[image](${filePath})`} file_path='/Users/demo/Desktop/test.md' />);

    expect(screen.queryByRole('link', { name: 'image' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'image' }));

    await waitFor(() => {
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        'data:image/jpeg;base64,abc123',
        'image',
        expect.objectContaining({
          file_name: 'chart.jpg',
          fileRef: { kind: 'local', path: filePath },
          file_path: filePath,
          language: 'jpg',
          editable: false,
        })
      );
    });
    // Image link content read as a data URL over /content by Local ref.
    expect(ipcBridge.fs.readContent.invoke).toHaveBeenCalledWith({
      file: { kind: 'local', path: filePath },
      encoding: 'dataurl',
    });
  });

  it('opens hash range local file links at the start line in preview mode', async () => {
    const filePath = '/Users/demo/Desktop/app.ts';
    vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('const value = 1;\n');

    render(<MarkdownViewer content={`[app.ts](${filePath}#L10-L20)`} file_path='/Users/demo/Desktop/test.md' />);

    expect(screen.queryByRole('link', { name: /app\.ts/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /app\.ts\s+L10-L20/ }));

    await waitFor(() => {
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        'const value = 1;\n',
        'code',
        expect.objectContaining({
          file_name: 'app.ts',
          file_path: filePath,
          language: 'ts',
          targetLine: 10,
          targetColumn: undefined,
          oversized: false,
          lastModified: 1_717_000_000,
        })
      );
    });

    const metadata = previewMocks.openPreview.mock.calls[0]?.[2];
    expect(metadata).not.toHaveProperty('endLine');
    expect(metadata).not.toHaveProperty('targetEndLine');
  });

  it('opens encoded file URL hash links in preview mode', async () => {
    const filePath = '/Users/demo/Desktop/My File.ts';
    vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('const value = 1;\n');

    render(<MarkdownViewer content='[encoded file](file:///Users/demo/Desktop/My%20File.ts#L1)' />);

    expect(screen.queryByRole('link', { name: 'encoded file' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /encoded file\s+L1/ }));

    await waitFor(() => {
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        'const value = 1;\n',
        'code',
        expect.objectContaining({
          file_name: 'My File.ts',
          file_path: filePath,
          language: 'ts',
          targetLine: 1,
          targetColumn: undefined,
          oversized: false,
          lastModified: 1_717_000_000,
        })
      );
    });
  });

  it('keeps remote links as browser anchors', () => {
    render(<MarkdownViewer content='[docs](https://aionui.com/docs)' />);

    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('href', 'https://aionui.com/docs');
  });

  it('sanitizes raw HTML in preview mode (drops <script>, keeps benign markup)', () => {
    const { container } = render(
      <MarkdownViewer content={'before<script>window.__xss = 1</script>after and <b>bold</b>'} />
    );
    expect(container.querySelectorAll('script')).toHaveLength(0);
    expect(container.querySelector('b')?.textContent).toBe('bold');
  });

  it('renders math via KaTeX in preview mode', () => {
    const { container } = render(<MarkdownViewer content='inline $x + y = z$ done' />);
    expect(container.querySelectorAll('.katex')).toHaveLength(1);
  });

  it('continues rendering local image markdown inline', async () => {
    const filePath = '/Users/demo/Desktop/chart.jpg';
    vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('data:image/jpeg;base64,abc123');

    render(<MarkdownViewer content={`![image](${filePath})`} file_path='/Users/demo/Desktop/test.md' />);

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'image' })).toHaveAttribute('src', 'data:image/jpeg;base64,abc123');
    });
    expect(previewMocks.openPreview).not.toHaveBeenCalled();
  });
  it.each([
    ['C:/workspace/runs/report.md', 'C:/workspace', '../notes.md', 'C:/workspace/notes.md'],
    ['/Users/test/work/runs/report.md', '/Users/test/work', '../notes.md', '/Users/test/work/notes.md'],
  ])('opens a document-relative link inside its own workspace: %s', async (filePath, workspace, href, expected) => {
    vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('Synthetic sibling file');
    render(<MarkdownViewer content={`[sibling](${href})`} file_path={filePath} workspace={workspace} />);
    fireEvent.click(screen.getByRole('button', { name: 'sibling' }));
    await waitFor(() =>
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        'Synthetic sibling file',
        'markdown',
        expect.objectContaining({ fileRef: { kind: 'local', path: expected }, file_path: expected })
      )
    );
  });

  it('rejects a document-relative link that escapes its known workspace', () => {
    render(
      <MarkdownViewer
        content='[outside](../../secret.md)'
        file_path='C:/workspace/runs/report.md'
        workspace='C:/workspace'
      />
    );
    expect(screen.queryByRole('button', { name: 'outside' })).not.toBeInTheDocument();
    expect(ipcBridge.fs.readContent.invoke).not.toHaveBeenCalled();
  });

  it('keeps a project sibling bound to its document pe_id instead of the active conversation project', async () => {
    previewMocks.currentProject = 'different-conversation-project';
    vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('Project sibling');
    render(
      <MarkdownViewer
        content='[details](../data/details.md#L3)'
        fileRef={{ kind: 'project', pe_id: 'document-pe', relative_path: 'runs/report.md' }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'details L3' }));
    await waitFor(() =>
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        'Project sibling',
        'markdown',
        expect.objectContaining({
          fileRef: { kind: 'project', pe_id: 'document-pe', relative_path: 'data/details.md' },
          targetLine: 3,
        })
      )
    );
    expect(previewMocks.openPreview.mock.calls[0][2].file_path).toBeUndefined();
    expect(ipcBridge.project.resolveRef.invoke).not.toHaveBeenCalled();
  });

  it('keeps uploaded report siblings under their known upload directory', async () => {
    vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('Uploaded sibling');
    render(
      <MarkdownViewer
        content='[sibling](sibling.md)'
        workspace='/another/conversation'
        fileRef={{ kind: 'upload', path: '/managed/uploads/report.md' }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'sibling' }));
    await waitFor(() =>
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        'Uploaded sibling',
        'markdown',
        expect.objectContaining({ fileRef: { kind: 'upload', path: '/managed/uploads/sibling.md' } })
      )
    );
  });

  it('does not rebase a retained report when the current workspace changes', async () => {
    vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('Report-owned sibling');
    const view = render(
      <MarkdownViewer
        content='[sibling](sibling.md)'
        fileRef={{ kind: 'project', pe_id: 'old-pe', relative_path: 'reports/report.md' }}
        workspace='/old/workspace'
      />
    );
    view.rerender(
      <MarkdownViewer
        content='[sibling](sibling.md)'
        fileRef={{ kind: 'project', pe_id: 'old-pe', relative_path: 'reports/report.md' }}
        workspace='/new/workspace'
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'sibling' }));
    await waitFor(() =>
      expect(ipcBridge.fs.readContent.invoke).toHaveBeenCalledWith({
        file: { kind: 'project', pe_id: 'old-pe', relative_path: 'reports/sibling.md' },
        encoding: 'utf8',
      })
    );
  });

  it('loads an absolute Windows image through its local file identity', async () => {
    vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('data:image/png;base64,fixture');
    render(
      <MarkdownViewer
        content='![chart](C:/images/chart.png)'
        file_path='C:/workspace/report.md'
        workspace='C:/workspace'
      />
    );
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'chart' })).toHaveAttribute('src', 'data:image/png;base64,fixture')
    );
    expect(ipcBridge.fs.readContent.invoke).toHaveBeenCalledWith({
      file: { kind: 'local', path: 'C:/images/chart.png' },
      encoding: 'dataurl',
    });
  });

  it('loads a project image beside the document without requesting a native path', async () => {
    vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('data:image/png;base64,project');
    render(
      <MarkdownViewer
        content='![chart](../images/chart.png)'
        fileRef={{ kind: 'project', pe_id: 'doc-pe', relative_path: 'reports/report.md' }}
      />
    );
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'chart' })).toHaveAttribute('src', 'data:image/png;base64,project')
    );
    expect(ipcBridge.fs.readContent.invoke).toHaveBeenCalledWith({
      file: { kind: 'project', pe_id: 'doc-pe', relative_path: 'images/chart.png' },
      encoding: 'dataurl',
    });
    expect(ipcBridge.fs.getImageBase64.invoke).not.toHaveBeenCalled();
  });

  it('does not rewrite file URL text in code blocks', () => {
    render(<MarkdownViewer content={'```text\nfile:///C:/reports/report.md\n```'} />);
    expect(screen.getByText('file:///C:/reports/report.md')).toBeInTheDocument();
  });

  it.each([
    ['../data/report%231%25.md', 'C:/workspace/runs/report.md', 'C:/workspace', 'C:/workspace/data/report#1%.md'],
    ['file:///C:/docs/report%23one%25.md', undefined, undefined, 'C:/docs/report#one%.md'],
    ['notes%3F.md', '/Users/test/work/report.md', '/Users/test/work', '/Users/test/work/notes?.md'],
  ])(
    'preserves encoded filename characters through the real sanitized pipeline: %s',
    async (href, filePath, workspace, expected) => {
      vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('Encoded file fixture');
      render(<MarkdownViewer content={`[encoded](${href})`} file_path={filePath} workspace={workspace} />);
      fireEvent.click(screen.getByRole('button', { name: 'encoded' }));
      await waitFor(() =>
        expect(ipcBridge.fs.readContent.invoke).toHaveBeenCalledWith({
          file: { kind: 'local', path: expected },
          encoding: 'utf8',
        })
      );
    }
  );

  it('does not let document-authored opaque-looking hrefs select another mapped file', async () => {
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      (array as Uint32Array).set([1, 2, 3, 4]);
      return array;
    });
    vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('Opaque-looking filename');
    render(
      <MarkdownViewer
        content='[real](notes.md) [authored](./__nexwork_document_file_1-2-3-4_0)'
        file_path='C:/workspace/report.md'
        workspace='C:/workspace'
      />
    );
    random.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'authored' }));
    await waitFor(() =>
      expect(ipcBridge.fs.readContent.invoke).toHaveBeenCalledWith({
        file: { kind: 'local', path: 'C:/workspace/__nexwork_document_file_1-2-3-4_0' },
        encoding: 'utf8',
      })
    );
    expect(ipcBridge.fs.readContent.invoke).not.toHaveBeenCalledWith({
      file: { kind: 'local', path: 'C:/workspace/notes.md' },
      encoding: 'utf8',
    });
  });
  it('preserves a real absolute path when a legacy path open upgrades to a project ref', async () => {
    previewMocks.currentProject = 'active-project';
    vi.mocked(ipcBridge.project.resolveRef.invoke).mockResolvedValue({
      file: { kind: 'project', pe_id: 'resolved-pe', relative_path: 'report.md' },
    });
    vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('Legacy report');
    const Harness = () => {
      const open = useLocalFilePreview('C:/workspace');
      return <button onClick={() => void open('C:/workspace/report.md')}>legacy</button>;
    };
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'legacy' }));
    await waitFor(() =>
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        'Legacy report',
        'markdown',
        expect.objectContaining({
          fileRef: { kind: 'project', pe_id: 'resolved-pe', relative_path: 'report.md' },
          file_path: 'C:/workspace/report.md',
        })
      )
    );
  });

  it('does not display a late image from another document with the same filename', async () => {
    let finishOld!: (value: string) => void;
    vi.mocked(ipcBridge.fs.readContent.invoke)
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finishOld = resolve;
          })
      )
      .mockResolvedValueOnce('data:image/png;base64,new-project');
    const view = render(
      <MarkdownViewer
        content='![chart](chart.png)'
        fileRef={{ kind: 'project', pe_id: 'old-pe', relative_path: 'reports/report.md' }}
      />
    );
    await waitFor(() =>
      expect(ipcBridge.fs.readContent.invoke).toHaveBeenCalledWith({
        file: { kind: 'project', pe_id: 'old-pe', relative_path: 'reports/chart.png' },
        encoding: 'dataurl',
      })
    );
    view.rerender(
      <MarkdownViewer
        content='![chart](chart.png)'
        fileRef={{ kind: 'project', pe_id: 'new-pe', relative_path: 'reports/report.md' }}
      />
    );
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'chart' })).toHaveAttribute('src', 'data:image/png;base64,new-project')
    );
    finishOld('data:image/png;base64,old-project');
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'chart' })).toHaveAttribute('src', 'data:image/png;base64,new-project')
    );
  });

  it('keeps project images inside their document entry root', async () => {
    render(
      <MarkdownViewer
        content='![outside](../../outside.png)'
        fileRef={{ kind: 'project', pe_id: 'doc-pe', relative_path: 'reports/report.md' }}
      />
    );
    expect(screen.getByText('outside')).toBeInTheDocument();
    expect(ipcBridge.fs.readContent.invoke).not.toHaveBeenCalled();
  });

  it('preserves remote image fallback when backend fetching fails', async () => {
    vi.mocked(ipcBridge.fs.fetchRemoteImage.invoke).mockRejectedValue(new Error('remote unavailable'));
    render(<MarkdownViewer content='![remote](https://example.com/image.png)' />);
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'remote' })).toHaveAttribute('src', 'https://example.com/image.png')
    );
  });
  it.each(['../../outside.md', 'C:drive-relative.md'])('does not navigate an unresolved local target: %s', (href) => {
    render(
      <MarkdownViewer
        content={`[unresolved](${href})`}
        file_path='C:/workspace/runs/report.md'
        workspace='C:/workspace'
      />
    );
    expect(screen.getByText('unresolved')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'unresolved' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'unresolved' })).not.toBeInTheDocument();
    expect(ipcBridge.fs.readContent.invoke).not.toHaveBeenCalled();
  });

  it('does not use the renderer URL for a relative target with no document identity', () => {
    render(<MarkdownViewer content='[unresolved](reports/report.md)' />);
    expect(screen.queryByRole('link', { name: 'unresolved' })).not.toBeInTheDocument();
    expect(screen.getByText('unresolved')).toBeInTheDocument();
  });

  it('scrolls an in-document anchor without opening a window or changing the app route', () => {
    const view = render(<MarkdownViewer content={'[section](#heading)\n\n<div id="heading">Section target</div>'} />);
    const section = view.container.querySelector<HTMLElement>('[id="user-content-heading"]')!;
    section.scrollIntoView = vi.fn();
    const link = screen.getByRole('link', { name: 'section' });
    expect(link).toHaveAttribute('href', '#heading');
    expect(link).not.toHaveAttribute('target');
    const before = window.location.hash;
    fireEvent.click(link);
    expect(section.scrollIntoView).toHaveBeenCalled();
    expect(window.location.hash).toBe(before);
  });

  it.each([
    ['https://example.com/report.md', 'https://example.com/report.md'],
    ['http://example.com/report.md', 'http://example.com/report.md'],
    ['mailto:test@example.com', 'mailto:test@example.com'],
    ['//example.com/report.md', 'https://example.com/report.md'],
  ])('preserves an external target explicitly: %s', (href, expected) => {
    render(
      <MarkdownViewer content={`[external](${href})`} file_path='C:/workspace/report.md' workspace='C:/workspace' />
    );
    expect(screen.getByRole('link', { name: 'external' })).toHaveAttribute('href', expected);
    expect(screen.getByRole('link', { name: 'external' })).toHaveAttribute('target', '_blank');
  });
});
