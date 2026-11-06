// Run this AFTER the new firestore.rules are published to production. Signs in as a
// REAL anonymous user via the Firebase Auth REST API (not the Admin SDK, which bypasses
// rules entirely) and makes raw Firestore REST calls with that user's ID token, to
// confirm the published rules actually behave as intended from an ordinary visitor's
// perspective.
//
// The API key below is the public Firebase web API key (from js/firebase-init.js) -
// not a secret; every visitor's browser already has it.
//
// Usage: node scripts/test-rules.js

const API_KEY = 'AIzaSyBrRmGnPm3WcK2GKQqN_lAEvJJZPgXVdxw';
const PROJECT_ID = 'ai-innovation-hub-submissions';
const APP_ID = 'descasio-innovation-hub-perpetual';
const BASE_PATH = `artifacts/${APP_ID}/public/data`;

const AUTH_BASE = 'https://identitytoolkit.googleapis.com/v1';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function signInAnonymously() {
    const res = await fetch(`${AUTH_BASE}/accounts:signUp?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnSecureToken: true })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Anonymous sign-in failed: ${JSON.stringify(data)}`);
    return data.idToken;
}

async function fsRequest(idToken, method, pathSuffix, body) {
    const res = await fetch(`${FS_BASE}/${pathSuffix}`, {
        method,
        headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* non-JSON response */ }
    return { status: res.status, body: json || text };
}

function isDenied(result) {
    return result.status === 403 || (result.body && result.body.error && /PERMISSION_DENIED/i.test(result.body.error.status || ''));
}

function report(label, result, expectDenied) {
    const denied = isDenied(result);
    const pass = denied === expectDenied;
    console.log(`${pass ? 'PASS' : 'FAIL'} - ${label} (status ${result.status}${denied ? ', PERMISSION_DENIED' : ''})`);
    if (!pass) console.log('  response:', JSON.stringify(result.body).slice(0, 300));
    return pass;
}

function fsValue(obj) {
    // Minimal JS -> Firestore REST "Value" encoder for the simple field types this
    // script needs (string, integer, boolean).
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') fields[k] = { stringValue: v };
        else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
        else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    }
    return { fields };
}

async function main() {
    console.log('Signing in anonymously via REST...');
    const idToken = await signInAnonymously();
    console.log('Signed in.\n');

    let allPass = true;

    // Find a real existing submission and challenge doc to target for update/delete tests.
    const subsList = await fsRequest(idToken, 'GET', `${BASE_PATH}/submissions?pageSize=1`);
    const existingSubName = subsList.body && subsList.body.documents && subsList.body.documents[0] && subsList.body.documents[0].name;
    const existingSubId = existingSubName ? existingSubName.split('/').pop() : null;

    if (existingSubId) {
        const upd = await fsRequest(idToken, 'PATCH', `${BASE_PATH}/submissions/${existingSubId}?updateMask.fieldPaths=shortlisted`, fsValue({ shortlisted: true }));
        allPass = report('anonymous UPDATE on an existing submission', upd, true) && allPass;

        const del = await fsRequest(idToken, 'DELETE', `${BASE_PATH}/submissions/${existingSubId}`);
        allPass = report('anonymous DELETE on an existing submission', del, true) && allPass;
    } else {
        console.log('SKIP - no existing submission found to test update/delete against');
    }

    const chUpd = await fsRequest(idToken, 'PATCH', `${BASE_PATH}/challenges/round-8?updateMask.fieldPaths=title`, fsValue({ title: 'tampered' }));
    allPass = report('anonymous UPDATE on challenges/round-8', chUpd, true) && allPass;

    const chDel = await fsRequest(idToken, 'DELETE', `${BASE_PATH}/challenges/round-8`);
    allPass = report('anonymous DELETE on challenges/round-8', chDel, true) && allPass;

    // CREATE on a closed round (round 8 closed in October) - should be denied.
    const closedCreate = await fsRequest(idToken, 'POST', `${BASE_PATH}/submissions`, fsValue({
        name: 'Rules Test', email: 'rules.test@descasio.io', dept: 'Technology Services', round: 8
    }));
    allPass = report('CREATE a submission for round 8 (closed)', closedCreate, true) && allPass;

    // CREATE on challenges - should be denied (admin only).
    const chCreate = await fsRequest(idToken, 'POST', `${BASE_PATH}/challenges`, fsValue({ round: 99, title: 'Rules Test Round' }));
    allPass = report('CREATE a challenges doc', chCreate, true) && allPass;

    // LIST otps - should be denied.
    const otpsList = await fsRequest(idToken, 'GET', `${BASE_PATH}/otps?pageSize=1`);
    allPass = report('LIST otps collection', otpsList, true) && allPass;

    console.log('\nNOTE: a valid CREATE on the currently-open round cannot be tested until Round 9');
    console.log('actually opens (Monday 9 Nov 2026, 08:00 WAT) - run this script again after that');
    console.log('to confirm a well-formed, in-window create succeeds (expect PASS/status 200, not denied).');

    console.log(`\n${allPass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'} (see PASS/FAIL lines above)`);
    if (!allPass) process.exit(1);
}

main().catch(err => { console.error('test-rules.js failed:', err); process.exit(1); });
