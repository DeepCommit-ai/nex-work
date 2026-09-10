import { _electron as electron, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localAppBootstrap, prepareLocalApp } from '../../../packages/desktop/src/branding/tools/localApp.mjs';

/** Exercise the employee's only setup form against the isolated live configuration service. */
export async function runManagedUiProbe(directory: string, serverUrl: string, deptKey: string): Promise<void> {
  const root = process.cwd();
  const home = path.join(directory, 'ui-home');
  const data = path.join(directory, 'ui-data');
  mkdirSync(home);
  mkdirSync(data);
  const launch = path.join(directory, 'ui-launch.cjs');
  writeFileSync(launch, `require('electron').app.setPath('home',${JSON.stringify(home)});\n` + localAppBootstrap(root));
  const app = await electron.launch({
    executablePath: prepareLocalApp(root).executablePath,
    args: [launch],
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      AIONUI_E2E_TEST: '1',
      AIONUI_E2E_USER_DATA_DIR: data,
      AIONUI_DISABLE_AUTO_UPDATE: '1',
      AIONUI_BACKEND_BIN: path.join(root, `resources/bundled-aioncore/${process.platform}-${process.arch}/aioncore`),
    },
    timeout: 45000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.body.innerText.includes('NexWork'), { timeout: 45000 });
    await page.evaluate(() => {
      location.hash = '/settings/enterprise';
    });
    await page.getByPlaceholder('例如 https://work.example.com').fill(serverUrl);
    await page.getByPlaceholder('向管理员领取').fill(deptKey);
    await page.getByRole('button', { name: '连接并获取助手', exact: true }).click();
    await expect(page.getByText('部门标识：default', { exact: true })).toBeVisible({ timeout: 45000 });
    await expect(page.getByText('助手已更新', { exact: true })).toBeVisible();
    await expect(page.getByText(serverUrl, { exact: true })).toBeVisible();
    await expect(page.getByText('已安装版本：', { exact: false })).toBeHidden();
    await page.getByText('技术详情', { exact: true }).click();
    await expect(page.getByText('已安装版本：', { exact: false })).toBeVisible({ timeout: 45000 });
    await expect(page.getByText('实时推送：已连接', { exact: true })).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: path.join(directory, 'enterprise-sync.png') });
    await page.getByRole('button', { name: '检查连接', exact: true }).click();
    await expect(page.getByText('助手已更新', { exact: true })).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => {
      location.hash = '/guid';
    });
    await expect(page.locator('[data-assistant-id="default-assistant"]').first()).toHaveText('默认助手', {
      timeout: 15000,
    });
    await expect(page.locator('[data-assistant-id="office-assistant"]').first()).toHaveText('办公助手');
    await expect(page.locator('[data-assistant-id="nexwork-butler"]').first()).toHaveText('NexWork 管家');
    await page.screenshot({ path: path.join(directory, 'managed-home.png') });
    await page.evaluate(() => {
      location.hash = '/settings/assistant';
    });
    await page.screenshot({ path: path.join(directory, 'managed-assistants.png') });
    console.log('PASS: Electron setup form, Chinese sync status, active SSE, manual sync and default assistant');
  } finally {
    await app.close();
  }
}
