const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const baseUrl = (process.env.N8N_BASE_URL || '').replace(/\/$/, '');
const email = process.env.N8N_EMAIL || '';
const password = process.env.N8N_PASSWORD || '';
const workflowFile = path.resolve('workflow/T1_WhatsApp_Lead_AI_Scoring_Slack.json');
const evidenceDir = path.resolve('evidence');

function ensureEvidenceDir() {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

async function capture(page, name) {
  ensureEvidenceDir();
  await page.screenshot({ path: path.join(evidenceDir, name), fullPage: true });
}

async function loginIfNeeded(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);

  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  const passwordInput = page.locator('input[type="password"], input[name="password"]').first();

  if (await emailInput.isVisible().catch(() => false)) {
    await capture(page, '00-login-page.png');
    await emailInput.fill(email);
    await passwordInput.fill(password);

    const loginButton = page.getByRole('button', { name: /sign in|log in|login/i }).first();
    if (await loginButton.isVisible().catch(() => false)) {
      await loginButton.click();
    } else {
      await passwordInput.press('Enter');
    }

    await page.waitForTimeout(2500);
  }

  if (/signin|login/i.test(new URL(page.url()).pathname)) {
    throw new Error(`Login did not complete. Current URL: ${page.url()}`);
  }
}

test('T1 imports into n8n and renders its workflow canvas', async ({ page }) => {
  ensureEvidenceDir();
  if (!baseUrl || !email || !password) {
    throw new Error('N8N_BASE_URL, N8N_EMAIL and N8N_PASSWORD are required');
  }
  if (!fs.existsSync(workflowFile)) {
    throw new Error(`Workflow file not found: ${workflowFile}`);
  }

  try {
    await loginIfNeeded(page);
    await capture(page, '01-after-login.png');

    await page.goto(`${baseUrl}/workflow/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    const importInput = page.locator('[data-test-id="workflow-import-input"]');
    await expect(importInput).toBeAttached({ timeout: 30000 });
    await importInput.setInputFiles(workflowFile);

    await page.waitForTimeout(4000);
    await capture(page, '02-t1-imported-canvas.png');

    const bodyText = await page.locator('body').innerText();
    fs.writeFileSync(path.join(evidenceDir, '02-page-text.txt'), bodyText);
    fs.writeFileSync(path.join(evidenceDir, '02-current-url.txt'), page.url());

    // These names come directly from the checked-in workflow JSON and prove the canvas rendered it.
    expect(bodyText).toContain('WhatsApp Lead Webhook');
    expect(bodyText).toContain('Claude AI Scoring');
    expect(bodyText).toContain('Send to Slack');

    // Capture a second frame after a small pause so the video clearly shows a stable imported canvas.
    await page.waitForTimeout(2500);
    await capture(page, '03-t1-stable-canvas.png');
  } catch (error) {
    await capture(page, '99-diagnostic-failure.png').catch(() => {});
    const text = await page.locator('body').innerText().catch(() => 'Unable to read page body');
    fs.writeFileSync(path.join(evidenceDir, '99-diagnostic-page-text.txt'), text);
    fs.writeFileSync(path.join(evidenceDir, '99-diagnostic-url.txt'), page.url());
    throw error;
  }
});
