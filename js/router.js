// Hash-based router. Maps URL hashes onto the existing state.activeTab values so
// every link and the browser back/forward buttons work.
//
//   #dashboard                  -> tab 'dashboard'
//   #challenges                 -> tab 'challenge'
//   #challenges/round-N         -> tab 'challenge', sub 'round-N'
//   #submissions                -> tab 'gallery'
//   #submissions/round-N        -> tab 'gallery', sub 'round-N' (feed filtered)
//   #submit                     -> tab 'gallery', sub null, wantsForm true
//   #ideas                      -> tab 'ideahub'
//   #winners                    -> tab 'winners'
//   #leaderboard                -> tab 'leaderboard'
//   (anything else, or empty)   -> tab 'dashboard'
//
// Note: `sub` is parsed and stored on state.routeSub, which renderChallenge() and
// renderGallery() (js/app.js) read to select/filter within their tab.
const Router = (() => {
    const HASH_TO_TAB = {
        dashboard: 'dashboard',
        challenges: 'challenge',
        submissions: 'gallery',
        ideas: 'ideahub',
        winners: 'winners',
        leaderboard: 'leaderboard',
        admin: 'admin'
    };
    const TAB_TO_HASH = {
        dashboard: 'dashboard',
        challenge: 'challenges',
        gallery: 'submissions',
        ideahub: 'ideas',
        winners: 'winners',
        leaderboard: 'leaderboard',
        admin: 'admin'
    };

    function parse() {
        const raw = (location.hash || '#dashboard').slice(1);
        const parts = raw.split('/').filter(Boolean);
        const base = parts[0] || 'dashboard';

        if (base === 'submit') {
            // The submission <form> lives at the top of the Submissions tab (js/app.js
            // renderGallery()), not the Challenge tab's detail panel.
            return { tab: 'gallery', sub: null, wantsForm: true };
        }

        const tab = HASH_TO_TAB[base] || 'dashboard';
        const sub = parts[1] || null;
        return { tab, sub, wantsForm: false };
    }

    function buildHash(tab, sub) {
        const base = TAB_TO_HASH[tab] || 'dashboard';
        return sub ? `#${base}/${sub}` : `#${base}`;
    }

    let handler = null;
    function onRouteChange(fn) {
        handler = fn;
    }

    function onRoute() {
        if (handler) handler(parse());
    }

    function go(tab, sub) {
        const hash = buildHash(tab, sub);
        if (location.hash !== hash) {
            location.hash = hash; // triggers the 'hashchange' listener below -> onRoute()
        } else {
            onRoute(); // same destination requested again - still re-render
        }
    }

    window.addEventListener('hashchange', onRoute);

    return { parse, buildHash, go, onRouteChange, onRoute };
})();
