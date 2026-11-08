// Data layer for the `challenges` collection
// (artifacts/descasio-innovation-hub-perpetual/public/data/challenges).
//
// Live Firestore listener with a static-snapshot fallback (data/challenges-fallback.json)
// so the site never shows blanks if Firestore is unreachable or the read is denied.
const Challenges = (() => {
    let cache = [];
    let ready = false;
    let usingFallback = false;
    const listeners = [];

    function notify() {
        listeners.forEach(fn => {
            try { fn(); } catch (e) { console.error('Challenges listener callback failed', e); }
        });
    }

    // Registers fn to be called whenever the challenges cache changes. Also calls it
    // immediately if data is already loaded, so late subscribers don't miss the first state.
    function onUpdate(fn) {
        listeners.push(fn);
        if (ready) fn();
    }

    async function loadFallback() {
        try {
            const res = await fetch('data/challenges-fallback.json');
            if (!res.ok) throw new Error(`fallback fetch failed: ${res.status}`);
            cache = await res.json();
            usingFallback = true;
            ready = true;
            notify();
        } catch (e) {
            console.error('Challenges: fallback snapshot failed to load', e);
        }
    }

    // Call once, after Firebase is initialized and signed in.
    function init(db, stableAppId) {
        try {
            db.collection('artifacts').doc(stableAppId).collection('public').doc('data').collection('challenges')
                .onSnapshot(
                    (snapshot) => {
                        if (snapshot.empty) {
                            // Collection reachable but empty - fall back rather than show blanks,
                            // but only if we don't already have real data loaded.
                            if (!ready || usingFallback) loadFallback();
                            return;
                        }
                        cache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                        usingFallback = false;
                        ready = true;
                        notify();
                    },
                    (err) => {
                        console.error('Challenges: live listener error, using fallback', err);
                        if (!ready) loadFallback();
                    }
                );
        } catch (e) {
            console.error('Challenges: init failed, using fallback', e);
            loadFallback();
        }
    }

    function allRounds() {
        return [...cache].sort((a, b) => (b.round || 0) - (a.round || 0)); // newest first
    }

    function getRound(n) {
        return cache.find(c => c.round === n) || null;
    }

    // DEV-ONLY testing override: on localhost with ?preview=1&forceOpen=N in the URL,
    // round N is treated as "open" regardless of its real dates. Both the exact-match
    // localhost/127.0.0.1 hostname check and the ?preview=1 flag are required -
    // structurally impossible on the live domain, whose hostname is never either of those.
    function getForcedOpenRound() {
        try {
            const host = location.hostname;
            const isLocalHost = host === 'localhost' || host === '127.0.0.1';
            if (!isLocalHost) return null;
            const params = new URLSearchParams(location.search);
            if (params.get('preview') !== '1') return null;
            const forced = params.get('forceOpen');
            return forced ? Number(forced) : null;
        } catch (e) {
            return null;
        }
    }

    // DEV-ONLY testing override: on localhost with ?preview=1&now=<ISO date> in the URL,
    // every "current time" calculation in this module (and app.js's countdown, via
    // Challenges.previewNow()) uses that date instead of the real clock, so the whole
    // round lifecycle can be exercised at any simulated moment. Same exact-match
    // localhost/127.0.0.1 + ?preview=1 guarantee as getForcedOpenRound() above.
    function previewNow() {
        try {
            const host = location.hostname;
            const isLocalHost = host === 'localhost' || host === '127.0.0.1';
            if (!isLocalHost) return null;
            const params = new URLSearchParams(location.search);
            if (params.get('preview') !== '1') return null;
            const raw = params.get('now');
            if (!raw) return null;
            const d = new Date(raw);
            return isNaN(d.getTime()) ? null : d;
        } catch (e) {
            return null;
        }
    }

    // "upcoming" (now < opensAt), "open", "judging" (past closesAt, no winner yet),
    // "closed" (winner set). Respects a stored status override if present.
    function statusOf(ch, now) {
        now = now || previewNow() || new Date();
        if (!ch) return null;
        if (ch.round === getForcedOpenRound()) return 'open';
        if (ch.statusOverride) return ch.statusOverride;
        const opens = ch.opensAt ? new Date(ch.opensAt) : null;
        const closes = ch.closesAt ? new Date(ch.closesAt) : null;
        if (opens && now < opens) return 'upcoming';
        if (closes && now > closes) return ch.winnerName ? 'closed' : 'judging';
        return 'open';
    }

    // The round whose opensAt <= now <= closesAt; if none, the nearest upcoming;
    // if none of those either, the latest (highest round number).
    function currentRound(now) {
        now = now || previewNow() || new Date();
        if (!cache.length) return null;

        const open = cache.find(c => statusOf(c, now) === 'open');
        if (open) return open;

        const upcoming = cache
            .filter(c => statusOf(c, now) === 'upcoming')
            .sort((a, b) => new Date(a.opensAt) - new Date(b.opensAt));
        if (upcoming.length) return upcoming[0];

        return allRounds()[0] || null;
    }

    // { date: Date, kind: 'opens' | 'closes' } for the countdown helper to target -
    // opensAt while upcoming, otherwise closesAt.
    function countdownTarget(ch, now) {
        if (!ch) return null;
        now = now || previewNow() || new Date();
        const status = statusOf(ch, now);
        if (status === 'upcoming') {
            return { date: ch.opensAt ? new Date(ch.opensAt) : null, kind: 'opens' };
        }
        return { date: ch.closesAt ? new Date(ch.closesAt) : null, kind: 'closes' };
    }

    return {
        init,
        onUpdate,
        allRounds,
        getRound,
        currentRound,
        statusOf,
        countdownTarget,
        previewNow,
        isReady: () => ready,
        isUsingFallback: () => usingFallback
    };
})();
