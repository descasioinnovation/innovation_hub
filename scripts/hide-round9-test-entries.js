// Additive: sets hidden: true, hiddenReason: "test" on the given submission doc
// id(s). Never touches any other field. Dry-run by default; pass --apply to write.
//
// Usage: node scripts/hide-round9-test-entries.js <id> [<id> ...] [--apply]
const admin = require('firebase-admin');

const PROJECT_ID = 'ai-innovation-hub-submissions';
const BASE_PATH = 'artifacts/descasio-innovation-hub-perpetual/public/data';

function getAdminApp() {
    if (admin.apps.length) return admin.app();
    return admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
}

async function main() {
    const apply = process.argv.includes('--apply');
    const ids = process.argv.slice(2).filter(a => a !== '--apply');
    if (!ids.length) {
        console.error('Usage: node scripts/hide-round9-test-entries.js <id> [<id> ...] [--apply]');
        process.exit(1);
    }

    getAdminApp();
    const db = admin.firestore();

    for (const id of ids) {
        const ref = db.doc(`${BASE_PATH}/submissions/${id}`);
        const snap = await ref.get();
        if (!snap.exists) {
            console.log(`${id}: not found, skipping`);
            continue;
        }
        const data = snap.data();
        console.log(`${id} (${data.type === 'group' ? data.teamName : data.name}): hidden=${data.hidden || false} -> true, hiddenReason=${data.hiddenReason || null} -> "test"`);
        if (apply) {
            await ref.update({ hidden: true, hiddenReason: 'test' });
            console.log(`${id}: applied`);
        }
    }

    if (!apply) console.log('\nDRY RUN ONLY - no writes made. Pass --apply to write.');
}

main().catch(err => { console.error(err); process.exit(1); });
