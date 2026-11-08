// One-off, dry-run-by-default patch: renames Round 9's "canvasShareLink" requirement id
// to "canvasLink", matching Round 3's existing field name for the same concept (a direct
// Gemini Canvas share link) - per the Step 5 field-mapping request. Safe to do now since
// no real Round 9 submissions exist yet (round hasn't opened).
//
//   node patch-round9-field.js            -> dry run
//   node patch-round9-field.js --apply    -> writes it

const admin = require('firebase-admin');
const PROJECT_ID = 'ai-innovation-hub-submissions';
const DOC_PATH = 'artifacts/descasio-innovation-hub-perpetual/public/data/challenges/round-9';

function getAdminApp() {
    if (admin.apps.length) return admin.app();
    return admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
}

async function main() {
    getAdminApp();
    const db = admin.firestore();
    const ref = db.doc(DOC_PATH);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('round-9 challenge doc not found');
    const data = snap.data();

    const newRequirements = data.requirements.map(r => r.id === 'canvasShareLink' ? { ...r, id: 'canvasLink' } : r);
    console.log('Current requirements:', JSON.stringify(data.requirements, null, 2));
    console.log('\nNew requirements:', JSON.stringify(newRequirements, null, 2));

    if (process.argv.includes('--apply')) {
        await ref.update({ requirements: newRequirements });
        console.log('\nApplied.');
    } else {
        console.log('\nDRY RUN ONLY — no write made. Pass --apply to write.');
    }
}

main().catch(err => { console.error(err); process.exit(1); });
