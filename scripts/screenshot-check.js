// Loads the local preview (OTP bypass via ?preview=1), captures console errors, and
// takes screenshots of Dashboard and Challenges at 1440/768/390px, plus Challenges with
// round-8 and round-1 selected, into backups/<date>/screens/.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:8080/?preview=1';
const WIDTHS = [1440, 768, 390];

async function main() {
    const dateStr = new Date().toISOString().slice(0, 10);
    const outDir = path.join(__dirname, '..', 'backups', dateStr, 'screens');
    fs.mkdirSync(outDir, { recursive: true });

    const browser = await chromium.launch();
    const errors = [];

    for (const width of WIDTHS) {
        const context = await browser.newContext({ viewport: { width, height: 1000 } });
        const page = await context.newPage();
        page.on('console', msg => {
            if (msg.type() === 'error') errors.push(`[w${width}] console.error: ${msg.text()}`);
        });
        page.on('pageerror', err => errors.push(`[w${width}] pageerror: ${err.message}`));

        // Dashboard
        await page.goto(`${BASE}#dashboard`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1500); // let Firestore listeners settle
        const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
        await page.setViewportSize({ width, height: Math.min(bodyHeight, 6000) });
        await page.screenshot({ path: path.join(outDir, `dashboard-${width}.png`), fullPage: true });
        const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        if (hScroll) errors.push(`[w${width}] HORIZONTAL SCROLL detected on dashboard`);

        // Challenges (default = current round)
        await page.goto(`${BASE}#challenges`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1000);
        const bodyHeight2 = await page.evaluate(() => document.body.scrollHeight);
        await page.setViewportSize({ width, height: Math.min(bodyHeight2, 6000) });
        await page.screenshot({ path: path.join(outDir, `challenges-${width}.png`), fullPage: true });
        const hScroll2 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        if (hScroll2) errors.push(`[w${width}] HORIZONTAL SCROLL detected on challenges`);

        await context.close();
    }

    // Round-8 and Round-1 selected, desktop width only (per the task's explicit ask)
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    const page = await context.newPage();
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));

    await page.goto(`${BASE}#challenges/round-8`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    let h = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewportSize({ width: 1440, height: Math.min(h, 6000) });
    await page.screenshot({ path: path.join(outDir, 'challenges-round8-1440.png'), fullPage: true });

    await page.goto(`${BASE}#challenges/round-1`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    h = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewportSize({ width: 1440, height: Math.min(h, 6000) });
    await page.screenshot({ path: path.join(outDir, 'challenges-round1-1440.png'), fullPage: true });

    await context.close();
    await browser.close();

    console.log(`Screenshots written to ${outDir}`);
    console.log(fs.readdirSync(outDir));
    if (errors.length) {
        console.log('\n--- Console/page errors and scroll issues found ---');
        errors.forEach(e => console.log(e));
    } else {
        console.log('\nNo console errors, page errors, or horizontal scroll detected.');
    }
}

main().catch(err => { console.error('screenshot-check.js failed:', err); process.exit(1); });
