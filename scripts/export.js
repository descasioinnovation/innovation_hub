// Read-only export of every subcollection under
// artifacts/descasio-innovation-hub-perpetual/public/data
// to backups/<YYYY-MM-DD>/<collection>.json
//
// Uses Application Default Credentials (gcloud auth application-default login).
// This script never calls set/update/delete/add on Firestore.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const PROJECT_ID = 'ai-innovation-hub-submissions';
const ROOT_DOC_PATH = 'artifacts/descasio-innovation-hub-perpetual/public/data';

admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID
});

const db = admin.firestore();

function isTimestamp(value) {
    return value && typeof value === 'object' && typeof value.toDate === 'function' && typeof value.toMillis === 'function';
}

function convertValue(value) {
    if (isTimestamp(value)) {
        return value.toDate().toISOString();
    }
    if (Array.isArray(value)) {
        return value.map(convertValue);
    }
    if (value && typeof value === 'object') {
        // GeoPoint or DocumentReference: stringify rather than dropping silently.
        if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
            return { latitude: value.latitude, longitude: value.longitude };
        }
        if (typeof value.path === 'string' && typeof value.id === 'string' && typeof value.get === 'function') {
            return `ref:${value.path}`;
        }
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = convertValue(v);
        }
        return out;
    }
    return value;
}

async function exportCollection(collectionRef, outDir) {
    const snapshot = await collectionRef.get();
    const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...convertValue(doc.data())
    }));
    const outPath = path.join(outDir, `${collectionRef.id}.json`);
    fs.writeFileSync(outPath, JSON.stringify(docs, null, 2), 'utf8');
    return docs.length;
}

async function main() {
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const subfolder = process.argv[2]; // optional, e.g. "before-apply" / "after-apply"
    const outDir = subfolder
        ? path.join(__dirname, '..', 'backups', dateStr, subfolder)
        : path.join(__dirname, '..', 'backups', dateStr);
    fs.mkdirSync(outDir, { recursive: true });

    const rootDocRef = db.doc(ROOT_DOC_PATH);
    const collections = await rootDocRef.listCollections();

    if (collections.length === 0) {
        console.log(`No subcollections found under ${ROOT_DOC_PATH}`);
        return;
    }

    console.log(`Exporting ${collections.length} collection(s) under ${ROOT_DOC_PATH} to ${outDir}\n`);

    const summary = [];
    for (const col of collections) {
        const count = await exportCollection(col, outDir);
        summary.push({ collection: col.id, documents: count });
        console.log(`  ${col.id}: ${count} document(s)`);
    }

    fs.writeFileSync(
        path.join(outDir, '_summary.json'),
        JSON.stringify({ exportedAt: new Date().toISOString(), rootDocPath: ROOT_DOC_PATH, collections: summary }, null, 2),
        'utf8'
    );

    console.log(`\nDone. Summary written to ${path.join(outDir, '_summary.json')}`);
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Export failed:', err);
        process.exit(1);
    });
