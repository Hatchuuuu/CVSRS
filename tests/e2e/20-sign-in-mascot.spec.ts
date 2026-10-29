import { test, expect } from '@playwright/test';

for (const { path, character, busy } of [
  { path: "/sign-in", character: "nurse", busy: /Signing in to your portal/ },
  { path: "/evactrackstafflogin", character: "clinic staff", busy: /Signing in to the clinic workspace/ },
]) {
 test.describe(character, () => {


test('welcome hand waves once for one second and respects reduced motion', async ({ page }) => {
  await page.goto(path);
  const hand = page.locator('.signin-welcome-arm');
  const face = page.locator('.signin-welcome-face');
  await expect(face).toHaveCSS('animation-name', 'signin-welcome-visible');
  await expect(face).toHaveCSS('background-position', '0px 0px');
  await expect(hand).toHaveCSS('animation-duration', '1s');
  await expect(hand).toHaveCSS('animation-iteration-count', '1');
  await expect(hand).toHaveCSS('opacity', '0');
  await expect(face).toHaveCSS('opacity', '0');
  await face.evaluate(el => { for (const animation of el.getAnimations()) { animation.pause(); animation.currentTime = 500; } });
  await expect(face).toHaveCSS('opacity', '1');
  await face.evaluate(el => { for (const animation of el.getAnimations()) animation.play(); });
  await expect(face).toHaveCSS('opacity', '0');
  const armPosition = await hand.evaluate(svg => {
    const arm = svg.querySelector('.signin-welcome-forearm')!.getBoundingClientRect();
    const nurse = svg.getBoundingClientRect();
    return arm.x + arm.width / 2 < nurse.x + nurse.width / 2;
  });
  expect(armPosition).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(hand).toHaveCSS('animation-name', 'none');
  await page.goto(`${path}?error=invalid_credentials`);
  await expect(hand).toHaveCount(0);
});

test('nurse reacts to rejected and successful sign-in responses before redirecting', async ({ page }) => {
  let attempts = 0;
  await page.route('**/auth/sign-in', route => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 401, json: { error: 'Invalid credentials. Please verify your email and password.' } })
      : route.fulfill({ status: 200, json: { redirect: '/reaction-test-complete' } });
  });
  await page.route('**/reaction-test-complete', route => route.fulfill({ contentType: 'text/html', body: '<h1>Destination reached</h1>' }));
  await page.goto(path);
  await page.getByLabel('Email address', { exact: true }).fill('mascot@example.test');
  await page.locator('#signin-password').fill('ExamplePassword123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('img', { name: `Sad ${character}: sign-in unsuccessful` })).toBeVisible();
  await expect(page.locator('form [role=alert]')).toContainText('Invalid credentials');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('img', { name: `Happy ${character} with hearts: sign-in successful` })).toBeVisible();
  await expect(page.locator('.signin-mascot-heart')).toHaveCount(6);
  await expect(page.locator('form [role=alert]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: busy })).toBeDisabled();
  await expect(page).toHaveURL(/reaction-test-complete$/);
  expect(attempts).toBe(2);
});

test('initial error and network failure show sadness on mobile; reduced motion keeps hearts still', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${path}?error=invalid_credentials`);
  await expect(page.getByRole('img', { name: `Sad ${character}: sign-in unsuccessful` })).toBeVisible();
  await page.route('**/auth/sign-in', route => route.abort());
  await page.getByLabel('Email address', { exact: true }).fill('mascot@example.test');
  await page.locator('#signin-password').fill('ExamplePassword123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('form [role=alert]')).toContainText('could not be reached');
  await expect(page.getByRole('img', { name: `Sad ${character}: sign-in unsuccessful` })).toBeVisible();
  await page.unroute('**/auth/sign-in');
  await page.route('**/auth/sign-in', route => route.fulfill({ status: 200, json: { redirect: '/reaction-test-complete' } }));
  await page.route('**/reaction-test-complete', route => route.fulfill({ body: 'Done' }));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('img', { name: `Happy ${character} with hearts: sign-in successful` })).toBeVisible();
  await expect(page.locator('.signin-mascot-heart').first()).toHaveCSS('animation-name', 'none');
  await expect(page).toHaveURL(/reaction-test-complete$/);
});

test('cursor tracking starts only after the welcome wave finishes', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.signin-welcome-face, .signin-welcome-arm { animation-duration: 30s !important; }';
      document.head.append(style);
    });
  });
  await page.goto(path);
  const greeting = page.locator('[data-nurse-waving]');
  await expect(greeting).toBeVisible();
  await expect(page.getByRole('button', { name: `Boop the ${character} mascot` })).toHaveCount(0);
  await page.mouse.move(10, 10);
  await expect(greeting).toHaveCSS('background-position', '0px 0px');
  await page.mouse.move(1000, 600);
  await expect(greeting).toHaveCSS('background-position', '0px 0px');
  await page.locator('.signin-welcome-face').dispatchEvent('animationend');
  const mascot = page.getByRole('button', { name: `Boop the ${character} mascot` });
  await expect(mascot).toBeVisible();
  await expect(greeting).toHaveCount(0);
  await page.mouse.move(1000, 600);
  await expect(mascot.locator('span').nth(1)).not.toHaveCSS('background-position', '50% 50%');
});


 test('tracks all nine head directions and reacts to keyboard activation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  const mascot = page.getByRole('button', { name: `Boop the ${character} mascot` });
  const box = await mascot.boundingBox();
  if (!box) throw new Error('Missing mascot');
  const layer = mascot.locator('span').nth(1);
  for (const [dx, dy, position] of [
   [-100,-100,'0% 0%'],[0,-100,'50% 0%'],[100,-100,'100% 0%'],
   [-100,0,'0% 50%'],[0,0,'50% 50%'],[100,0,'100% 50%'],
   [-100,100,'0% 100%'],[0,100,'50% 100%'],[100,100,'100% 100%'],
  ] as const) {
   await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
   await expect(layer).toHaveCSS('background-position', position);
  }
  await mascot.focus(); await page.keyboard.press('Enter');
  await expect(mascot.locator('span').nth(2)).toHaveCSS('opacity', '1');
  await expect(mascot.locator('span').nth(2)).toHaveCSS('opacity', '0');
 });

 });
}
