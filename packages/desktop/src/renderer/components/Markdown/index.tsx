/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';

import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';

// Import KaTeX CSS to make it available in the document
import 'katex/dist/katex.min.css';

import { openExternalUrl } from '@/renderer/utils/platform';
import { parseHttpUrl } from '@/renderer/utils/url';
import { useOptionalPreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import classNames from 'classnames';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { convertLatexDelimiters } from '@renderer/utils/chat/latexDelimiters';
import LocalImageView from '@renderer/components/media/LocalImageView';
import CodeBlock from './CodeBlock';
import LocalFileLink from './LocalFileLink';
import ShadowView from './ShadowView';
import { MARKDOWN_REMARK_PLUGINS, MarkdownTable, MarkdownTd } from './markdownComponents';
import { resolveLocalFileLinkPath, resolveLocalFileLinkReference } from './markdownUtils';
import type { LocalFileLinkReference } from './markdownUtils';

const isInlineImageSource = (src: string): boolean => /^(?:data:image\/|blob:)/i.test(src);

type MarkdownViewProps = {
  children: string;
  hiddenCodeCopyButton?: boolean;
  codeStyle?: React.CSSProperties;
  className?: string;
  onRef?: (el?: HTMLDivElement | null) => void;
  onLocalFileLink?: (path: string, reference?: LocalFileLinkReference) => void | Promise<void>;
  /** Backend workspace for relative file links; never use the renderer document URL. */
  baseDirectory?: string;
  /** Enable raw HTML rendering in markdown content. Use with caution — only for trusted sources. */
  allowHtml?: boolean;
};

const MarkdownView: React.FC<MarkdownViewProps> = React.memo(
  ({
    hiddenCodeCopyButton,
    codeStyle,
    className,
    onRef,
    onLocalFileLink,
    baseDirectory,
    allowHtml,
    children: childrenProp,
  }) => {
    const { t } = useTranslation();
    const preview = useOptionalPreviewContext();

    const normalizedChildren = useMemo(() => {
      if (typeof childrenProp === 'string') {
        return convertLatexDelimiters(childrenProp);
      }
      return childrenProp;
    }, [childrenProp]);

    const handleLinkClick = useCallback(
      (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const href = e.currentTarget.getAttribute('href')?.trim();
        if (!href) return;
        if (href.startsWith('#')) {
          let id = href.slice(1);
          try {
            id = decodeURIComponent(id);
          } catch {
            // Malformed percent text is a literal anchor, never a file path.
          }
          const root = e.currentTarget.getRootNode();
          if (root instanceof Document || root instanceof ShadowRoot) {
            Array.from(root.querySelectorAll<HTMLElement>('[id]'))
              .find((element) => element.id === id)
              ?.scrollIntoView({ block: 'start' });
          }
          return;
        }
        const externalHref = href.startsWith('//') ? `https:${href}` : href;
        // Prefer the built-in browser tab for http(s) links; fall back to the
        // system browser for other schemes or when no Preview panel is available.
        const httpUrl = parseHttpUrl(externalHref);
        if (httpUrl && preview) {
          preview.openBrowserTab(httpUrl);
          return;
        }
        // Unresolved local/relative targets must never become renderer file://
        // URLs. Only explicit external schemes reach the external opener.
        if (!/^[a-z][a-z\d+.-]*:/i.test(externalHref) || /^(?:file:|[a-z]:[\\/])/i.test(externalHref)) return;
        openExternalUrl(externalHref).catch((error: unknown) => {
          console.error(t('messages.openLinkFailed'), error);
        });
      },
      [t, preview]
    );

    // Memoize components so React preserves component identity across re-renders.
    // Without this, every streaming update creates new function references → React
    // unmounts/remounts all custom components → hooks & DOM state are lost.
    const components = useMemo(
      () => ({
        span: ({ node: _node, className: cn, children: ch, ...rest }: Record<string, unknown>) => (
          <span {...(rest as React.HTMLAttributes<HTMLSpanElement>)} className={cn as string}>
            {ch as React.ReactNode}
          </span>
        ),
        code: (props: Record<string, unknown>) => (
          <CodeBlock
            {...(props as Parameters<typeof CodeBlock>[0])}
            codeStyle={codeStyle}
            hiddenCodeCopyButton={hiddenCodeCopyButton}
            diagramPanZoom
          />
        ),
        a: ({ node: _node, ...rest }: Record<string, unknown>) => {
          const anchorProps = rest as React.AnchorHTMLAttributes<HTMLAnchorElement>;
          const rawHref = typeof anchorProps.href === 'string' ? anchorProps.href : '';
          const localFileReference = resolveLocalFileLinkReference(rawHref, undefined, baseDirectory);
          if (localFileReference) {
            return (
              <LocalFileLink reference={localFileReference} onOpen={onLocalFileLink}>
                {anchorProps.children}
              </LocalFileLink>
            );
          }
          return (
            <a {...anchorProps} href={anchorProps.href} target='_blank' rel='noreferrer' onClick={handleLinkClick} />
          );
        },
        table: MarkdownTable,
        td: MarkdownTd,
        img: ({ node: _node, ...rest }: Record<string, unknown>) => {
          const imgProps = rest as React.ImgHTMLAttributes<HTMLImageElement>;
          const rawSrc = imgProps.src || '';
          const file = resolveLocalFileLinkReference(rawSrc, undefined, baseDirectory);
          if (file) {
            return <LocalImageView src={file.filePath} alt={imgProps.alt || ''} className={imgProps.className} />;
          }
          const remoteSrc = rawSrc.startsWith('//') ? `https:${rawSrc}` : rawSrc;
          return (
            <img
              {...imgProps}
              src={parseHttpUrl(remoteSrc) || isInlineImageSource(remoteSrc) ? remoteSrc : undefined}
              alt={imgProps.alt || ''}
            />
          );
        },
      }),
      [codeStyle, hiddenCodeCopyButton, handleLinkClick, onLocalFileLink, baseDirectory]
    );

    const rehypePlugins = useMemo(() => (allowHtml ? [rehypeRaw, rehypeKatex] : [rehypeKatex]), [allowHtml]);

    return (
      <div className={classNames('relative w-full', className)}>
        <ShadowView>
          <div ref={onRef} className='markdown-shadow-body'>
            <ReactMarkdown
              remarkPlugins={MARKDOWN_REMARK_PLUGINS}
              rehypePlugins={rehypePlugins}
              components={components}
              urlTransform={(url, key) =>
                resolveLocalFileLinkPath(url, undefined, baseDirectory) || (key === 'src' && isInlineImageSource(url))
                  ? url
                  : defaultUrlTransform(url)
              }
            >
              {normalizedChildren}
            </ReactMarkdown>
          </div>
        </ShadowView>
      </div>
    );
  }
);

MarkdownView.displayName = 'MarkdownView';

export default MarkdownView;
