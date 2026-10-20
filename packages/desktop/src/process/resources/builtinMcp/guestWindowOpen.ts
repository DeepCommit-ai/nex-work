/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 内置浏览器里的「新窗口」一律在同一个内置浏览器里打开，不弹出独立窗口。
 *
 * WebviewHost 注入的脚本只改写了顶层页面的 window.open；iframe 里的 window.open、
 * target=_blank 等都会漏过去。而 WebviewHost 的 webview 带着 allowpopups 属性（布尔属性，
 * 写成 "false" 也算开启），漏过去的请求就会变成一个独立的 Electron 窗口：不在侧边浏览器里，
 * 也不在单目标 CDP 通道上，Agent 看不到、员工也不知道该在哪个窗口操作。泛微 OA 门户里点 K3
 * 就是这样弹出来的。这里在主进程统一接住：http(s) 地址在原 webview 里打开，其余拒绝。
 *
 * 不带 allowpopups 的 webview（HTML 预览、PDF）在 Electron 判断能否建窗时就被拒了，
 * 不会走到这里，行为不变。
 *
 * Every "new window" from the in-app browser opens in that same browser instead of a
 * separate window.
 *
 * The script WebviewHost injects only rewrites window.open in the top frame; window.open
 * from iframes, target=_blank and the like slip past it. WebviewHost's webview carries the
 * allowpopups attribute (a boolean attribute, so "false" still enables it), so whatever
 * slips past became a standalone Electron window: outside the side-panel browser and off
 * the single-target CDP bridge, invisible to the agent and confusing for the employee.
 * Clicking K3 in the Weaver OA portal opened one this way. This catches every such request
 * in the main process: http(s) addresses load in the originating webview, anything else is
 * denied.
 *
 * Webviews without allowpopups (HTML preview, PDF) are refused before Electron reaches a
 * window-open handler, so their behaviour is unchanged.
 */

/** The parts of a WebContents this policy touches. */
export type GuestContents = {
  getType: () => string;
  loadURL: (url: string) => Promise<void>;
  setWindowOpenHandler: (handler: (details: { url: string }) => { action: 'deny' }) => void;
};

/** The parts of Electron's app this policy listens on. */
export type WebContentsSource = {
  on: (event: 'web-contents-created', listener: (event: unknown, contents: GuestContents) => void) => unknown;
};

/**
 * 新窗口请求应在原 webview 里打开的地址；不该打开时返回 null。
 *
 * The address a new-window request should load in the originating webview, or null when
 * it should not open at all.
 *
 * @param url 页面请求打开的地址 / the address the page asked to open
 */
export const inAppWindowOpenTarget = (url: string): string | null => (/^https?:\/\//i.test(url) ? url : null);

/**
 * 给之后创建的每个 webview guest 装上新窗口策略。须在任何 webview 创建前调用。
 *
 * Installs the new-window policy on every webview guest created from now on. Call it
 * before any webview exists.
 *
 * @param app Electron 的 app（测试时可传替身）/ Electron's app, or a stand-in in tests
 */
export function installGuestWindowOpenPolicy(app: WebContentsSource): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;
    contents.setWindowOpenHandler(({ url }) => {
      const target = inAppWindowOpenTarget(url);
      // 重定向会让 loadURL 以 ERR_ABORTED 拒绝，属正常，不记日志。
      // loadURL rejects with ERR_ABORTED when the page redirects; that is normal.
      if (target) contents.loadURL(target).catch(() => {});
      return { action: 'deny' };
    });
  });
}
