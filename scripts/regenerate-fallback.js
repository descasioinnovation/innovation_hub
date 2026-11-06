// Regenerates data/challenges-fallback.json from the current challenges-seed-data.js,
// preserving the existing sanitization rule: drop winningSubmissionId and _source
// (the only two things ever stripped from this public-facing snapshot).
const fs = require('fs');
const path = require('path');
const { CHALLENGES } = require('./challenges-seed-data');

const sanitized = CHALLENGES.map(ch => {
    const { winningSubmissionId, _source, ...rest } = ch;
    return { id: ch.slug || `round-${ch.round}`, ...rest };
});

const outPath = path.join(__dirname, '..', 'data', 'challenges-fallback.json');
fs.writeFileSync(outPath, JSON.stringify(sanitized, null, 2) + '\n');
console.log(`Wrote ${outPath}`);
