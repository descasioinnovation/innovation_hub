// Tidies the `submissions` collection. DRY-RUN BY DEFAULT — pass --apply to write.
// Only ever calls .update() to ADD fields that are currently absent. Never deletes,
// never overwrites an existing value.
//
//   node tidy-submissions.js            -> dry run, prints + returns preview
//   node tidy-submissions.js --apply    -> writes round:1, and hidden/hiddenReason

const admin = require('firebase-admin');

const PROJECT_ID = 'ai-innovation-hub-submissions';
const SUBMISSIONS_PATH = 'artifacts/descasio-innovation-hub-perpetual/public/data/submissions';

// Manually confirmed in the 2026-11-06 data report (name/title contains "Test"/"Sample",
// all three from the same person, Nkemakolam Eloagu). These do NOT count toward entryCount.
const TEST_IDS = [
    '05FAmQYPwcVgk8VuhUPw', // round missing -> implicit R1, "Sample (Futuristic Descasio)"
    'Ms1b4E155BWnhPMk9ATY', // round 2, "Sample - Nkemakolam Eloagu"
    'b8ZE7b4KubBJJnb2VGU2'  // round 3, "Test - Nkemakolam Eloagu"
];

// Explicit, user-confirmed duplicate resolutions (2026-11-06 decision). These DO still
// count toward entryCount — the person still entered, this just picks the one canonical
// doc to show. Exactly 5 docs, from 4 duplicate groups (R2 Solomon, R7 Solomon, R7
// Precious, R8 MaryBlessing [2 of 3 hidden]). NOTE: this was asked to verify against "3
// test + 6 duplicate = 9 hidden total" but only 5 duplicate docs were explicitly named —
// see the chat report for this discrepancy, flagged rather than silently resolved.
const DUPLICATE_HIDE_IDS = [
    'kUmohwcgUP6NOmLWl3ki', // R2 Solomon — keep yu2SyFFh9hGdfYKeg4gX
    'BWjvQWkzE7TRemX5sMCJ', // R7 Solomon — keep kGqjKgC3Vva24JvqYYdz
    'z1W4lqktrYAEYhG5NuF4', // R7 Precious — keep FTi1JmDppEujyBPtha8s
    'H6rg3ozO7ltEUNRVCO8t', // R8 MaryBlessing (Claude) — keep dOO6deUS2DDbIteRtE2K (Gemini)
    'ZABhDtRRQo8CMpLYmkAP'  // R8 MaryBlessing (Claude) — keep dOO6deUS2DDbIteRtE2K (Gemini)
];

function getAdminApp() {
    if (admin.apps.length) return admin.app();
    return admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: PROJECT_ID
    });
}

function getName(s) { return s.type === 'group' ? (s.teamName || '') : (s.name || ''); }
function getTitle(s) { return s.innovationName || ''; }
function effRound(s) { return (s.round === undefined || s.round === null) ? 1 : s.round; }

async function buildPreview() {
    getAdminApp();
    const db = admin.firestore();
    const snapshot = await db.collection(SUBMISSIONS_PATH).get();
    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const byId = Object.fromEntries(docs.map(d => [d.id, d]));

    // 1) round: 1 on every doc with no round field
    const missingRound = docs.filter(d => d.round === undefined || d.round === null);
    const roundAdds = missingRound.map(d => ({ id: d.id, name: getName(d), add: { round: 1 } }));

    // 2) hidden: true + hiddenReason: "test" (only if not already hidden)
    const testHides = TEST_IDS
        .filter(id => byId[id] && byId[id].hidden !== true)
        .map(id => ({ id, name: getName(byId[id]), title: getTitle(byId[id]), add: { hidden: true, hiddenReason: 'test' } }));

    // 3) hidden: true + hiddenReason: "duplicate" (only if not already hidden)
    const duplicateHides = DUPLICATE_HIDE_IDS
        .filter(id => byId[id] && byId[id].hidden !== true)
        .map(id => ({ id, name: getName(byId[id]), round: effRound(byId[id]), add: { hidden: true, hiddenReason: 'duplicate' } }));

    // entryCount per round = all submissions for that round except hiddenReason "test"
    // (duplicates still count). Computed here so seed-challenges.js's entryCount figures
    // can be cross-checked against this script's own live view of the data.
    const entryCountByRound = {};
    for (const d of docs) {
        if (TEST_IDS.includes(d.id)) continue;
        const r = effRound(d);
        entryCountByRound[r] = (entryCountByRound[r] || 0) + 1;
    }

    return {
        totalSubmissions: docs.length,
        roundAdds,
        testHides,
        duplicateHides,
        entryCountByRound
    };
}

async function apply(preview) {
    const db = admin.firestore();
    const col = db.collection(SUBMISSIONS_PATH);
    let written = 0;
    for (const item of preview.roundAdds) {
        await col.doc(item.id).update(item.add);
        written++;
    }
    for (const item of preview.testHides) {
        await col.doc(item.id).update(item.add);
        written++;
    }
    for (const item of preview.duplicateHides) {
        await col.doc(item.id).update(item.add);
        written++;
    }
    return written;
}

async function main() {
    const applyFlag = process.argv.includes('--apply');
    const preview = await buildPreview();

    console.log(`Submissions scanned: ${preview.totalSubmissions}`);
    console.log(`\nround: 1 to add (${preview.roundAdds.length}):`);
    for (const r of preview.roundAdds) console.log(`  ${r.id}  (${r.name || '(no name)'})`);

    console.log(`\nhidden:true + hiddenReason:"test" to add (${preview.testHides.length}):`);
    for (const h of preview.testHides) console.log(`  ${h.id}  (${h.name || '(no name)'}) "${h.title}"`);

    console.log(`\nhidden:true + hiddenReason:"duplicate" to add (${preview.duplicateHides.length}):`);
    for (const h of preview.duplicateHides) console.log(`  ${h.id}  round=${h.round}  (${h.name || '(no name)'})`);

    console.log('\nentryCount per round (all docs minus hiddenReason "test" only):');
    for (const r of Object.keys(preview.entryCountByRound).sort((a, b) => a - b)) {
        console.log(`  Round ${r}: ${preview.entryCountByRound[r]}`);
    }

    if (applyFlag) {
        console.log('\n--apply passed: writing now...');
        const written = await apply(preview);
        console.log(`Done. ${written} document(s) updated.`);
    } else {
        console.log('\nDRY RUN ONLY — no writes made. Pass --apply to write.');
    }
}

module.exports = { buildPreview, apply, TEST_IDS, DUPLICATE_HIDE_IDS };

if (require.main === module) {
    main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
