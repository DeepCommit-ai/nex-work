import { describe, expect, it } from 'vitest';
import { BrowserSessions } from '@/renderer/pages/conversation/Preview/browser/browserSessions';
describe('conversation page lifetime', () => {
  it('keeps two independent pages and restores the original page object on switching', () => {
    const sessions = new BrowserSessions();
    const a = sessions.ensure('a'),
      b = sessions.ensure('b');
    sessions.patch(a.id, { content: 'https://example.com/a' });
    sessions.wake('b');
    sessions.wake('a');
    expect(sessions.forOwner('a')[0].content).toBe('https://example.com/a');
    expect(sessions.forOwner('b')[0].id).toBe(b.id);
    expect(sessions.getSnapshot().every((entry) => entry.live)).toBe(true);
  });
  it('reclaims idle pages but protects active tasks, the visible conversation and edited forms', () => {
    const sessions = new BrowserSessions();
    sessions.ensure('idle');
    sessions.ensure('running');
    const dirty = sessions.ensure('dirty');
    sessions.ensure('visible');
    sessions.touch('running', true);
    sessions.dirty(dirty.id, true);
    expect(sessions.suspendIdle(Date.now() + 5000, 'visible', 1000)).toEqual(['idle']);
    expect(sessions.getSnapshot().find((entry) => entry.owner === 'running')?.live).toBe(true);
    sessions.touch('running', false);
    expect(sessions.suspendIdle(Date.now() + 5000, 'visible', 1000)).toEqual(['running']);
  });
  it('reopens a suspended page at its saved URL without affecting the other conversation', () => {
    const sessions = new BrowserSessions();
    const a = sessions.ensure('a');
    sessions.ensure('b');
    sessions.patch(a.id, { content: 'https://example.com/a' });
    sessions.suspendIdle(Date.now() + 10000, 'b', 100);
    expect(sessions.ensure('a').content).toBe('https://example.com/a');
    expect(sessions.remove(a.id)).toBe('a');
    expect(sessions.forOwner('b')).toHaveLength(1);
  });
  it('protects pages added after a task began and cannot reassign a page through metadata updates', () => {
    const sessions = new BrowserSessions();
    sessions.touch('a', true);
    const a = sessions.ensure('a');
    sessions.patch(a.id, { metadata: { browserConversationId: 'b' } });
    expect(sessions.suspendIdle(Date.now() + 10000, null, 100)).toEqual([]);
    expect(sessions.forOwner('a')[0].metadata?.browserConversationId).toBe('a');
    expect(() => sessions.ensure('')).toThrow('identity');
  });
});
