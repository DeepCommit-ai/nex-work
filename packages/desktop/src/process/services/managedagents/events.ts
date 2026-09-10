/** Read bounded SSE notifications using authenticated fetch; credentials never enter the URL. */
export async function readCatalogEvents(
  response: Response,
  signal: AbortSignal,
  onEvent: (name: string) => void,
  idleTimeoutMs = 45_000
): Promise<void> {
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
    throw new Error('Invalid catalog event stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const cancel = (): void => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (!signal.aborted) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error('Catalog event stream timed out'));
              cancel();
            }, idleTimeoutMs);
          }),
        ]);
        if (next.done) return;
        buffer = (buffer + decoder.decode(next.value, { stream: true })).replace(/\r\n/g, '\n');
        if (buffer.length > 64 * 1024) throw new Error('Catalog event exceeds its limit');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const name = event
            .split('\n')
            .find((line) => line.startsWith('event:'))
            ?.slice(6)
            .trim();
          if (name) onEvent(name);
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
