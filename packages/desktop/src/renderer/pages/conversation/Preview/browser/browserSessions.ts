import type { PreviewTab, PreviewTabPatch } from '../context/PreviewContext';
import { BROWSER_BLANK_URL, BROWSER_TAB_FALLBACK_TITLE } from './constants';

export const BROWSER_IDLE_MS = 30 * 60 * 1000;
type Entry = { tab: PreviewTab; owner: string; lastUsed: number; running: boolean; dirty: boolean; live: boolean };

/** Browser lifetimes belong to conversations, independently of project previews and routes. */
export class BrowserSessions {
  onClear?: (owners: string[]) => void;
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private snapshot: Entry[] = [];
  private selected = new Map<string, string>();
  private running = new Map<string, boolean>();
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = (): Entry[] => this.snapshot;
  private emit(): void {
    this.snapshot = [...this.entries.values()];
    this.listeners.forEach((listener) => listener());
  }
  remember(tabs: PreviewTab[]): void {
    let changed = false;
    for (const tab of tabs) {
      const owner = tab.metadata?.browserConversationId;
      if (tab.content_type !== 'browser' || !owner) continue;
      const old = this.entries.get(tab.id);
      if (old && old.owner !== owner) continue;
      if (old?.tab === tab) continue;
      this.entries.set(
        tab.id,
        old
          ? { ...old, tab }
          : { tab, owner, lastUsed: Date.now(), running: this.running.get(owner) ?? false, dirty: false, live: true }
      );
      changed = true;
    }
    if (changed) this.emit();
  }
  ensure(owner: string): PreviewTab {
    if (!owner) throw new Error('Browser conversation identity is required');
    let entry =
      this.entries.get(this.selected.get(owner) ?? '') ??
      [...this.entries.values()].find((item) => item.owner === owner);
    if (!entry) {
      const tab: PreviewTab = {
        id: `browser-${owner}`,
        content: 'about:blank',
        content_type: 'browser',
        title: BROWSER_TAB_FALLBACK_TITLE,
        isDirty: false,
        originalContent: 'about:blank',
        metadata: { browserConversationId: owner },
      };
      entry = { tab, owner, lastUsed: Date.now(), running: this.running.get(owner) ?? false, dirty: false, live: true };
      this.entries.set(tab.id, entry);
    }
    entry.live = true;
    entry.lastUsed = Date.now();
    this.emit();
    return entry.tab;
  }
  forOwner(owner: string): PreviewTab[] {
    return [...this.entries.values()].filter((entry) => entry.owner === owner).map((entry) => entry.tab);
  }
  selectedTab(owner: string): string | undefined {
    return this.selected.get(owner) ?? this.forOwner(owner)[0]?.id;
  }
  select(id: string): void {
    const entry = this.entries.get(id);
    if (entry && this.selected.get(entry.owner) !== id) {
      this.selected.set(entry.owner, id);
      entry.lastUsed = Date.now();
      this.emit();
    }
  }
  wake(owner: string): void {
    for (const entry of this.entries.values())
      if (entry.owner === owner) {
        entry.live = true;
        entry.lastUsed = Date.now();
      }
    this.emit();
  }
  touch(owner: string, running?: boolean): void {
    if (running !== undefined) this.running.set(owner, running);
    for (const entry of this.entries.values())
      if (entry.owner === owner) {
        entry.lastUsed = Date.now();
        if (running !== undefined) entry.running = running;
      }
  }
  dirty(id: string, dirty: boolean): void {
    const entry = this.entries.get(id);
    if (entry) {
      entry.dirty = dirty;
      entry.lastUsed = Date.now();
    }
  }
  patch(id: string, patch: PreviewTabPatch): void {
    const entry = this.entries.get(id);
    if (entry) {
      entry.tab = {
        ...entry.tab,
        ...patch,
        content: typeof patch.content === 'string' ? patch.content || BROWSER_BLANK_URL : entry.tab.content,
        metadata: { ...entry.tab.metadata, ...patch.metadata, browserConversationId: entry.owner },
      };
      this.emit();
    }
  }
  remove(id: string): string | undefined {
    const owner = this.entries.get(id)?.owner;
    this.entries.delete(id);
    if (owner && this.selected.get(owner) === id) this.selected.delete(owner);
    this.emit();
    return owner && ![...this.entries.values()].some((entry) => entry.owner === owner) ? owner : undefined;
  }
  suspendIdle(now: number, activeOwner: string | null, idleMs = BROWSER_IDLE_MS): string[] {
    const released = new Set<string>();
    for (const entry of this.entries.values()) {
      if (
        entry.live &&
        entry.owner !== activeOwner &&
        !entry.running &&
        !entry.dirty &&
        now - entry.lastUsed >= idleMs
      ) {
        entry.live = false;
        released.add(entry.owner);
      }
    }
    // A conversation with any retained page must retain its control endpoint too.
    const owners = [...released].filter(
      (owner) => ![...this.entries.values()].some((entry) => entry.owner === owner && entry.live)
    );
    if (released.size) this.emit();
    return owners;
  }
  clear(): void {
    const owners = [...new Set([...this.entries.values()].map((entry) => entry.owner))];
    this.entries.clear();
    this.selected.clear();
    this.running.clear();
    this.emit();
    this.onClear?.(owners);
  }
}

export const browserSessions = new BrowserSessions();
