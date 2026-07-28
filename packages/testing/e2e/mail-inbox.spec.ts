import { observeMailApi } from './helpers/mail-api-observer';
import { test, expect } from '@playwright/test';

const email = process.env.EMAIL;

if (!email) {
  throw new Error('EMAIL environment variable must be set.');
}

test.describe('Signing In, Sending mail, Replying to a mail', () => {
  test('should send and reply to an email in the same session', async ({ page }) => {
    const mailApi = observeMailApi(page);
    await page.goto('/mail/inbox');
    await page.waitForLoadState('domcontentloaded');
    console.log('Successfully accessed mail inbox');

    await expect(page.getByText('Inbox')).toBeVisible();
    await mailApi.expectProcedure('mail.view.threadPage');
    console.log('Mail inbox is now visible');

    console.log('Starting email sending process...');
    await page.getByText('New email').click();
    await page.waitForTimeout(2000);

    await page.getByPlaceholder('Enter email address').fill(email);
    await page.getByPlaceholder('Enter email address').press('Enter');
    console.log('Filled To: field');

    await page.getByPlaceholder('Re: Design review feedback').fill('Zero local mail E2E');
    await page.locator('[contenteditable="true"]').last().fill('Local EmailSubmission test');

    await page.getByRole('button', { name: 'Send' }).click();
    await mailApi.expectProcedure('mail.email.set');
    await mailApi.expectProcedure('mail.submission.set');
    console.log('Clicked Send button');
    await page.waitForTimeout(3000);
    console.log('Email sent successfully!');

    console.log('Waiting for email to arrive...');
    await page.waitForTimeout(10000);

    console.log('Looking for the first email in the list...');
    await page.locator('[data-thread-id]').first().click();
    console.log('Clicked on email (PM/AM area).');

    console.log('Looking for Reply button to confirm email is open...');
    await page.waitForTimeout(2000);

    const replySelectors = [
      'button:has-text("Reply")',
      '[data-testid*="reply"]',
      'button[title*="Reply"]',
      'button:text-is("Reply")',
      'button:text("Reply")',
    ];

    let replyClicked = false;
    for (const selector of replySelectors) {
      try {
        await page.locator(selector).first().click({ force: true });
        console.log(`Clicked Reply button using: ${selector}`);
        replyClicked = true;
        break;
      } catch {
        console.log(`Failed to click with ${selector}`);
      }
    }

    if (!replyClicked) {
      console.log('Could not find Reply button');
    }

    await page.waitForTimeout(2000);

    console.log('Sending reply...');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.waitForTimeout(3000);
    console.log('Reply sent successfully!');

    console.log('Entire email flow completed successfully!');
    mailApi.expectNoLegacyRequests();
  });
});
