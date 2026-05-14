import type { ConsoleMessage, Page } from '@playwright/test';
import { test, expect, openApp } from './fixtures';

function attachConsoleCapture(page: Page) {
  const errors: string[] = [];
  const warns: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
    if (msg.type() === 'warning') warns.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return { errors, warns };
}

test('loads without console errors and renders the shell', async ({ page }) => {
  const { errors } = attachConsoleCapture(page);
  await openApp(page);
  await expect(page.locator('.app')).toBeVisible();
  await expect(page.locator('.rail')).toBeVisible();
  await expect(page.locator('.pane').first()).toBeVisible();
  await expect(page.locator('.tabs')).toBeVisible();
  await expect(page.locator('.inspector')).toBeVisible();
  // Give the broker a beat to connect
  await page.waitForTimeout(800);
  expect(errors, errors.join('\n---\n')).toEqual([]);
});

test('connects to the bridge and shows live status', async ({ page }) => {
  await openApp(page);
  // status dot in channel header should not have "offline" class
  const dot = page.locator('.pane-header .status-dot').first();
  await expect(dot).toBeVisible();
  await expect.poll(async () => {
    const cls = await dot.getAttribute('class');
    return cls?.includes('offline') ? 'offline' : 'live';
  }, { timeout: 5000 }).toBe('live');
});

test('receives at least one synthetic envelope on the default channel', async ({ page }) => {
  const { errors } = attachConsoleCapture(page);
  await openApp(page);
  // wait up to 15s (bridge sends hello within ~1s of subscribe)
  await expect(page.locator('.conv-msg')).not.toHaveCount(0, { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('entity tokens fill the Inspector when clicked', async ({ page }) => {
  await openApp(page);
  // Wait until at least one entity token appears (synthetic phrases include ⟦MMSI ...⟧)
  const token = page.locator('.entity-token').first();
  await expect(token).toBeVisible({ timeout: 20_000 });
  const label = await token.textContent();
  await token.click();
  // Inspector should now show the entity id
  const inspector = page.locator('.inspector');
  await expect(inspector).toContainText('MMSI', { timeout: 2000 }).catch(async () => {
    // fall back: the entity id appears verbatim
    if (label) await expect(inspector).toContainText(label.replace(/[⟦⟧]/g, '').trim());
  });
});

test('publishing a message echoes it back into the stream', async ({ page }) => {
  await openApp(page);
  // wait until input is enabled (bus connected)
  const input = page.locator('#message-input');
  await expect(input).toBeEnabled({ timeout: 5000 });
  const marker = `hello-from-pw-${Date.now()}`;
  await input.fill(marker);
  await input.press('Enter');
  await expect(page.locator('.conv-body', { hasText: marker })).toBeVisible({ timeout: 3000 });
});

test('switching channels swaps the stream', async ({ page }) => {
  await openApp(page);
  // Wait for first channel's stream to populate
  await expect(page.locator('.conv-msg')).not.toHaveCount(0, { timeout: 15_000 });
  // Click sar-detections channel
  await page.locator('.channel-item', { hasText: 'sar-detections' }).click();
  // Conversation header title (scoped to .conversation to avoid the channels pane)
  await expect(page.locator('.conversation .ph-title')).toHaveText('sar-detections');
  // Input placeholder reflects the new channel
  await expect(page.locator('#message-input')).toHaveAttribute('placeholder', /sar-detections/);
});

test('keystrokes hide and reveal panes', async ({ page }) => {
  await openApp(page);
  await page.waitForSelector('.app');
  // Hide data pane
  await page.keyboard.press('Control+Shift+D');
  await expect(page.locator('.tabs')).toHaveCount(0);
  // Show again
  await page.keyboard.press('Control+Shift+D');
  await expect(page.locator('.tabs')).toBeVisible();
  // Hide channel list
  await page.keyboard.press('Control+Shift+S');
  await expect(page.locator('.channels-section').first()).toHaveCount(0);
  await page.keyboard.press('Control+Shift+S');
  await expect(page.locator('.channels-section').first()).toBeVisible();
  // Reset
  await page.keyboard.press('Control+Shift+0');
});

test('help overlay toggles', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Control+Shift+/');
  await expect(page.locator('.help-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.help-panel')).toHaveCount(0);
});
