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

test('Map tab renders MapLibre canvas and tracked-MMSI legend', async ({ page }) => {
  await openApp(page);
  // The Map tab is the default active tab in the data pane on first load.
  // Ensure the canvas mounted; this is a strong signal that MapLibre + WebGL
  // initialised without error.
  const canvas = page.locator('.map-canvas .maplibregl-canvas');
  await expect(canvas).toBeVisible({ timeout: 8000 });

  // Regression: MapLibre captures container dims at construction. Inside a
  // flex/resizable pane, the canvas used to come up sized to a few pixels and
  // only fixed itself when the divider was dragged. The ResizeObserver in
  // MapTab now grows it on first frame. Assert it's actually visible-sized.
  await expect.poll(async () => {
    const box = await canvas.boundingBox();
    return box ? Math.min(box.width, box.height) : 0;
  }, { timeout: 5_000 }).toBeGreaterThan(100);

  // Legend should be visible with the tracked MMSI 311001249 pill.
  await expect(page.locator('.map-legend')).toBeVisible();
  await expect(page.locator('.legend-tracked-mmsi', { hasText: '311001249' })).toBeVisible();
});

test('Map tab receives at least one vessel from vessel.ais.position when AIS is running', async ({ page }) => {
  await openApp(page);
  // Wait for the inspector to be empty initially.
  await expect(page.locator('.inspector')).toBeVisible();
  // The Map should show a non-zero vessel count in its legend once positions arrive.
  // If planetar-ais isn't running this will time out at 15s — leave the test in
  // place but accept either path so the suite doesn't go red on partial setups.
  const count = page.locator('.legend-count');
  await expect(count).toBeVisible();
  await expect.poll(async () => {
    const t = await count.innerText();
    const m = /(\d+)/.exec(t);
    return m ? Number(m[1]) : 0;
  }, { timeout: 15_000, message: 'no vessel envelopes on vessel.ais.position — is planetar-ais running?' }).toBeGreaterThan(0);
});

test('Inspector "Open channel" switches the conversation to the vessel channel', async ({ page }) => {
  await openApp(page);

  // Precondition: the fleet listener must register the vessel channel before
  // the Inspector button can appear. Mock cadence is variable per-vessel (2 s
  // underway → 3 min moored per ITU-R), so give the channel up to 30 s to
  // surface in the left rail. MMSI 477123400 is KESTREL III in the mock seed.
  await expect(
    page.locator('.channel-item').filter({ hasText: 'vessel-477123400' }),
  ).toBeVisible({ timeout: 30_000 });

  // Publish a chat message with an embedded MMSI entity token, then click it.
  const input = page.locator('#message-input');
  await expect(input).toBeEnabled({ timeout: 5_000 });
  await input.fill('check ⟦MMSI 477123400⟧');
  await input.press('Enter');

  const token = page.locator('.entity-token').filter({ hasText: 'MMSI 477123400' }).first();
  await expect(token).toBeVisible({ timeout: 5_000 });
  await token.click();

  await expect(page.locator('.inspector')).toContainText('477123400');

  const openBtn = page.locator('.inspector-action').filter({ hasText: 'Open channel' });
  await expect(openBtn).toBeVisible({ timeout: 5_000 });
  await openBtn.click();

  // Conversation header now points at the vessel channel.
  await expect(page.locator('.conversation .ph-title')).toHaveText('vessel-477123400');

  // Same button, when the current channel is already the vessel one, becomes
  // disabled and re-labels.
  await expect(page.locator('.inspector-action')).toBeDisabled();
  await expect(page.locator('.inspector-action')).toContainText('viewing this channel');
});

test('Map drag disables follow-mode, Recenter button restores it', async ({ page }) => {
  await openApp(page);

  // Establish a selection so follow-mode has something to track. Same
  // precondition as the Open-channel test — wait for KESTREL III's fleet
  // channel to register, then publish a chat message with its MMSI token.
  await expect(
    page.locator('.channel-item').filter({ hasText: 'vessel-477123400' }),
  ).toBeVisible({ timeout: 30_000 });

  const input = page.locator('#message-input');
  await expect(input).toBeEnabled({ timeout: 5_000 });
  await input.fill('look at ⟦MMSI 477123400⟧');
  await input.press('Enter');

  const token = page.locator('.entity-token').filter({ hasText: 'MMSI 477123400' }).first();
  await expect(token).toBeVisible({ timeout: 5_000 });
  await token.click();
  // Inspector populates, follow-mode is engaged → no button yet.
  await expect(page.locator('.inspector')).toContainText('477123400');
  await expect(page.locator('.map-recenter')).toHaveCount(0);

  // Drag the canvas. MapLibre fires 'movestart' with an `originalEvent`,
  // tripping the follow-mode-off handler.
  const canvas = page.locator('.maplibregl-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 80, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator('.map-recenter')).toBeVisible({ timeout: 2_000 });

  // Click Recenter → follow re-engages, button hides again.
  await page.locator('.map-recenter').click();
  await expect(page.locator('.map-recenter')).toHaveCount(0, { timeout: 2_000 });
});

test('Map canvas stays square after "Open channel" (no horizontal stretch)', async ({ page }) => {
  await openApp(page);

  await expect(
    page.locator('.channel-item').filter({ hasText: 'vessel-477123400' }),
  ).toBeVisible({ timeout: 30_000 });

  // Select the vessel + open its channel — this is the exact gesture that
  // historically left the canvas internal width frozen while the data pane's
  // CSS width grew, producing horizontally-stretched ovals.
  const input = page.locator('#message-input');
  await expect(input).toBeEnabled({ timeout: 5_000 });
  await input.fill('look at ⟦MMSI 477123400⟧');
  await input.press('Enter');
  const token = page.locator('.entity-token').filter({ hasText: 'MMSI 477123400' }).first();
  await expect(token).toBeVisible({ timeout: 5_000 });
  await token.click();
  const openBtn = page.locator('.inspector-action').filter({ hasText: 'Open channel' });
  await expect(openBtn).toBeVisible({ timeout: 5_000 });
  await openBtn.click();
  await expect(page.locator('.conversation .ph-title')).toHaveText('vessel-477123400');

  // The canvas internal width should equal its CSS width × devicePixelRatio
  // (within a few px of rounding). Anything else means MapLibre captured
  // dimensions before the layout settled.
  await expect.poll(async () => {
    return page.evaluate(() => {
      const c = document.querySelector('.maplibregl-canvas') as HTMLCanvasElement | null;
      if (!c) return { ok: false, ratio: 0, internal: 0, css: 0 };
      const css = c.getBoundingClientRect().width;
      const internal = c.width;
      const expected = css * (window.devicePixelRatio || 1);
      const ratio = expected > 0 ? internal / expected : 0;
      return { ok: Math.abs(1 - ratio) < 0.05, ratio, internal, css };
    });
  }, { timeout: 4_000, message: 'canvas internal width drifted from CSS width — stretching expected' }).toMatchObject({ ok: true });
});
