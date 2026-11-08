// Additive: adds the `page` field (rich challenge-page content, word-for-word from
// redesign/mockups/Challenges.dc.html's November view - see scripts/round9-page-content.js)
// to the live challenges/round-9 doc. Never touches any other field on that doc.
// Dry-run by default; pass --apply to write.
const admin = require('firebase-admin');
const { page } = require('./round9-page-content');

const PROJECT_ID = 'ai-innovation-hub-submissions';
const DOC_PATH = 'artifacts/descasio-innovation-hub-perpetual/public/data/challenges/round-9';

function getAdminApp() {
    if (admin.apps.length) return admin.app();
    return admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
}

async function main() {
    const apply = process.argv.includes('--apply');
    getAdminApp();
    const db = admin.firestore();
    const ref = db.doc(DOC_PATH);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('challenges/round-9 doc not found');

    const existing = snap.data();
    if (existing.page) {
        console.log('round-9 already has a `page` field. Current value:');
        console.log(JSON.stringify(existing.page, null, 2));
        console.log('\nThis script never overwrites an existing `page` - remove it manually first if you want to replace it.');
        return;
    }

    console.log('Will add `page` to challenges/round-9:');
    console.log(JSON.stringify(page, null, 2));

    if (!apply) {
        console.log('\nDRY RUN ONLY - no write made. Pass --apply to write.');
        return;
    }

    await ref.update({ page });
    console.log('\nApplied.');
}

main().catch(err => { console.error(err); process.exit(1); });
