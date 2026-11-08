// Read-only: fetches the currently DEPLOYED Firestore security rules via the Firebase
// Rules API (using ADC) and saves them to backups/<date>/firestore.rules. Makes no
// changes to the rules themselves. The access token is used in-process only and is
// never printed or written anywhere.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const PROJECT_ID = 'ai-innovation-hub-submissions';

async function getAccessToken() {
    const cred = admin.credential.applicationDefault();
    const result = await cred.getAccessToken();
    return result.access_token;
}

async function main() {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };

    // 1) Find the current release for the Firestore service.
    const releaseRes = await fetch(
        `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases/cloud.firestore`,
        { headers }
    );
    if (!releaseRes.ok) {
        const body = await releaseRes.text();
        throw new Error(`Release fetch failed: ${releaseRes.status} ${body}`);
    }
    const release = await releaseRes.json();
    console.log('Release:', release.name, '-> ruleset', release.rulesetName, 'updated', release.updateTime);

    // 2) Fetch that ruleset's source.
    const rulesetRes = await fetch(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`, { headers });
    if (!rulesetRes.ok) {
        const body = await rulesetRes.text();
        throw new Error(`Ruleset fetch failed: ${rulesetRes.status} ${body}`);
    }
    const ruleset = await rulesetRes.json();
    const file = (ruleset.source && ruleset.source.files && ruleset.source.files[0]) || null;
    if (!file) throw new Error('No rules file found in ruleset response');

    const dateStr = new Date().toISOString().slice(0, 10);
    const outDir = path.join(__dirname, '..', 'backups', dateStr);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'firestore.rules');
    fs.writeFileSync(outPath, file.content);

    console.log(`Ruleset created: ${ruleset.createTime}, name: ${ruleset.name}`);
    console.log(`Saved ${file.content.length} bytes to ${outPath}`);
}

main().catch(err => { console.error('check-rules.js failed:', err.message); process.exit(1); });
