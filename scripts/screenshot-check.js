// Captures console errors and takes screenshots of all six tabs (Dashboard,
// Challenges, Submissions, Idea Hub, Winners, Leaderboard) at 1440/768/390px, plus a
// few desktop-only extras (Challenges round-8/round-1, Submissions round-8, the
// details modal, the forceOpen=9 variant of #submit so the Round 9 form can be seen
// while it's really still upcoming, and the hover state of a few representative
// links/buttons/cards from the polish pass), into backups/<date>/screens/.
//
// Step 7A removed the ?preview=1 OTP-gate bypass from the app itself, so this script
// now authenticates the same way the real login flow would leave a visitor logged in:
// it seeds localStorage's descasio_hub_auth entry directly (what verifyOtp() writes
// on a real successful code check), via context.addInitScript so it's in place before
// the app's own JS runs on every navigation. ?preview=1 is still required for the
// forceOpen/now dev-only overrides (unrelated to login) - see js/challenges.js.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:8080/?preview=1';
const WIDTHS = [1440, 768, 390];

function seedAuth(context) {
    return context.addInitScript(() => {
        try {
            localStorage.setItem('descasio_hub_auth', JSON.stringify({
                email: 'qa.screenshot@descasio.io',
                expiry: Date.now() + (24 * 60 * 60 * 1000)
            }));
        } catch (e) { /* ignore */ }
    });
}

const PAGES = [
    { hash: '#dashboard', name: 'dashboard' },
    { hash: '#challenges', name: 'challenges' },
    { hash: '#submit', name: 'submit' },
    { hash: '#submissions/round-8', name: 'submissions-round8' },
    { hash: '#ideas', name: 'ideahub' },
    { hash: '#winners', name: 'winners' },
    { hash: '#leaderboard', name: 'leaderboard' }
];

async function capture(page, outDir, hash, name, width, errors) {
    await page.goto(`${BASE}${hash}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewportSize({ width, height: Math.min(bodyHeight, 6000) });
    await page.screenshot({ path: path.join(outDir, `${name}-${width}.png`), fullPage: true });
    const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (hScroll) errors.push(`[w${width}] HORIZONTAL SCROLL detected on ${name}`);
}

async function main() {
    const dateStr = new Date().toISOString().slice(0, 10);
    const outDir = path.join(__dirname, '..', 'backups', dateStr, 'screens');
    fs.mkdirSync(outDir, { recursive: true });

    const browser = await chromium.launch();
    const errors = [];

    for (const width of WIDTHS) {
        const context = await browser.newContext({ viewport: { width, height: 1000 } });
        await seedAuth(context);
        const page = await context.newPage();
        page.on('console', msg => { if (msg.type() === 'error') errors.push(`[w${width}] console.error: ${msg.text()}`); });
        page.on('pageerror', err => errors.push(`[w${width}] pageerror: ${err.message}`));

        for (const p of PAGES) {
            await capture(page, outDir, p.hash, p.name, width, errors);
        }

        await context.close();
    }

    // Desktop-only extras
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    await seedAuth(context);
    const page = await context.newPage();
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));

    await capture(page, outDir, '#challenges/round-8', 'challenges-round8', 1440, errors);
    await capture(page, outDir, '#challenges/round-1', 'challenges-round1', 1440, errors);

    // forceOpen=9 variant of #submit - only reachable on localhost, shows the Round 9
    // form actually unlocked (?preview=1 alone leaves Round 9 upcoming/disabled today).
    await page.goto(`${BASE}&forceOpen=9#submit`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    let h = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewportSize({ width: 1440, height: Math.min(h, 6000) });
    await page.screenshot({ path: path.join(outDir, 'submit-forceOpen9-1440.png'), fullPage: true });

    // Submission details modal: open the first visible "Details and impact" card on
    // the Round 8 archive feed and screenshot it.
    await page.goto(`${BASE}#submissions/round-8`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const detailsBtn = await page.$('article button:has-text("Details and impact")');
    if (detailsBtn) {
        await detailsBtn.click();
        await page.waitForTimeout(300);
        await page.setViewportSize({ width: 1440, height: 1200 });
        await page.screenshot({ path: path.join(outDir, 'submissions-modal-1440.png'), fullPage: true });
    } else {
        errors.push('Could not find a "Details and impact" button on #submissions/round-8 to open the modal');
    }

    // Hover states of a few representative interactive elements (polish pass):
    // the "Read the brief" ticker link, a coral CTA button, an outline button, and a
    // journey tile (clickable card). Each is hovered, then screenshot.
    const hoverChecks = [
        { hash: '#dashboard', selector: '.ticker-item a', name: 'hover-announcement-link' },
        { hash: '#dashboard', selector: 'a.btn-coral', name: 'hover-dashboard-cta' },
        { hash: '#dashboard', selector: 'a.card-hover', name: 'hover-journey-tile' },
        { hash: '#submit', selector: 'button.btn-coral[type="submit"]', name: 'hover-submit-button' }
    ];
    for (const h of hoverChecks) {
        await page.goto(`${BASE}${h.hash}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1000);
        const el = await page.$(h.selector);
        if (el) {
            await el.hover();
            await page.waitForTimeout(200);
            await page.screenshot({ path: path.join(outDir, `${h.name}-1440.png`) });
        } else {
            errors.push(`Could not find selector "${h.selector}" on ${h.hash} for a hover screenshot`);
        }
    }

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
