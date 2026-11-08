// Step 5C QA: submit ONE test entry for Round 9 (the payload shape exactly matches
// js/app.js's handleFormSubmit for an individual entry with a url + multiselect
// requirement), then immediately hide it (hidden: true, hiddenReason: "test") so it
// never appears in the public feed. Entirely additive - adds one doc, then patches
// that same doc; touches nothing else.
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
    const colRef = db.collection(SUBMISSIONS_PATH);

    const payload = {
        name: 'Test – Redesign QA',
        email: 'test.redesignqa@descasio.io',
        dept: 'Technology Services',
        type: 'individual',
        canvasLink: 'https://gemini.google.com/share/test-redesign-qa-placeholder',
        toolsUsed: ['Gemini Canvas'],
        round: 9,
        shortlisted: false,
        timestamp: new Date().toISOString()
    };

    console.log('Payload to write:', JSON.stringify(payload, null, 2));

    const docRef = await colRef.add(payload);
    console.log(`\nCreated doc: ${docRef.id}`);

    await docRef.update({ hidden: true, hiddenReason: 'test' });
    console.log('Patched doc with hidden: true, hiddenReason: "test"');

    const snap = await docRef.get();
    console.log('\nFinal doc state:', JSON.stringify(snap.data(), null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
