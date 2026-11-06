// Read-only: lists every submission tagged round 9 (id, name/teamName, email,
// timestamp, hidden/hiddenReason), so a human can decide which are test entries
// before scripts/hide-submissions.js hides them.
const admin = require('firebase-admin');

const PROJECT_ID = 'ai-innovation-hub-submissions';
const BASE_PATH = 'artifacts/descasio-innovation-hub-perpetual/public/data';

function getAdminApp() {
    if (admin.apps.length) return admin.app();
    return admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
}

async function main() {
    getAdminApp();
    const db = admin.firestore();
    const snap = await db.collection(`${BASE_PATH}/submissions`).get();
    const round9 = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => (s.round === undefined || s.round === null ? 1 : s.round) === 9);

    console.log(`Round 9 submissions: ${round9.length}\n`);
    for (const s of round9) {
        console.log(JSON.stringify({
            id: s.id,
            name: s.type === 'group' ? s.teamName : s.name,
            email: s.email,
            type: s.type,
            timestamp: s.timestamp,
            hidden: s.hidden || false,
            hiddenReason: s.hiddenReason || null
        }, null, 2));
    }

    const visible = round9.filter(s => !s.hidden);
    console.log(`\nVisible (not hidden): ${visible.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
