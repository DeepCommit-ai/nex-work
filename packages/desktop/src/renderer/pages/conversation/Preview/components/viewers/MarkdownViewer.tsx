/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { chatFileRefKey, localFileRef, projectFileRef, uploadFileRef, type ChatFileRef } from '@/common/types/chatFile';
import CodeBlock from '@/renderer/components/Markdown/CodeBlock';
import LocalFileLink from '@/renderer/components/Markdown/LocalFileLink';
import {
  MARKDOWN_REMARK_PLUGINS,
  MarkdownTable,
  MarkdownTd,
  SANITIZED_HTML_REHYPE_PLUGINS,
} from '@/renderer/components/Markdown/markdownComponents';
import {
  resolveLocalFileLinkReference,
  resolveRelativeFileLinkReference,
  type LocalFileLinkReference,
} from '@/renderer/components/Markdown/markdownUtils';
import { getLocalFileDirectory } from '@/renderer/utils/file/fileUrls';
import { resolvePreviewPayload } from '@/renderer/utils/file/previewPayload';
import { useTextSelection } from '@/renderer/hooks/ui/useTextSelection';
import 'katex/dist/katex.min.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import MarkdownEditor from '../editors/MarkdownEditor';
import SelectionToolbar from '../renderers/SelectionToolbar';
import { useContainerScroll, useContainerScrollTarget } from '../../hooks/useScrollSyncHelpers';
import { useLocalFilePreview } from '../../hooks';
import { convertLatexDelimiters } from '@/renderer/utils/chat/latexDelimiters';

interface MarkdownPreviewProps {
  content: string; // Markdown 内容 / Markdown content
  viewMode?: 'source' | 'preview'; // 外部控制的视图模式 / External view mode
  onViewModeChange?: (mode: 'source' | 'preview') => void; // 视图模式改变回调（保留以兼容调用方，暂未使用）/ View mode change callback (kept for call-site compatibility, currently unused)
  onContentChange?: (content: string) => void; // 内容改变回调 / Content change callback
  containerRef?: React.RefObject<HTMLDivElement>; // 容器引用，用于滚动同步 / Container ref for scroll sync
  onScroll?: (scrollTop: number, scrollHeight: number, clientHeight: number) => void; // 滚动回调 / Scroll callback
  file_path?: string; // 当前 Markdown 文件的绝对路径 / Absolute file path of current markdown
  workspace?: string;
  fileRef?: ChatFileRef; // 当前 Markdown 文件的 ChatFileRef（project 文档据此解析相对图片，无需绝对路径）/ The doc's ChatFileRef; project docs resolve relative images through it (no absolute path)
}

type DocumentTarget = { file: ChatFileRef; reference: LocalFileLinkReference };

/** Resolve against the displayed document's identity, never the active conversation's project. */
const resolveDocumentTarget = (
  href: string,
  documentRef?: ChatFileRef,
  filePath?: string,
  workspace?: string
): DocumentTarget | null => {
  const absolute = resolveLocalFileLinkReference(href);
  if (absolute) return { file: localFileRef(absolute.filePath), reference: absolute };
  if (documentRef?.kind === 'project') {
    const path = documentRef.relative_path.replace(/\\/g, '/');
    const slash = path.lastIndexOf('/');
    const reference = resolveRelativeFileLinkReference(href, slash < 0 ? '' : path.slice(0, slash));
    return reference ? { file: projectFileRef(documentRef.pe_id, reference.filePath), reference } : null;
  }
  const knownPath = documentRef?.path ?? filePath;
  const base = knownPath ? getLocalFileDirectory(knownPath) : workspace;
  if (!base) return null;
  const boundary = documentRef?.kind === 'upload' ? base : (workspace ?? base);
  const reference = resolveLocalFileLinkReference(href, undefined, base, { rootDirectory: boundary });
  if (!reference) return null;
  return {
    file: documentRef?.kind === 'upload' ? uploadFileRef(reference.filePath) : localFileRef(reference.filePath),
    reference,
  };
};

// Keep the shared sanitizer's protocol policy unchanged. A parse-local opaque
// token carries only a target already validated by the path parser; it is never
// a browser navigation URL. Random tokens prevent author-supplied hrefs from
// impersonating another node, and a new map is populated for every parse.
const createDocumentFilePlugin = (resolve: (href: string) => DocumentTarget | null) => {
  const targets = new Map<string, DocumentTarget>();
  const plugin = () => (tree: unknown) => {
    targets.clear();
    const nonce = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16)).join('-');
    let index = 0;
    type Node = { tagName?: string; properties?: Record<string, unknown>; children?: Node[] };
    const visit = (node: Node): void => {
      const key = node.tagName === 'a' ? 'href' : node.tagName === 'img' ? 'src' : null;
      const href = key && node.properties?.[key];
      if (key && typeof href === 'string') {
        const target = resolve(href);
        if (target) {
          const token = `./__nexwork_document_file_${nonce}_${index++}`;
          targets.set(token, target);
          node.properties![key] = token;
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree as Node);
  };
  return { targets, plugin };
};

interface MarkdownImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  target?: DocumentTarget;
}

const MarkdownImage: React.FC<MarkdownImageProps> = ({ src, alt, target, ...props }) => {
  const sourceKey = target ? chatFileRefKey(target.file) : (src ?? '');
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!src) return;
    const load = async (): Promise<string | undefined> => {
      if (target) return (await resolvePreviewPayload(target.file, 'image')).content || undefined;
      if (/^https?:/i.test(src)) {
        try {
          return (await ipcBridge.fs.fetchRemoteImage.invoke({ url: src })) || src;
        } catch {
          return src;
        }
      }
      // Only sanitized non-file URLs get here. Never fall back to a relative
      // native img URL after a local read failure (that would use app.asar).
      return /^(data:|blob:)/i.test(src) ? src : undefined;
    };
    void load()
      .then((url) => {
        if (!cancelled) setLoaded(url ? { key: sourceKey, url } : null);
      })
      .catch(() => {
        if (!cancelled) setLoaded(null);
      });
    return () => {
      cancelled = true;
    };
  }, [src, sourceKey, target]);
  const resolvedSrc = loaded?.key === sourceKey ? loaded.url : undefined;
  if (!resolvedSrc) return alt ? <span>{alt}</span> : null;
  return (
    <img
      src={resolvedSrc}
      alt={alt}
      referrerPolicy='no-referrer'
      crossOrigin='anonymous'
      style={{ maxWidth: '100%', width: 'auto', height: 'auto', display: 'block', objectFit: 'contain' }}
      {...props}
    />
  );
};

const encodeHtmlAttribute = (value: string) => value.replace(/&(?!#?[a-z0-9]+;)/gi, '&amp;');

const rewriteExternalMediaUrls = (markdown: string): string => {
  const githubWikiRegex = /https:\/\/github\.com\/([^/]+)\/([^/]+)\/wiki\/([^\s)"'>]+)/gi;
  const rewriteWiki = markdown.replace(githubWikiRegex, (_match, owner, repo, rest) => {
    return `https://raw.githubusercontent.com/wiki/${owner}/${repo}/${rest}`;
  });
  return rewriteWiki.replace(/<(img|a)\b[^>]*>/gi, (tag) => {
    return tag.replace(/(src|href)\s*=\s*(["'])([^"']*)(\2)/gi, (match, attr, quote, value, closingQuote) => {
      return `${attr}=${quote}${encodeHtmlAttribute(value)}${closingQuote}`;
    });
  });
};

// Plain heading overrides that apply consistent spacing/size classes and always
// render the current text. Defining them once (memoized at module scope) keeps a
// stable component identity across re-renders so React does not remount headings.
const HEADING_COMPONENTS = Object.fromEntries(
  (
    [
      ['h1', 'text-3xl'],
      ['h2', 'text-2xl'],
      ['h3', 'text-xl'],
      ['h4', 'text-lg'],
      ['h5', 'text-base'],
      ['h6', 'text-sm'],
    ] as const
  ).map(([tag, size], index) => [
    tag,
    ({ children, className, node: _node, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { node?: unknown }) =>
      React.createElement(
        tag,
        {
          className: ['mt-6 mb-2 font-semibold', size, className].filter(Boolean).join(' '),
          'data-heading-level': index + 1,
          ...props,
        },
        children
      ),
  ])
);

/**
 * Markdown 预览组件
 * Markdown preview component
 *
 * 使用 react-markdown + KaTeX 渲染 Markdown，代码块/Mermaid 复用共享 CodeBlock，
 * 原始 HTML 经 rehype-sanitize 脱敏后渲染，支持原文/预览切换。
 * Renders markdown with react-markdown + KaTeX; code/Mermaid reuse the shared
 * CodeBlock, raw HTML is sanitized via rehype-sanitize, source/preview toggle.
 */
const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  viewMode: externalViewMode,
  onContentChange,
  containerRef: externalContainerRef,
  onScroll: externalOnScroll,
  file_path,
  workspace,
  fileRef,
}) => {
  const internalContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef || internalContainerRef; // 使用外部 ref 或内部 ref / Use external ref or internal ref
  const handleLocalFileLink = useLocalFilePreview(workspace);

  // 使用滚动同步 Hooks / Use scroll sync hooks
  useContainerScroll(containerRef, externalOnScroll);
  useContainerScrollTarget(containerRef);

  // 使用外部传入的 viewMode，默认预览模式 / Use external viewMode if provided, default to preview
  const viewMode = externalViewMode ?? 'preview';

  // 预览源：转换 LaTeX 分隔符并重写外部媒体 URL / Preview source: convert LaTeX delimiters and rewrite external media URLs
  const previewSource = useMemo(() => convertLatexDelimiters(rewriteExternalMediaUrls(content)), [content]);

  // 监听文本选择 / Monitor text selection
  const { selectedText, selectedUrl, selectionPosition, clearSelection } = useTextSelection(containerRef);

  const resolveTarget = useCallback(
    (href: string) => resolveDocumentTarget(href, fileRef, file_path, workspace),
    [fileRef, file_path, workspace]
  );
  const localFiles = useMemo(() => createDocumentFilePlugin(resolveTarget), [resolveTarget]);
  const rehypePlugins = useMemo(
    () => [SANITIZED_HTML_REHYPE_PLUGINS[0], localFiles.plugin, ...SANITIZED_HTML_REHYPE_PLUGINS.slice(1)],
    [localFiles]
  );

  // Memoize component overrides so React keeps a stable identity across re-renders.
  // Code fences and Mermaid diagrams reuse the shared CodeBlock (chat/preview parity);
  // tables reuse the shared table/cell overrides.
  const components = useMemo(
    () => ({
      ...HEADING_COMPONENTS,
      // Enable diagram drag-to-pan + zoom in the preview panel (matches chat diagrams).
      code: (props: Record<string, unknown>) => (
        <CodeBlock {...(props as Parameters<typeof CodeBlock>[0])} diagramPanZoom />
      ),
      a({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
        const target = typeof href === 'string' ? localFiles.targets.get(href) : undefined;
        if (target) {
          return (
            <LocalFileLink
              reference={target.reference}
              onOpen={() => handleLocalFileLink(target.file, target.reference)}
            >
              {children}
            </LocalFileLink>
          );
        }
        if (href?.startsWith('#')) {
          return (
            <a
              {...props}
              href={href}
              target={undefined}
              onClick={(event) => {
                // HashRouter owns the app URL. A document anchor may scroll this
                // report, but must never replace the conversation route's hash.
                event.preventDefault();
                event.stopPropagation();
                let id: string;
                try {
                  id = decodeURIComponent(href.slice(1));
                } catch {
                  return;
                }
                const anchorTarget = Array.from(
                  containerRef.current?.querySelectorAll<HTMLElement>('[id], [name]') ?? []
                ).find(
                  (element) =>
                    element.id === id || element.id === `user-content-${id}` || element.getAttribute('name') === id
                );
                anchorTarget?.scrollIntoView?.({ block: 'start' });
              }}
            >
              {children}
            </a>
          );
        }
        const external = href?.startsWith('//') ? `https:${href}` : href;
        if (external && /^(https?|ircs?|mailto|xmpp):/i.test(external)) {
          return (
            <a {...props} href={external} target='_blank' rel='noreferrer'>
              {children}
            </a>
          );
        }
        // No document identity, an out-of-root path, or an unsupported native
        // reference must not fall back to app.asar/file:// browser navigation.
        return <span>{children}</span>;
      },
      img({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
        return <MarkdownImage src={src} alt={alt} target={src ? localFiles.targets.get(src) : undefined} {...props} />;
      },
      table: MarkdownTable,
      td: MarkdownTd,
    }),
    [handleLocalFileLink, localFiles, containerRef]
  );

  return (
    <div className='flex flex-col w-full h-full overflow-hidden'>
      {/* 内容区域 / Content area */}
      <div
        ref={containerRef}
        className={`flex-1 ${viewMode === 'source' ? 'overflow-hidden' : 'overflow-auto p-32px text-t-primary'}`}
        style={{ minWidth: 0 }}
      >
        {viewMode === 'source' ? (
          // 原文模式：使用编辑器 / Source mode: Use editor
          <MarkdownEditor value={content} onChange={(value) => onContentChange?.(value)} />
        ) : (
          // 预览模式：react-markdown + KaTeX / Preview mode: react-markdown + KaTeX
          <div
            className='aionui-markdown'
            style={{
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
              width: '100%',
              maxWidth: '100%',
              minWidth: 0,
              boxSizing: 'border-box',
            }}
          >
            <ReactMarkdown
              remarkPlugins={MARKDOWN_REMARK_PLUGINS}
              rehypePlugins={rehypePlugins}
              urlTransform={(url) => (localFiles.targets.has(url) ? url : defaultUrlTransform(url))}
              components={components}
            >
              {previewSource}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {/* 文本选择浮动工具栏 / Text selection floating toolbar */}
      {selectedText && (
        <SelectionToolbar
          selectedText={selectedText}
          selectedUrl={selectedUrl}
          position={selectionPosition}
          onClear={clearSelection}
        />
      )}
    </div>
  );
};

export default MarkdownPreview;
