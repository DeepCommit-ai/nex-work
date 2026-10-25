import { ipcBridge } from '@/common';
import { joinPath } from '@/common/chat/chatLib';
import { LoadingTwo } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useConversationContextSafe } from '@renderer/hooks/context/ConversationContext';
import { iconColors } from '@/renderer/styles/colors';

const LocalImageView: React.FC<{
  src: string;
  alt: string;
  className?: string;
}> = ({ src, alt, className }) => {
  const [image, setImage] = useState<{ key: string; loading: boolean; url?: string }>({ key: '', loading: true });
  // Resolve relative image paths (e.g. ![](./chart.png)) against the conversation
  // workspace = the agent cwd, and pass it as the fs sandbox workspace. Outside a
  // conversation (settings markdown) there is no workspace, so the src is sent
  // through unchanged — matching the previous default root of ''.
  const root = useConversationContextSafe()?.workspace ?? '';

  const absolutePath = useMemo(() => {
    if (!root) return src;
    if (
      src.startsWith('http') ||
      src.startsWith('data:') ||
      src.startsWith('/') ||
      src.startsWith('file:') ||
      src.startsWith('\\') ||
      /^[A-Za-z]:/.test(src)
    ) {
      return src;
    }
    return joinPath(root, src);
  }, [src, root]);
  const requestKey = JSON.stringify([absolutePath, root]);

  useEffect(() => {
    let obsolete = false;
    setImage({ key: requestKey, loading: true });
    ipcBridge.fs.getImageBase64
      .invoke({ path: absolutePath, workspace: root || undefined })
      .then((base64) => {
        if (!obsolete) setImage({ key: requestKey, loading: false, url: base64 || undefined });
      })
      .catch((error) => {
        if (obsolete) return;
        console.error('[LocalImageView] Failed to load image:', {
          path: absolutePath,
          error,
        });
        setImage({ key: requestKey, loading: false });
      });
    return () => {
      obsolete = true;
    };
  }, [absolutePath, root, requestKey]);
  // Hide a previous source immediately, before the replacement effect runs.
  if (image.key !== requestKey || image.loading)
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <LoadingTwo
          className='loading'
          style={{ display: 'flex' }}
          theme='outline'
          size='14'
          fill={iconColors.primary}
          strokeWidth={2}
        />
        <span>{alt}</span>
      </span>
    );
  if (!image.url) return <span className={className}>{alt}</span>;
  return <img src={image.url} alt={alt} className={className} />;
};

export default LocalImageView;
