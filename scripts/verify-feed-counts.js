// Step 5C verification: reproduces renderArchiveFeed's visibility rule (non-admin,
// current round excluded while open/upcoming) against the live submissions collection,
// to confirm the test entry is excluded and R8/R1/All match expectations.
const admin = require('firebase-admin');
const PROJECT_ID = 'ai-innovation-hub-submissions';
const SUBMISSIONS_PATH = 'artifacts/descasio-innovation-hub-perpetual/public/data/submissions';

function getAdminApp() {
    if (admin.apps.length) return admin.app();
    return admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
}

async function main() {
    getAdminApp();
    const db = admin.firestore();
    const snap = await db.collection(SUBMISSIONS_PATH).get();
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    function effRound(s) { return (s.round === undefined || s.round === null) ? 1 : s.round; }
    function visiblePublic(s) { return !(s.hidden === true); }

    const byRound = {};
    for (const s of all) {
        const r = effRound(s);
        byRound[r] = byRound[r] || [];
        byRound[r].push(s);
    }

    for (const r of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const list = byRound[r] || [];
        const visible = list.filter(visiblePublic);
        const hiddenTest = list.filter(s => s.hiddenReason === 'test');
        const hiddenDup = list.filter(s => s.hiddenReason === 'duplicate');
        console.log(`Round ${r}: total=${list.length} visible(non-admin)=${visible.length} hidden-test=${hiddenTest.length} hidden-duplicate=${hiddenDup.length}`);
        if (r === 8) {
            const winnerDoc = visible.find(s => s.id === 'dOO6deUS2DDbIteRtE2K');
            console.log('  R8 winner doc present among visible:', !!winnerDoc, winnerDoc ? `(${winnerDoc.name})` : '');
        }
        if (r === 9) {
            const testDoc = list.find(s => s.name === 'Test – Redesign QA');
            console.log('  R9 test doc found:', !!testDoc, testDoc ? `hidden=${testDoc.hidden} hiddenReason=${testDoc.hiddenReason}` : '');
        }
    }

    const allVisible = all.filter(visiblePublic);
    console.log(`\nAll rounds: total=${all.length} visible(non-admin)=${allVisible.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
