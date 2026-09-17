import { chromium, type Browser, type Page, type LaunchOptions } from 'playwright-core';
import { randomUUID } from 'node:crypto';
import type { Action, Snapshot } from '../shared/contracts.js';

export class BrowserDriver {
  constructor(private readonly launchOptions: LaunchOptions = { channel: 'chrome', headless: false }) {}
  private browser?: Browser;
  private page?: Page;
  private snapshotId = '';
  async open() {
    if (this.browser?.isConnected()) return;
    this.browser = await chromium.launch(this.launchOptions);
    const context = await this.browser.newContext({ acceptDownloads: true });
    this.page = await context.newPage();
    await this.page.setContent('<h1>Jev Desktop</h1><p>Your isolated browser is ready. Enter a task in the desktop app.</p>');
  }
  async close() { this.snapshotId = ''; await this.browser?.close(); this.browser = undefined; this.page = undefined; }
  async snapshot(): Promise<Snapshot> {
    await this.open();
    const page = this.page!;
    const id = randomUUID();
    this.snapshotId = id;
    const data = await page.evaluate(({ id }) => {
      const entries: Element[] = Array.from(document.querySelectorAll('button,a,input,textarea,select,[role="button"],[contenteditable="true"],h1,h2,h3,p,[role="status"],[role="alert"]'));
      const visible = entries.filter(el => el.getClientRects().length > 0).slice(0, 250);
      const refs: Record<string, Element> = {};
      const nodes = visible.map((el, index) => {
        const ref = `${id}:${index}`; refs[ref] = el;
        const input = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
        const secure = el instanceof HTMLInputElement && el.type === 'password';
        const editable = input || (el instanceof HTMLElement && el.isContentEditable);
        const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
        return { ref, role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
          name: (el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.textContent ?? '').slice(0, 1500),
          value: secure ? '[secure]' : input ? el.value.slice(0, 2000) : '', enabled: !disabled,
          actions: secure ? [] : editable ? ['setValue'] : el.matches('button,a,[role="button"]') ? ['AXPress'] : [], depth: 0 };
      });
      Object.defineProperty(window, '__jevRefs', { value: refs, writable: true, configurable: true });
      return { nodes, truncated: entries.length > 250, title: document.title || location.href };
    }, { id });
    return { id, source: 'dom', pid: 0, ...data };
  }
  async execute(action: Action, snapshotId: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!snapshotId || snapshotId !== this.snapshotId || !this.page) throw new Error('Stale browser snapshot.');
    const page = this.page;
    this.snapshotId = '';
    if (action.kind === 'navigate') {
      const url = new URL(action.text ?? '');
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) navigation is supported.');
      signal?.throwIfAborted();
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      return;
    }
    const handle = await page.evaluateHandle((ref) => {
      const win = window as unknown as { __jevRefs?: Record<string, Element> };
      const el = win.__jevRefs?.[ref];
      if (!el?.isConnected || !el.getClientRects().length) throw new Error('Stale browser target.');
      return el;
    }, action.ref ?? '');
    try {
      const element = handle.asElement();
      if (!element) throw new Error('Missing browser element.');
      signal?.throwIfAborted();
      if (action.kind === 'press') await element.click({ timeout: 5000 });
      else if (action.kind === 'setValue') await element.fill(action.text ?? '', { timeout: 5000 });
      else throw new Error('Unsupported DOM action.');
    } finally { await handle.dispose(); }
  }
}
