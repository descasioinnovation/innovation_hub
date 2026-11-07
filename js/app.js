        // --- Safe persistedAuth evaluation to avoid execution halt ReferenceErrors ---
        const persistedAuth = (() => {
            try {
                const data = localStorage.getItem('descasio_hub_auth');
                return data ? JSON.parse(data) : null;
            } catch (e) {
                return null;
            }
        })();

        let state = {
            user: null,
            isAuthenticated: !!persistedAuth,
            gatewayView: 'email',
            authEmail: persistedAuth ? persistedAuth.email : '',
            otpHash: null,
            otpSalt: null,
            otpExpiry: null,
            otpUsed: false,
            activeTab: 'dashboard',
            routeSub: null,
            submissionType: 'individual',
            submissions: [],
            ideas: [],
            leaderboard: [...FINAL_STANDINGS],
            selectedInnovation: null,
            selectedIdea: null,
            isAdmin: false,
            showAdminLogin: false,
            adminSignInError: null,
            adminSigningIn: false,
            richChecklist: {},
            showSubmitConfirm: false,
            pendingWarnings: [],
            challengeClosed: false,
            timeLeft: {
                days: 0,
                hours: 0,
                mins: 0,
                label: "HUNT ENDS"
            },
            formData: {},
            formToolsSelected: [], // multiselect requirement answers (array of chip labels)
            submitting: false,
            submissionSent: false,
            ideaData: {},
            ideaSubmitting: false,
            ideaSent: false,
            expandedIdeaId: null,
            leaderboardQuery: '',
            loading: false
        };

        async function hashString(str) {
            const encoder = new TextEncoder();
            const data = encoder.encode(str);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }

        async function requestOtp() {
            const email = document.getElementById('gatewayEmail').value.trim().toLowerCase();
            if (!email.endsWith('@descasio.io')) {
                showGatewayError("Access restricted to @descasio.io email addresses.");
                return;
            }
            state.loading = true;
            updateUI();
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const salt = crypto.randomUUID();
            const expiry = Date.now() + (60 * 60 * 1000);
            try {
                await emailjs.send("service_v9ysmxt", "template_20x7ujf", {
                    to_email: email,
                    otp_code: otp
                });
                state.authEmail = email;
                // Only a salted hash of the code is kept in memory - never the plain code
                // itself (interim hardening; see SECURITY_NOTES.md for the full fix).
                state.otpHash = await hashString(salt + otp);
                state.otpSalt = salt;
                state.otpExpiry = expiry;
                state.otpUsed = false;
                state.gatewayView = 'otp';
                state.loading = false;
                updateUI();
            } catch (err) {
                console.error(err);
                showGatewayError("Failed to send code. Please check your connection.");
                state.loading = false;
                updateUI();
            }
        }

        async function verifyOtp() {
            const entered = document.getElementById('gatewayOtp').value.trim();
            if (state.otpUsed) {
                showGatewayError("This code has already been used. Please request a new one.");
                return;
            }
            if (Date.now() > state.otpExpiry) {
                showGatewayError("Code has expired. Please request a new one.");
                return;
            }
            const enteredHash = await hashString(state.otpSalt + entered);
            if (enteredHash === state.otpHash) {
                state.isAuthenticated = true;
                state.otpUsed = true; // single-use: this hash cannot be matched again
                try {
                    localStorage.setItem('descasio_hub_auth', JSON.stringify({
                        email: state.authEmail,
                        expiry: Date.now() + (30 * 24 * 60 * 60 * 1000)
                    }));
                } catch (e) {}
                updateUI();
                if (state.user) {
                    try {
                        await db.collection('artifacts').doc(STABLE_APP_ID)
                            .collection('users').doc(state.user.uid)
                            .collection('profile').doc('session').set({
                                email: state.authEmail,
                                authenticated: true,
                                timestamp: new Date().getTime()
                            });
                    } catch (e) {
                        console.error("Firestore persistence failed", e);
                    }
                }
            } else {
                showGatewayError("Invalid access code.");
            }
        }

        function showGatewayError(msg) {
            const errEl = document.getElementById('gatewayError');
            if (errEl) {
                errEl.innerText = msg;
                errEl.classList.remove('hidden');
            }
        }

        function formatWATDateTime(isoDate) {
            const d = new Date(isoDate);
            return {
                weekday: d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Africa/Lagos' }),
                day: d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Africa/Lagos' }),
                month: d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Africa/Lagos' }),
                time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' })
            };
        }

        function diffToParts(diffMs) {
            return {
                days: Math.floor(diffMs / (1000 * 60 * 60 * 24)),
                hours: Math.floor((diffMs / (1000 * 60 * 60)) % 24),
                mins: Math.floor((diffMs / 1000 / 60) % 60)
            };
        }

        // Short form for disabled CTA buttons, e.g. "Opens Monday 8:00 AM" (no date number).
        function formatOpenShort(isoDate) {
            const { weekday, time } = formatWATDateTime(isoDate);
            return `Opens ${weekday} ${time}`;
        }

        // Countdown is driven by the challenges collection (js/challenges.js) instead of a
        // hand-edited target date.
        //   upcoming -> counts down to opensAt, label "Opens <Weekday> <D> <Mon>, <time>"
        //   open     -> counts down to closesAt, label "Closes <Wkd> <D> <Mon>, <time> WAT"
        //   judging/closed -> no countdown; state.timeLeft.showCountdown is false and the
        //     hero (js/app.js renderDashboard) shows status text instead.
        // Updates every minute per spec; renderDashboard() re-reads state.timeLeft directly
        // on each updateUI() render rather than being poked via getElementById.
        function updateCountdown() {
            const previewNow = (typeof Challenges !== 'undefined') ? Challenges.previewNow() : null;
            const now = previewNow || new Date();
            const round = (typeof Challenges !== 'undefined') ? Challenges.currentRound(now) : null;

            if (!round) {
                // No challenges data yet (listener hasn't fired, fallback hasn't loaded) -
                // leave existing state.timeLeft/challengeClosed as-is rather than guessing.
                return;
            }

            const status = Challenges.statusOf(round, now);
            const prevClosed = state.challengeClosed;

            if (status === 'judging' || status === 'closed') {
                state.challengeClosed = true;
                state.timeLeft = {
                    days: 0, hours: 0, mins: 0, showCountdown: false,
                    label: status === 'judging' ? 'Judging in progress' : 'Submissions closed'
                };
            } else if (status === 'upcoming') {
                state.challengeClosed = true;
                const target = new Date(round.opensAt);
                const diff = Math.max(0, target - now);
                const { weekday, day, month, time } = formatWATDateTime(round.opensAt);
                state.timeLeft = {
                    ...diffToParts(diff),
                    showCountdown: true,
                    label: `Opens ${weekday} ${day} ${month}, ${time}`
                };
            } else {
                // open
                state.challengeClosed = false;
                const target = new Date(round.closesAt);
                const diff = Math.max(0, target - now);
                const { weekday, day, month, time } = formatWATDateTime(round.closesAt);
                state.timeLeft = {
                    ...diffToParts(diff),
                    showCountdown: true,
                    label: `Closes ${weekday.slice(0, 3)} ${day} ${month}, ${time} WAT`
                };
            }

            if (state.challengeClosed !== prevClosed) {
                updateUI();
            } else if (document.getElementById('countdown-timer')) {
                // Cheap re-render of just the Dashboard hero's countdown digits/label each
                // tick, without a full updateUI() pass (which would be wasted work and could
                // interrupt focus elsewhere on the page).
                const labelEl = document.getElementById('countdown-label');
                const timerEl = document.getElementById('countdown-timer');
                if (labelEl) labelEl.innerText = state.timeLeft.label;
                if (timerEl) timerEl.innerText = state.timeLeft.showCountdown
                    ? `${state.timeLeft.days}d : ${state.timeLeft.hours}h : ${state.timeLeft.mins}m`
                    : '';
            }
        }

        // DEV-ONLY (Step 8 responsive audit): logs any element whose right edge exceeds
        // the viewport width, so overflow bugs show up in the console while testing at
        // narrow widths in DevTools. Same localhost + ?preview=1 guarantee as the other
        // dev-only overrides (js/challenges.js) - never runs on the live domain.
        function isDevOverflowCheckEnabled() {
            try {
                const host = location.hostname;
                const isLocalHost = host === 'localhost' || host === '127.0.0.1';
                if (!isLocalHost) return false;
                return new URLSearchParams(location.search).get('preview') === '1';
            } catch (e) {
                return false;
            }
        }

        // True if some ancestor between el and <body> scrolls its own overflow (e.g. the
        // leaderboard table's overflow-x-auto wrapper) and that ancestor itself fits the
        // viewport - i.e. el's overflow is intentionally contained, not a layout bug.
        function hasContainingScrollAncestor(el, vw) {
            let node = el.parentElement;
            while (node && node !== document.body) {
                const style = getComputedStyle(node);
                if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
                    if (node.getBoundingClientRect().right <= vw + 1) return true;
                }
                node = node.parentElement;
            }
            return false;
        }

        function logOverflowingElements() {
            if (!isDevOverflowCheckEnabled()) return;
            const vw = document.documentElement.clientWidth;
            const offenders = [];
            document.querySelectorAll('body *').forEach(el => {
                if (el.closest('.ticker-wrap')) return; // the announcement ticker is deliberately wider than the viewport mid-scroll
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.right > vw + 1 && !hasContainingScrollAncestor(el, vw)) {
                    offenders.push({ el, right: Math.round(rect.right) });
                }
            });
            if (offenders.length) {
                console.warn(`[overflow-check] ${offenders.length} element(s) exceed the ${vw}px viewport:`);
                offenders.forEach(o => console.warn(`  right edge ${o.right}px:`, o.el));
            }
        }

        function updateUI() {
            if (document.activeElement &&
                (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
                return;
            }

            const app = document.getElementById('app');
            if (!state.user) return;
            if (!state.isAuthenticated) {
                app.innerHTML = renderLoginGateway();
                lucide.createIcons();
                return;
            }
            app.innerHTML = `
                ${Shell.renderAnnouncementBar(state)}
                ${Shell.renderHeader(state)}
                <main class="max-w-7xl mx-auto p-6 md:p-8 min-h-[70vh]">
                    ${renderTabContent()}
                </main>
                ${state.selectedInnovation ? renderModal() : ''}
                ${state.selectedIdea ? renderIdeaModal() : ''}
                ${state.showAdminLogin ? renderAdminLogin() : ''}
                ${Shell.renderFooter()}
            `;
            lucide.createIcons();
            updateCountdown();
            logOverflowingElements();
        }

        function renderLoginGateway() {
            return `
                <div class="min-h-screen bg-[#020617] flex items-center justify-center p-6 relative overflow-hidden">
                    <div class="absolute -top-20 -left-20 w-96 h-96 bg-blue-900/20 blur-[120px] rounded-full"></div>
                    <div class="absolute -bottom-20 -right-20 w-96 h-96 bg-indigo-900/20 blur-[120px] rounded-full"></div>
                    <div class="modal-card w-full max-w-md bg-[#0f172a] rounded-[2.5rem] border border-slate-800 p-12 shadow-2xl relative z-10 text-center">
                        <div class="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-10 shadow-lg shadow-blue-500/20">
                            <i data-lucide="zap" class="text-white w-10 h-10"></i>
                        </div>
                        <h2 class="text-white text-4xl font-black italic tracking-tighter uppercase mb-2">DESCASIO</h2>
                        <p class="text-blue-500 text-[10px] font-black uppercase tracking-[0.3em] mb-12">Innovation Hub Gateway</p>
                        ${state.gatewayView === 'email' ? `
                            <p class="text-slate-400 text-sm italic mb-10 px-4 leading-relaxed">Enter your @descasio.io email to receive an access code.</p>
                            <input id="gatewayEmail" type="email" class="w-full bg-slate-950 border border-slate-800 rounded-2xl p-5 text-center text-white outline-none focus:ring-2 ring-blue-600 font-bold mb-6" placeholder="name@descasio.io" value="${state.authEmail}">
                            <div id="gatewayError" class="hidden text-red-500 text-[10px] font-bold uppercase mb-6"></div>
                            <button onclick="requestOtp()" class="w-full bg-white text-black font-black py-5 rounded-2xl uppercase tracking-widest text-[11px] hover:bg-blue-50 transition shadow-xl active:scale-[0.98] flex items-center justify-center gap-3">
                                ${state.loading ? '<div class="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin"></div>' : 'REQUEST ACCESS CODE'}
                            </button>
                        ` : `
                            <p class="text-slate-400 text-sm italic mb-10 px-4 leading-relaxed">Enter the 6-digit code sent to <br><b class="text-blue-400">${state.authEmail}</b></p>
                            <input id="gatewayOtp" type="text" maxlength="6" class="w-full bg-slate-950 border border-slate-800 rounded-2xl p-5 text-center text-white outline-none focus:ring-2 ring-blue-600 font-mono tracking-[0.5em] text-2xl font-bold mb-6" placeholder="000000">
                            <div id="gatewayError" class="hidden text-red-500 text-[10px] font-bold uppercase mb-6"></div>
                            <button onclick="verifyOtp()" class="w-full bg-blue-600 text-white font-black py-5 rounded-2xl uppercase tracking-widest text-[11px] hover:bg-blue-500 transition shadow-xl active:scale-[0.98] mb-4">VERIFY & ENTER</button>
                            <button onclick="state.gatewayView = 'email'; updateUI();" class="text-slate-500 text-[10px] font-black uppercase tracking-widest hover:text-white transition">Back to Email</button>
                        `}
                    </div>
                </div>
            `;
        }


        function formatShortDateWAT(isoDate) {
            const d = new Date(isoDate);
            const day = d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Africa/Lagos' });
            const month = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Africa/Lagos' });
            return `${day} ${month}`;
        }

        function formatWindow(ch) {
            if (!ch.opensAt || !ch.closesAt) return '—';
            const w = `${formatShortDateWAT(ch.opensAt)} – ${formatShortDateWAT(ch.closesAt)}`;
            return ch.datesApproximate ? `${w} (approx.)` : w;
        }

        function generateSnowflakes(count) {
            let flakes = '';
            for (let i = 0; i < count; i++) {
                const s = 2 + (i % 3);
                const left = (i * 41) % 100;
                const dur = 7 + (i % 6);
                const delay = ((i * 0.7) % 8).toFixed(1);
                flakes += `<span class="flake" style="left:${left}%;width:${s}px;height:${s}px;animation-duration:${dur}s;animation-delay:-${delay}s"></span>`;
            }
            return flakes;
        }

        // Renders a challenge's `brief` block array (paragraphs + lists) as HTML.
        function renderBriefHtml(ch) {
            const summaryNote = ch.briefIsSummary
                ? `<p class="font-inter text-xs italic text-text-faint shell-sentence-case mb-2">${ch.briefIsSummaryLabel || 'Summary — original brief not archived'}</p>`
                : '';
            const blocks = (ch.brief || []).map(block => {
                if (block.type === 'list') {
                    return `<ul class="list-disc list-inside space-y-1 font-inter text-[15px] leading-[1.65] text-text-2">${block.items.map(i => `<li>${i}</li>`).join('')}</ul>`;
                }
                return `<p class="font-inter text-[15px] leading-[1.65] text-text-2">${block.text}</p>`;
            }).join('<div class="h-2"></div>');
            return `${summaryNote}<div class="space-y-3">${blocks || '<p class="font-inter text-[15px] text-text-faint italic">No brief text available.</p>'}</div>`;
        }

        function renderDashboard() {
            const round = Challenges.currentRound();
            if (!round) {
                return `<div class="text-center py-24 font-inter text-text-muted">Loading challenge data…</div>`;
            }
            const status = Challenges.statusOf(round);
            const allRounds = Challenges.allRounds(); // newest first
            const highestRound = allRounds.length ? allRounds[0].round : round.round;
            const isFinalOfYear = round.round === highestRound;

            // --- Hero status badges ---
            let statusBadge;
            if (status === 'open') {
                statusBadge = `<span class="inline-flex items-center gap-2 h-[30px] px-3 rounded-full bg-[rgba(63,166,107,0.16)] border border-[rgba(63,166,107,0.45)] text-green-text font-inter font-semibold text-xs tracking-[0.4px] shell-sentence-case"><span class="w-2 h-2 rounded-full bg-green"></span>Round ${round.round} · Open now</span>`;
            } else if (status === 'upcoming') {
                statusBadge = `<span class="inline-flex items-center h-[30px] px-3 rounded-full bg-[rgba(242,181,68,0.14)] border border-[rgba(242,181,68,0.4)] text-gold-text font-inter font-semibold text-xs shell-sentence-case">Round ${round.round} · ${formatShortDateWAT(round.opensAt) ? `Opens ${formatWATDateTime(round.opensAt).weekday}` : 'Opens soon'}</span>`;
            } else if (status === 'judging') {
                statusBadge = `<span class="inline-flex items-center h-[30px] px-3 rounded-full bg-[rgba(159,179,200,0.12)] border border-border-strong text-text-2 font-inter font-semibold text-xs shell-sentence-case">Round ${round.round} · Judging</span>`;
            } else {
                statusBadge = `<span class="inline-flex items-center h-[30px] px-3 rounded-full bg-[rgba(159,179,200,0.12)] border border-border-strong text-text-2 font-inter font-semibold text-xs shell-sentence-case">Round ${round.round} · Closed</span>`;
            }
            const finaleBadge = isFinalOfYear
                ? `<span class="inline-flex items-center h-[30px] px-3 rounded-full bg-[rgba(242,181,68,0.14)] border border-[rgba(242,181,68,0.4)] text-gold-text font-inter font-semibold text-xs shell-sentence-case">Final challenge of ${round.year}</span>`
                : '';

            // --- CTAs ---
            const briefHref = Router.buildHash('challenge', round.slug || `round-${round.round}`);
            const submitDisabled = status !== 'open';
            const submitLabel = status === 'upcoming' ? formatOpenShort(round.opensAt)
                : status === 'judging' ? 'Judging in progress'
                : status === 'closed' ? 'Submissions closed'
                : 'Submit your entry';
            const submitCta = submitDisabled
                ? `<span class="inline-flex items-center h-12 px-6 rounded-full border border-border-strong text-text-faint font-inter font-semibold text-[15px] shell-sentence-case cursor-not-allowed opacity-70 whitespace-nowrap">${submitLabel}</span>`
                : `<a href="#submit" class="btn-outline inline-flex items-center h-12 px-6 rounded-full border-[1.5px] border-[#7FA9D6] text-text-strong font-inter font-semibold text-[15px] shell-sentence-case no-underline">Submit your entry</a>`;

            // --- Countdown / status text ---
            const countdownBlock = state.timeLeft && state.timeLeft.showCountdown ? `
                <div class="hero-countdown-boxes flex gap-2">
                    <div class="w-[72px] py-2.5 rounded-[14px] bg-[rgba(5,14,28,0.55)] border border-border-strong text-center"><div class="hero-countdown-num font-poppins font-bold text-2xl text-text-strong">${state.timeLeft.days}</div><div class="font-inter font-medium text-[11px] text-text-muted tracking-[1px] shell-sentence-case">days</div></div>
                    <div class="w-[72px] py-2.5 rounded-[14px] bg-[rgba(5,14,28,0.55)] border border-border-strong text-center"><div class="hero-countdown-num font-poppins font-bold text-2xl text-text-strong">${state.timeLeft.hours}</div><div class="font-inter font-medium text-[11px] text-text-muted tracking-[1px] shell-sentence-case">hrs</div></div>
                    <div class="w-[72px] py-2.5 rounded-[14px] bg-[rgba(5,14,28,0.55)] border border-border-strong text-center"><div class="hero-countdown-num font-poppins font-bold text-2xl text-text-strong">${state.timeLeft.mins}</div><div class="font-inter font-medium text-[11px] text-text-muted tracking-[1px] shell-sentence-case">mins</div></div>
                </div>
                <div class="flex flex-col justify-center gap-0.5 pl-1.5">
                    <span id="countdown-label" class="font-inter font-semibold text-[13px] text-text-strong shell-sentence-case">${state.timeLeft.label}</span>
                    <span id="countdown-timer" class="hidden"></span>
                    ${status !== 'upcoming' ? `<span class="font-inter text-[13px] text-text-muted shell-sentence-case">${liveEntryCount(round)} entries so far</span>` : ''}
                </div>` : `
                <div class="flex flex-col gap-0.5">
                    <span id="countdown-label" class="font-poppins font-semibold text-lg text-text-strong shell-sentence-case">${state.timeLeft ? state.timeLeft.label : ''}</span>
                    <span id="countdown-timer" class="hidden"></span>
                    ${status !== 'upcoming' ? `<span class="font-inter text-[13px] text-text-muted shell-sentence-case">${liveEntryCount(round)} entries so far</span>` : ''}
                </div>`;

            // --- Optional resource links ---
            const resourcesHtml = (round.resources && round.resources.length) ? `
                <div class="flex flex-wrap gap-3">
                    ${round.resources.map(r => `<a href="${r.url}" target="_blank" rel="noopener noreferrer" class="btn-outline inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[rgba(0,174,239,0.12)] border border-border-strong text-link font-inter font-semibold text-[13px] shell-sentence-case no-underline"><i data-lucide="link" class="w-3.5 h-3.5"></i>${r.label}</a>`).join('')}
                </div>` : '';

            // --- KPI tiles ---
            const challengesThisYear = allRounds.filter(r => r.year === round.year && r.round <= round.round).length;
            const innovatorCount = state.leaderboard.length;
            const lastCompleted = allRounds.find(r => Challenges.statusOf(r) === 'closed');
            const leader = state.leaderboard[0];

            const kpiTiles = [
                { label: 'Challenges this year', value: String(challengesThisYear), meta: `March to ${round.month}` },
                { label: 'Innovators on the leaderboard', value: String(innovatorCount), meta: 'across all departments' },
                lastCompleted
                    ? { label: `Entries in Round ${lastCompleted.round}`, value: String(lastCompleted.entryCount || 0), meta: lastCompleted.title }
                    : { label: 'Entries in the last round', value: '0', meta: 'No completed rounds yet' },
                leader
                    ? { label: 'Leaderboard leader', value: `${leader.cumulativeScore.toFixed(1)} <span class="font-inter font-medium text-[15px] text-text-muted">pts</span>`, meta: leader.name }
                    : { label: 'Leaderboard leader', value: '—', meta: '' }
            ];
            const kpiHtml = kpiTiles.map(t => `
                <div class="p-[22px] rounded-[20px] bg-surface border border-border flex flex-col gap-1.5">
                    <span class="font-inter font-medium text-[13px] text-text-muted shell-sentence-case">${t.label}</span>
                    <span class="font-poppins font-bold text-[34px] text-text-strong">${t.value}</span>
                    <span class="font-inter text-[13px] text-text-muted shell-sentence-case">${t.meta}</span>
                </div>`).join('');

            // --- "Our <year> challenge journey" tiles ---
            const journeyRounds = allRounds.slice().sort((a, b) => a.round - b.round).filter(r => r.round <= round.round);
            const journeyTiles = journeyRounds.map(r => {
                const st = Challenges.statusOf(r);
                let meta, metaColorClass, tileClasses;
                if (st === 'open') {
                    meta = 'Open now'; metaColorClass = 'text-green-text';
                    tileClasses = 'bg-surface-active border-[1.5px] border-green';
                } else if (st === 'upcoming') {
                    meta = `Opens ${formatShortDateWAT(r.opensAt)}`; metaColorClass = 'text-gold-text';
                    tileClasses = 'bg-[#0E1F36] border border-border-muted';
                } else if (st === 'judging') {
                    meta = 'Judging'; metaColorClass = 'text-text-muted';
                    tileClasses = 'bg-surface-2 border border-border';
                } else {
                    meta = r.winnerName ? `Winner: ${r.winnerName}` : 'Closed'; metaColorClass = 'text-text-muted';
                    tileClasses = 'bg-surface-2 border border-border';
                }
                return `
                <a href="${Router.buildHash('challenge', r.slug || `round-${r.round}`)}" class="card-hover flex flex-col gap-1.5 p-3.5 rounded-2xl no-underline min-h-[112px] box-border ${tileClasses}">
                    <span class="font-inter font-semibold text-[11px] tracking-[1.2px] uppercase text-text-muted shell-sentence-case" style="text-transform:uppercase">${r.month} · Round ${r.round}</span>
                    <span class="font-poppins font-semibold text-[15px] leading-[1.3] text-text-strong">${r.title}</span>
                    <span class="font-inter font-medium text-xs ${metaColorClass} shell-sentence-case">${meta}</span>
                </a>`;
            }).join('');
            const financeTile = `
                <a href="${Router.buildHash('challenge')}" class="card-hover flex flex-col gap-1.5 p-3.5 rounded-2xl no-underline min-h-[112px] box-border bg-[#0E1F36] border border-dashed border-border-muted">
                    <span class="font-inter font-semibold text-[11px] tracking-[1.2px] uppercase text-text-muted shell-sentence-case" style="text-transform:uppercase">Dec · Finale</span>
                    <span class="font-poppins font-semibold text-[15px] leading-[1.3] text-text-strong">Year-end awards</span>
                    <span class="font-inter font-medium text-xs text-gold-text shell-sentence-case">Coming soon</span>
                </a>`;

            // --- Leaderboard top 5 ---
            const medalColors = ['var(--medal-gold)', 'var(--medal-silver)', 'var(--medal-bronze)'];
            const top5 = state.leaderboard.slice(0, 5);
            const leaderboardHtml = top5.map((l, i) => `
                <li class="flex items-center gap-3.5 px-3.5 py-3 rounded-[14px] bg-surface-2">
                    <span class="w-[30px] h-[30px] shrink-0 rounded-full flex items-center justify-center font-poppins font-bold text-[13px]" style="${i < 3 ? `background:${medalColors[i]};color:#050E1C` : 'background:var(--border);color:var(--text-2)'}">${l.rank}</span>
                    <span class="flex-1 min-w-0 font-inter font-semibold text-[15px] text-text-strong truncate">${l.name}</span>
                    <span class="font-poppins font-bold text-base text-text-strong">${l.cumulativeScore.toFixed(1)}</span>
                </li>`).join('');

            // --- Latest winner card ---
            const latestWinnerRound = allRounds.find(r => r.winnerName);

            return `
                <div class="space-y-7 animate-in fade-in">
                    <section class="hero-section relative overflow-hidden rounded-[28px] border border-border flex flex-wrap gap-10 items-center" style="background: radial-gradient(circle at 85% 20%, #0F4A85 0%, #003366 45%, #061A33 100%)">
                        <div aria-hidden="true" class="absolute inset-0 pointer-events-none overflow-hidden">${generateSnowflakes(24)}</div>
                        <div class="flex-[999_1_520px] min-w-0 flex flex-col gap-5 relative">
                            <div class="flex gap-2.5 flex-wrap">${statusBadge}${finaleBadge}</div>
                            <h1 class="hero-title m-0 font-poppins font-bold tracking-[-1.2px] text-text-strong shell-sentence-case">${round.month} AI Challenge: ${round.title}</h1>
                            <p class="m-0 max-w-[560px] font-inter text-lg leading-[1.6] text-text-2">${round.summary || ''}</p>
                            <div class="hero-cta-row flex gap-3 flex-wrap items-center">
                                <a href="${briefHref}" class="btn-coral inline-flex items-center justify-center h-12 px-6 rounded-full bg-coral-btn text-text-strong font-inter font-semibold text-[15px] shell-sentence-case no-underline">Read the brief</a>
                                ${submitCta}
                            </div>
                            ${resourcesHtml}
                            <div class="hero-countdown-row flex gap-2.5 items-stretch flex-wrap">${countdownBlock}</div>
                        </div>
                        <div class="flex-[1_1_300px] flex justify-center relative hero-mesca-col">
                            <div class="relative hero-mesca-circle">
                                <div class="absolute inset-0 rounded-full border-[6px] border-coral" style="box-shadow:0 0 40px rgba(230,83,60,0.35)"></div>
                                <div class="absolute inset-3 rounded-full overflow-hidden" style="background:#0B1F38">
                                    <img src="${HUB_AVATAR}" alt="Mesca, the AI Innovation Hub mascot" class="w-full h-full object-contain">
                                </div>
                                <svg aria-hidden="true" viewBox="0 0 300 300" class="absolute pointer-events-none" style="left:-14px;top:-14px;width:calc(100% + 28px);height:calc(100% + 28px)">
                                    <path d="M22 202 C10 192, 6 214, 18 222 C28 230, 34 210, 22 202 Z" fill="#2E7D32"></path>
                                    <path d="M12 214 C2 212, 4 230, 16 232 C26 234, 24 216, 12 214 Z" fill="#1B5E20"></path>
                                    <circle cx="23" cy="217" r="5" fill="#E6533C"></circle>
                                    <circle cx="30" cy="222" r="4" fill="#C62828"></circle>
                                    <path d="M278 202 C290 192, 294 214, 282 222 C272 230, 266 210, 278 202 Z" fill="#2E7D32"></path>
                                    <path d="M288 214 C298 212, 296 230, 284 232 C274 234, 276 216, 288 214 Z" fill="#1B5E20"></path>
                                    <circle cx="277" cy="217" r="5" fill="#E6533C"></circle>
                                    <circle cx="270" cy="222" r="4" fill="#C62828"></circle>
                                    <path d="M150 6 L152 13 L159 15 L152 17 L150 24 L148 17 L141 15 L148 13 Z" fill="#F2B544"></path>
                                </svg>
                                <div class="absolute left-1/2 -bottom-3.5 -translate-x-1/2 whitespace-nowrap px-4 py-2 rounded-[18px] bg-bg border border-border-strong font-poppins font-semibold text-[13px] text-text-strong">Mesca · Hub mascot</div>
                            </div>
                        </div>
                    </section>

                    <section aria-label="Hub at a glance" class="grid gap-4" style="grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))">${kpiHtml}</section>

                    <div class="flex flex-wrap gap-6 items-stretch">
                        <section class="flex-[999_1_560px] min-w-0 p-7 rounded-[24px] bg-surface border border-border flex flex-col gap-5">
                            <div class="flex justify-between items-baseline gap-3 flex-wrap">
                                <h2 class="m-0 font-poppins font-semibold text-[22px] text-text-strong shell-sentence-case">Our ${round.year} challenge journey</h2>
                                <a href="${Router.buildHash('challenge')}" class="link-text font-inter font-semibold text-sm shell-sentence-case">Browse all challenges</a>
                            </div>
                            <div class="grid gap-3" style="grid-template-columns:repeat(auto-fill,minmax(min(150px,100%),1fr))">${journeyTiles}${financeTile}</div>
                        </section>

                        <section class="flex-[1_1_320px] p-7 rounded-[24px] bg-surface border border-border flex flex-col gap-4">
                            <div class="flex justify-between items-baseline gap-3">
                                <h2 class="m-0 font-poppins font-semibold text-[22px] text-text-strong shell-sentence-case">Leaderboard</h2>
                                <a href="${Router.buildHash('leaderboard')}" class="link-text font-inter font-semibold text-sm shell-sentence-case">Full table</a>
                            </div>
                            <ol class="list-none m-0 p-0 flex flex-col gap-2.5">${leaderboardHtml}</ol>
                            <span class="font-inter text-[13px] leading-[1.5] text-text-muted">Positions count for the year-end rewards only when all assigned Alison courses are complete.</span>
                        </section>
                    </div>

                    <div class="grid gap-6" style="grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))">
                        <section class="p-7 rounded-[24px] bg-surface border border-border flex gap-4.5 items-center">
                            <div aria-hidden="true" class="w-16 h-16 shrink-0 rounded-full flex items-center justify-center" style="background:rgba(242,181,68,0.14);border:1px solid rgba(242,181,68,0.45)">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F2B544" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"></circle><path d="M8.2 13.3 7 22l5-3 5 3-1.2-8.7"></path></svg>
                            </div>
                            <div class="flex flex-col gap-1 min-w-0">
                                <span class="font-inter font-semibold text-xs tracking-[1.2px] uppercase text-gold-text shell-sentence-case" style="text-transform:uppercase">${latestWinnerRound ? `Round ${latestWinnerRound.round} winner` : 'Winners'}</span>
                                ${latestWinnerRound ? `
                                    <span class="font-poppins font-semibold text-[22px] text-text-strong">${latestWinnerRound.winnerName}</span>
                                    <span class="font-inter text-sm text-text-muted">${latestWinnerRound.title} · ${latestWinnerRound.month} ${latestWinnerRound.year}</span>
                                ` : `<span class="font-inter text-sm text-text-muted">No winners yet</span>`}
                                <a href="${Router.buildHash('winners')}" class="link-text font-inter font-semibold text-sm mt-1 shell-sentence-case">Hall of Fame</a>
                            </div>
                        </section>
                        <section class="p-7 rounded-[24px] bg-surface flex flex-col gap-2.5" style="border:1px solid rgba(242,181,68,0.45)">
                            <span class="font-inter font-semibold text-xs tracking-[1.2px] uppercase text-gold-text shell-sentence-case" style="text-transform:uppercase">Alison LMS</span>
                            <span class="font-poppins font-semibold text-[19px] leading-[1.35] text-text-strong shell-sentence-case">Finish your assigned Alison courses</span>
                            <span class="font-inter text-sm leading-[1.5] text-text-muted">Incomplete courses mean your ${round.year} leaderboard position will not count.</span>
                            <a href="https://alison.com" target="_blank" rel="noopener noreferrer" class="link-text font-inter font-semibold text-sm shell-sentence-case">Go to Alison</a>
                        </section>
                        <section class="p-7 rounded-[24px] bg-surface border border-border flex flex-col gap-2.5">
                            <span class="font-inter font-semibold text-xs tracking-[1.2px] uppercase text-link shell-sentence-case" style="text-transform:uppercase">Idea Hub</span>
                            <span class="font-poppins font-semibold text-[19px] leading-[1.35] text-text-strong shell-sentence-case">Got an idea that could save time or add value?</span>
                            <span class="font-inter text-sm leading-[1.5] text-text-muted">Share it, read others' ideas, and help shape the next challenge.</span>
                            <a href="${Router.buildHash('ideahub')}" class="link-text font-inter font-semibold text-sm shell-sentence-case">Share an idea</a>
                        </section>
                    </div>
                </div>
            `;
        }

        function liveEntryCount(round) {
            return state.submissions.filter(s => {
                if (s.hiddenReason === 'test') return false;
                const effRound = (s.round === undefined || s.round === null) ? 1 : s.round;
                return effRound === round.round;
            }).length;
        }

        function renderChallenge() {
            const allRounds = Challenges.allRounds(); // newest first already
            if (!allRounds.length) {
                return `<div class="text-center py-24 font-inter text-text-muted">Loading challenge data…</div>`;
            }
            const current = Challenges.currentRound();
            const selectedSlug = state.routeSub || (current ? (current.slug || `round-${current.round}`) : allRounds[0].slug);
            const selected = allRounds.find(r => (r.slug || `round-${r.round}`) === selectedSlug) || current || allRounds[0];

            const monthListHtml = allRounds.map(r => {
                const slug = r.slug || `round-${r.round}`;
                const on = slug === (selected.slug || `round-${selected.round}`);
                const st = Challenges.statusOf(r);
                const isLive = st === 'open' || st === 'upcoming';
                const dotStyle = isLive
                    ? 'background:var(--green);box-shadow:0 0 0 4px rgba(63,166,107,0.22)'
                    : 'background:var(--border-muted)';
                const rowClasses = on ? 'bg-surface-active border-[1.5px] border-[#00AEEF]' : 'bg-surface border border-border';
                return `
                <button type="button" onclick="navigate('challenge', '${slug}')" aria-pressed="${on}" class="card-hover flex items-center gap-3.5 w-full box-border px-4 py-3.5 rounded-2xl text-left cursor-pointer ${rowClasses}">
                    <span class="w-2.5 h-2.5 shrink-0 rounded-full" style="${dotStyle}"></span>
                    <span class="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span class="font-poppins font-semibold text-[15px] text-text-strong shell-sentence-case">${r.month} challenge</span>
                        <span class="font-inter text-[13px] text-text-muted">Round ${r.round} · ${r.title}</span>
                    </span>
                </button>`;
            }).join('');

            // Compact chip grid shown instead of the row list below 1024px (Step 9 fix 1).
            const monthChipsHtml = allRounds.map(r => {
                const slug = r.slug || `round-${r.round}`;
                const on = slug === (selected.slug || `round-${selected.round}`);
                const st = Challenges.statusOf(r);
                const isLive = st === 'open' || st === 'upcoming';
                const chipClasses = on ? 'bg-surface-active border-[1.5px] border-[#00AEEF]' : 'bg-surface border border-border';
                return `
                <button type="button" onclick="navigate('challenge', '${slug}')" aria-pressed="${on}" class="card-hover flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-center ${chipClasses}">
                    ${isLive ? '<span class="w-1.5 h-1.5 shrink-0 rounded-full bg-green"></span>' : ''}
                    <span class="font-inter font-semibold text-[12px] text-text-strong whitespace-nowrap">${r.month.slice(0, 3)} · R${r.round}</span>
                </button>`;
            }).join('');

            const status = Challenges.statusOf(selected);
            const isOpen = status === 'open';
            const isUpcoming = status === 'upcoming';

            let statusLabel, statusClasses;
            if (isOpen) {
                statusLabel = 'Open for submissions';
                statusClasses = 'bg-[rgba(63,166,107,0.18)] text-green-text border border-[rgba(63,166,107,0.5)]';
            } else if (isUpcoming) {
                statusLabel = `Opens ${formatWATDateTime(selected.opensAt).weekday}`;
                statusClasses = 'bg-[rgba(242,181,68,0.14)] text-gold-text border border-[rgba(242,181,68,0.4)]';
            } else if (status === 'judging') {
                statusLabel = 'Judging';
                statusClasses = 'bg-[rgba(159,179,200,0.12)] text-text-2 border border-border-strong';
            } else {
                statusLabel = 'Closed';
                statusClasses = 'bg-[rgba(159,179,200,0.12)] text-text-2 border border-border-strong';
            }

            const bannerBg = (isOpen || isUpcoming)
                ? 'background:radial-gradient(circle at 90% 10%, #0F4A85 0%, #003366 55%, #0B1A2E 100%)'
                : 'background:linear-gradient(135deg, #10223A 0%, #0B1A2E 100%)';

            let cta, ctaHref, note, noteColorClass;
            if (isOpen) {
                cta = 'Submit your entry'; ctaHref = '#submit';
                note = `Closes ${formatWATDateTime(selected.closesAt).time} WAT, ${formatShortDateWAT(selected.closesAt)}`;
                noteColorClass = 'text-green-text';
            } else if (isUpcoming) {
                cta = formatOpenShort(selected.opensAt); ctaHref = null;
                note = `Opens ${formatWATDateTime(selected.opensAt).weekday} ${formatShortDateWAT(selected.opensAt)}, ${formatWATDateTime(selected.opensAt).time}`;
                noteColorClass = 'text-gold-text';
            } else {
                cta = 'See the winner'; ctaHref = Router.buildHash('winners');
                note = 'Submissions closed. This round is read-only.';
                noteColorClass = 'text-text-muted';
            }
            const ctaHtml = ctaHref
                ? `<a href="${ctaHref}" class="btn-coral inline-flex items-center h-11 px-5 rounded-full bg-coral-btn text-text-strong font-inter font-semibold text-sm shell-sentence-case no-underline">${cta}</a>`
                : `<span class="inline-flex items-center h-11 px-5 rounded-full border border-border-strong text-text-faint font-inter font-semibold text-sm shell-sentence-case cursor-not-allowed opacity-70">${cta}</span>`;
            const viewEntriesHtml = isUpcoming ? '' : `<a href="${Router.buildHash('gallery', selected.slug || `round-${selected.round}`)}" class="btn-outline inline-flex items-center h-11 px-5 rounded-full border-[1.5px] border-border-muted text-text-strong font-inter font-semibold text-sm shell-sentence-case no-underline">View entries</a>`;

            const entriesDisplay = isUpcoming ? `Opens ${formatShortDateWAT(selected.opensAt)}` : String(selected.entryCount != null ? selected.entryCount : liveEntryCount(selected));
            const archiveNameHtml = selected.archiveName
                ? `<div class="font-inter text-xs text-text-faint italic">Previously: ${selected.archiveName}</div>` : '';

            const fieldsChips = (selected.requirements || []).map(r =>
                `<span class="px-3 py-1.5 rounded-xl bg-surface-2 border border-border font-inter font-medium text-[13px] text-text-2">${r.label}</span>`
            ).join('');
            const criteriaChips = (selected.criteria && selected.criteria.length) ? `
                <div class="flex flex-col gap-2">
                    <h3 class="m-0 font-poppins font-semibold text-[17px] text-text-strong shell-sentence-case">Scoring criteria</h3>
                    <div class="flex gap-2 flex-wrap">
                        ${selected.criteria.map(c => `<span class="px-3 py-1.5 rounded-xl bg-surface-2 border border-border font-inter font-medium text-[13px] text-text-2">${c}</span>`).join('')}
                    </div>
                </div>` : '';

            return `
                <div class="space-y-7 animate-in fade-in rich-challenge-root">
                    <div class="print-only rich-print-logo" style="display:none;height:36px">${Shell.LOGO_SVG_COLOR.replace(/class="[^"]*"/, 'style="height:36px;display:block"')}</div>
                    <div class="no-print flex flex-col gap-2">
                        <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-gold-text shell-sentence-case" style="text-transform:uppercase">Challenge archive · ${selected.year || new Date().getFullYear()}</span>
                        <h1 class="m-0 font-poppins font-bold text-4xl leading-[1.1] tracking-[-0.8px] text-text-strong shell-sentence-case">Every challenge</h1>
                        <p class="m-0 max-w-[640px] font-inter text-base leading-[1.6] text-text-muted">Pick a month to see the brief, the winner and the entries. Past rounds are read-only; only the open round accepts submissions.</p>
                    </div>

                    <div class="challenge-layout flex flex-wrap gap-6 items-start">
                        <div class="no-print month-chips-mobile grid gap-2" style="grid-template-columns:repeat(3,1fr)">${monthChipsHtml}</div>
                        <nav aria-label="Challenge months" class="no-print month-list-desktop flex-col gap-2">${monthListHtml}</nav>

                        <div class="flex-[999_1_560px] min-w-0">
                        ${selected.page ? renderRichChallengeContent(selected, {
                            note, noteColorClass, statusLabel,
                            statusClasses: statusClasses.replace('shell-sentence-case', ''),
                            statusDot: isOpen ? '<span class="w-2 h-2 rounded-full bg-green"></span>' : '',
                            entriesDisplay, isUpcoming
                        }) : `
                        <section aria-live="polite" class="flex-[999_1_560px] min-w-0 rounded-[24px] bg-surface border border-border overflow-hidden">
                            <div class="p-8 flex flex-col gap-3.5" style="${bannerBg}">
                                <div class="flex gap-2.5 flex-wrap">
                                    <span class="inline-flex items-center h-7 px-3 rounded-full font-inter font-semibold text-xs shell-sentence-case ${statusClasses}">${statusLabel}</span>
                                    <span class="inline-flex items-center h-7 px-3 rounded-full bg-[rgba(5,14,28,0.5)] text-text-2 font-inter font-semibold text-xs shell-sentence-case">Round ${selected.round} · ${selected.month} ${selected.year}</span>
                                </div>
                                <h2 class="m-0 font-poppins font-bold text-[32px] leading-[1.15] text-text-strong shell-sentence-case">${selected.title}</h2>
                                ${archiveNameHtml}
                            </div>
                            <div class="px-8 pb-8 pt-7 flex flex-col gap-6">
                                <div class="grid gap-3" style="grid-template-columns:repeat(auto-fit,minmax(min(160px,100%),1fr))">
                                    <div class="px-4 py-3.5 rounded-2xl bg-surface-2"><div class="font-inter font-medium text-xs text-text-muted shell-sentence-case">Winner</div><div class="font-inter font-semibold text-[15px] text-text-strong mt-1">${selected.winnerName || 'To be announced'}</div></div>
                                    <div class="px-4 py-3.5 rounded-2xl bg-surface-2"><div class="font-inter font-medium text-xs text-text-muted shell-sentence-case">Entries</div><div class="font-inter font-semibold text-[15px] text-text-strong mt-1">${entriesDisplay}</div></div>
                                    <div class="px-4 py-3.5 rounded-2xl bg-surface-2"><div class="font-inter font-medium text-xs text-text-muted shell-sentence-case">Window</div><div class="font-inter font-semibold text-[15px] text-text-strong mt-1">${formatWindow(selected)}</div></div>
                                </div>
                                <div class="flex flex-col gap-2">
                                    <h3 class="m-0 font-poppins font-semibold text-[17px] text-text-strong shell-sentence-case">The brief</h3>
                                    ${renderBriefHtml(selected)}
                                </div>
                                <div class="flex flex-col gap-2">
                                    <h3 class="m-0 font-poppins font-semibold text-[17px] text-text-strong shell-sentence-case">What entrants submitted</h3>
                                    <div class="flex gap-2 flex-wrap">${fieldsChips}</div>
                                </div>
                                ${criteriaChips}
                                <div class="flex gap-3 flex-wrap items-center pt-4" style="border-top:1px solid var(--border)">
                                    ${ctaHtml}
                                    ${viewEntriesHtml}
                                    <span class="font-inter font-medium text-[13px] shell-sentence-case ${noteColorClass}">${note}</span>
                                </div>
                            </div>
                        </section>`}
                        </div>
                    </div>
                </div>
            `;
        }

        // --- Rich challenge page (Step 8/9) - only rendered when the round has a `page`
        // object (currently just Round 9). Mirrors redesign/mockups/Challenges.dc.html's
        // November view section-for-section. note/noteColorClass/entriesDisplay are
        // passed in from renderChallenge() so the status-line text is identical to the
        // simple panel's. The submit button itself is always clickable here (Step 9 fix
        // 2) - it no longer reuses the simple panel's disabled-while-upcoming ctaHtml.
        function renderRichChallengeContent(round, ctx) {
            const page = round.page;
            const status = Challenges.statusOf(round);
            const isOpen = status === 'open';
            const isUpcoming = ctx.isUpcoming;

            const submitBtn = `<a href="#submit" class="btn-coral inline-flex items-center h-12 px-6 rounded-full bg-coral-btn text-text-strong font-inter font-semibold text-[15px] no-underline">Submit your entry</a>`;
            const upcomingNoteHtml = isUpcoming
                ? `<span class="no-print font-inter font-semibold text-[13px]" style="color:var(--gold-text)">Opens ${formatWATDateTime(round.opensAt).weekday} ${formatShortDateWAT(round.opensAt)}, ${formatWATDateTime(round.opensAt).time}</span>`
                : '';
            const sampleBtn = `<a href="${page.sampleUrl}" target="_blank" rel="noopener" class="btn-outline inline-flex items-center gap-2 h-11 px-5 rounded-full border-[1.5px] border-border-muted text-text-strong font-inter font-semibold text-sm no-underline">See a sample ↗</a>`;
            const packBtn = `<a href="${page.designPack.url}" target="_blank" rel="noopener" class="btn-outline inline-flex items-center gap-2 h-11 px-5 rounded-full border-[1.5px] border-border-muted text-text-strong font-inter font-semibold text-sm no-underline">Design pack ↗</a>`;
            const pdfBtn = `<button type="button" onclick="triggerChallengePdf('${round.month}', '${round.title.replace(/'/g, "\\'")}')" class="btn-outline no-print inline-flex items-center gap-2 h-11 px-5 rounded-full border-[1.5px] border-border-muted bg-transparent text-text-strong font-inter font-semibold text-sm cursor-pointer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>Download as PDF</button>`;

            const topCard = `
            <section class="rich-sec rounded-[24px] bg-surface border border-border overflow-hidden">
                <div class="relative overflow-hidden p-8 flex flex-wrap gap-6 items-center" style="background:radial-gradient(circle at 90% 10%, #0F4A85 0%, #003366 55%, #0B1A2E 100%)">
                    <div class="flex-[999_1_380px] min-w-0 flex flex-col gap-3.5">
                        <div class="flex gap-2.5 flex-wrap">
                            <span class="inline-flex items-center gap-2 h-7 px-3 rounded-full font-inter font-semibold text-xs ${ctx.statusClasses}">${ctx.statusDot || ''}${ctx.statusLabel}</span>
                            <span class="inline-flex items-center h-7 px-3 rounded-full bg-[rgba(5,14,28,0.5)] text-text-2 font-inter font-semibold text-xs">Round ${round.round} · ${round.month} ${round.year}</span>
                        </div>
                        <h2 class="m-0 font-poppins font-bold text-[34px] leading-[1.12] text-text-strong">${round.month} AI Challenge: ${round.title}</h2>
                        <p class="m-0 font-inter text-base leading-[1.6] text-text-2 max-w-[620px]">${page.intro}</p>
                    </div>
                    <div class="flex-[1_1_150px] flex justify-center">
                        <div class="relative" style="width:150px;height:150px">
                            <div class="mesca-ring absolute inset-0 rounded-full border-[4px] border-coral" style="box-shadow:0 0 30px rgba(230,83,60,0.35)"></div>
                            <div class="absolute rounded-full overflow-hidden" style="inset:8px;background:#0B1F38">
                                <img src="${HUB_AVATAR}" alt="Mesca, the AI Innovation Hub mascot" class="w-full h-full object-contain">
                            </div>
                            <svg aria-hidden="true" viewBox="0 0 24 24" class="absolute pointer-events-none" style="left:50%;top:-10px;width:18px;height:18px;transform:translateX(-50%)"><path d="M12 2 L14 9 L21 12 L14 15 L12 22 L10 15 L3 12 L10 9 Z" fill="#F2B544"></path></svg>
                        </div>
                    </div>
                </div>
                <div class="p-6 grid gap-3" style="grid-template-columns:repeat(auto-fit,minmax(min(160px,100%),1fr))">
                    <div class="px-4 py-3.5 rounded-2xl bg-surface-2"><div class="font-inter font-medium text-xs text-text-muted">Winner</div><div class="font-inter font-semibold text-[15px] text-text-strong mt-1">${round.winnerName || 'To be announced'}</div></div>
                    <div class="px-4 py-3.5 rounded-2xl bg-surface-2"><div class="font-inter font-medium text-xs text-text-muted">Entries</div><div class="font-inter font-semibold text-[15px] text-text-strong mt-1">${ctx.entriesDisplay}</div></div>
                    <div class="px-4 py-3.5 rounded-2xl bg-surface-2"><div class="font-inter font-medium text-xs text-text-muted">Window</div><div class="font-inter font-semibold text-[15px] text-text-strong mt-1">${formatWindow(round)}</div></div>
                </div>
                <div class="px-6 pb-6 flex gap-3 flex-wrap items-center">
                    ${submitBtn}
                    ${upcomingNoteHtml}
                    ${sampleBtn}
                    ${packBtn}
                    ${pdfBtn}
                    <span class="font-inter font-medium text-[13px] ${ctx.noteColorClass} no-print">${ctx.note}</span>
                </div>
            </section>`;

            // Step 9 fix 3: these are plain buttons, not hash-changing anchors - the
            // router treats any unrecognized hash (#why etc.) as "go to Dashboard", so a
            // real <a href="#why"> would hijack navigation. scrollToChallengeSection()
            // scrolls in place instead; see its definition below.
            const jumpLinks = [
                ['why', 'Why this challenge'], ['brief', 'The brief'], ['call', 'Your call'],
                ['pack', 'Design pack'], ['yours', 'Make it yours'], ['rules', 'Rules'],
                ['how', 'How to submit'], ['scoring', 'Scoring']
            ];
            const jumpNav = `
            <nav aria-label="On this page" class="no-print jump-nav sticky top-0 z-[2] p-2.5 rounded-2xl flex gap-2 overflow-x-auto" style="background:rgba(8,21,39,0.92);border:1px solid var(--border);backdrop-filter:blur(6px)">
                ${jumpLinks.map(([id, label]) => `<button type="button" onclick="scrollToChallengeSection('${id}')" class="jump-link px-3.5 py-2 rounded-full border border-border-strong bg-transparent font-inter font-semibold text-[13px] text-text-2 whitespace-nowrap cursor-pointer">${label}</button>`).join('')}
            </nav>`;

            // 01 Why this challenge
            const whyPointIcons = [
                '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle>',
                '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"></path>',
                '<path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"></path><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"></path>'
            ];
            const whySection = `
            <section id="why" class="rich-sec sec p-8 rounded-[24px] bg-surface border border-border flex flex-col gap-4.5">
                <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-gold-text" style="text-transform:uppercase">01</span>
                <h3 class="rich-h2 m-0 font-poppins font-semibold text-2xl text-text-strong flex items-center gap-3">Why this challenge</h3>
                <p class="m-0 font-inter text-[17px] leading-[1.65] text-text-strong max-w-[720px]">${page.why.lead}</p>
                <div class="grid gap-3.5" style="grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))">
                    ${page.why.points.map((pt, i) => `
                    <div class="accent-border p-5 rounded-[18px] bg-surface-2 flex flex-col gap-2.5" style="border-top:3px solid ${pt.accent}">
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${pt.accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${whyPointIcons[i % 3]}</svg>
                        <span class="font-poppins font-semibold text-base text-text-strong">${pt.title}</span>
                        <span class="font-inter text-sm leading-[1.65] text-text-2">${pt.text}</span>
                    </div>`).join('')}
                </div>
            </section>`;

            // 02 The brief
            const briefSection = `
            <section id="brief" class="rich-sec sec p-8 rounded-[24px] bg-surface border border-border flex flex-col gap-4.5">
                <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-gold-text" style="text-transform:uppercase">02</span>
                <h3 class="rich-h2 m-0 font-poppins font-semibold text-2xl text-text-strong flex items-center gap-3">The brief</h3>
                <div class="accent-border px-5.5 py-4.5 rounded-2xl" style="background:linear-gradient(135deg, #003366, #0B2A4D);border-left:4px solid var(--coral)">
                    <p class="m-0 font-inter font-medium text-[17px] leading-[1.6] text-text-strong">${page.brief.statement}</p>
                </div>
                <span class="font-poppins font-semibold text-[17px] text-text-strong mt-1">Your card must include</span>
                <div class="grid gap-3" style="grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))">
                    ${page.brief.mustHaves.map((mh, i) => `
                    <div class="musthave-tile flex gap-3.5 p-4 rounded-2xl bg-surface-2 border border-border">
                        <span class="num-badge w-8 h-8 shrink-0 rounded-full bg-coral text-text-strong flex items-center justify-center font-poppins font-bold text-sm">${i + 1}</span>
                        <span class="font-inter text-[14.5px] leading-[1.65] text-text-2"><strong class="text-text-strong">${mh.lead}</strong> ${mh.text}</span>
                    </div>`).join('')}
                </div>
            </section>`;

            // 03 Your call
            const callSection = `
            <section id="call" class="rich-sec sec p-8 rounded-[24px] bg-surface border border-border flex flex-col gap-4.5">
                <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-gold-text" style="text-transform:uppercase">03</span>
                <h3 class="rich-h2 m-0 font-poppins font-semibold text-2xl text-text-strong flex items-center gap-3">Your call</h3>
                <div class="grid gap-3" style="grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))">
                    ${page.yourCall.map(c => `
                    <div class="yourcall-tile p-4.5 rounded-2xl bg-surface-2 flex flex-col gap-2">
                        <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-link" style="text-transform:uppercase">${c.label}</span>
                        <span class="font-inter text-[14.5px] leading-[1.65] text-text-2">${c.text}</span>
                    </div>`).join('')}
                </div>
                <div class="flex flex-wrap gap-4 items-center justify-between p-4.5 rounded-2xl border-[1.5px] border-dashed border-border-muted">
                    <span class="font-inter text-[15px] text-text-2">Not sure where to start? Open a finished example card.</span>
                    ${sampleBtn}
                </div>
            </section>`;

            // 04 Design pack
            const assetTile = (a) => {
                if (a.kind === 'mesca') {
                    return `
                    <div class="asset-tile p-4.5 rounded-2xl bg-surface-2 border flex gap-4 items-center" style="border-color:rgba(230,83,60,0.5)">
                        <img src="${a.imageUrl}" alt="Official Mesca image" class="w-16 h-16 rounded-[14px] object-cover shrink-0" style="background:#0B1F38">
                        <div class="flex flex-col gap-1">
                            <span class="font-poppins font-semibold text-[15px] text-text-strong">${a.label} ${a.compulsory ? '<span class="font-inter font-semibold text-[11px] uppercase tracking-[1px]" style="color:#F08A78">compulsory</span>' : ''}</span>
                            <span class="font-inter text-sm text-text-2">${a.text} <a href="${a.linkUrl}" target="_blank" rel="noopener" class="link-text font-inter font-semibold">${a.linkLabel}</a></span>
                        </div>
                    </div>`;
                }
                if (a.kind === 'logo-light' || a.kind === 'logo-dark') {
                    const isDark = a.kind === 'logo-dark';
                    const logo = isDark ? Shell.LOGO_SVG_WHITE : Shell.LOGO_SVG_COLOR;
                    return `
                    <div class="asset-tile p-4.5 rounded-2xl bg-surface-2 flex gap-4 items-center">
                        <div class="logo-tile-swatch w-[110px] h-16 shrink-0 rounded-xl flex items-center justify-center" style="background:${isDark ? '#003366' : '#F5F7FA'}">
                            <span style="width:88px;height:22px;display:inline-block;overflow:hidden">${logo.replace(/class="[^"]*"/, 'style="width:88px;height:22px;display:block"')}</span>
                        </div>
                        <div class="flex flex-col gap-1"><span class="font-poppins font-semibold text-[15px] text-text-strong">${a.label}</span><span class="font-inter text-sm text-text-2">${a.text}</span></div>
                    </div>`;
                }
                if (a.kind === 'brand-swatches' || a.kind === 'seasonal-swatches') {
                    const round_ = a.kind === 'seasonal-swatches';
                    return `
                    <div class="asset-tile p-4.5 rounded-2xl bg-surface-2 flex flex-col gap-3">
                        <span class="font-poppins font-semibold text-[15px] text-text-strong">${a.label}</span>
                        <div class="flex gap-2.5 flex-wrap">
                            ${a.swatches.map(s => round_
                                ? `<span title="${s.name}" class="swatch-chip w-6.5 h-6.5 rounded-full" style="width:26px;height:26px;background:${s.hex};${s.hex === '#FFFFFF' ? 'border:1px solid var(--border-muted)' : ''}"></span>`
                                : `<span class="flex items-center gap-2 font-inter font-medium text-[13px] text-text-2"><span class="swatch-chip" style="width:26px;height:26px;border-radius:8px;background:${s.hex};border:1px solid var(--border-muted)"></span>${s.name} ${s.hex}</span>`
                            ).join('')}
                        </div>
                        ${a.text ? `<span class="font-inter text-sm text-text-2">${a.text}</span>` : ''}
                    </div>`;
                }
                if (a.kind === 'fonts') {
                    return `
                    <div class="asset-tile p-4.5 rounded-2xl bg-surface-2 flex flex-col gap-2">
                        <span class="font-poppins font-semibold text-[15px] text-text-strong">${a.label}</span>
                        <span class="font-poppins font-bold text-[22px] text-text-strong">Aa Poppins <span class="font-inter text-base text-text-2">· Aa Inter</span></span>
                        <span class="font-inter text-sm text-text-2">${a.text}</span>
                    </div>`;
                }
                if (a.kind === 'tagline') {
                    return `
                    <div class="asset-tile p-4.5 rounded-2xl bg-surface-2 flex flex-col gap-2">
                        <span class="font-poppins font-semibold text-[15px] text-text-strong">${a.label}</span>
                        <span class="font-poppins italic font-semibold text-lg leading-[1.4]" style="color:#F08A78">"${a.text}"</span>
                    </div>`;
                }
                return `
                <div class="asset-tile p-4.5 rounded-2xl bg-surface-2 flex flex-col gap-2">
                    <span class="font-poppins font-semibold text-[15px] text-text-strong">${a.label}</span>
                    <span class="font-inter text-sm text-text-2">${a.text}</span>
                </div>`;
            };
            const packSection = `
            <section id="pack" class="rich-sec sec p-8 rounded-[24px] bg-surface border border-border flex flex-col gap-4.5">
                <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-gold-text" style="text-transform:uppercase">04</span>
                <div class="flex justify-between items-center gap-4 flex-wrap">
                    <div class="flex flex-col gap-1.5">
                        <h3 class="rich-h2 m-0 font-poppins font-semibold text-2xl text-text-strong flex items-center gap-3">Design pack</h3>
                        <span class="font-inter text-[15px] leading-[1.65] text-text-2">Use these official assets. Download them from the design pack folder.</span>
                    </div>
                    ${packBtn}
                </div>
                <div class="grid gap-3" style="grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))">
                    ${page.designPack.assets.map(assetTile).join('')}
                </div>
            </section>`;

            // 05 Make it yours
            const ideaDotColors = ['#E6533C', '#00AEEF', '#F2B544', '#3FA66B', '#B54FB8', '#3CC1D9', '#F2667A'];
            const yoursSection = `
            <section id="yours" class="rich-sec sec p-8 rounded-[24px] bg-surface border border-border flex flex-col gap-4.5">
                <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-gold-text" style="text-transform:uppercase">05</span>
                <h3 class="rich-h2 m-0 font-poppins font-semibold text-2xl text-text-strong flex items-center gap-3">Make it yours</h3>
                <p class="m-0 font-inter text-[15px] leading-[1.65] text-text-2">${page.makeItYours.intro}</p>
                <div class="grid gap-3" style="grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))">
                    ${page.makeItYours.ideas.map((idea, i) => `
                    <div class="idea-tile px-4.5 py-4 rounded-2xl flex flex-col gap-1.5" style="background:linear-gradient(160deg, var(--surface-2), var(--surface));border:1px solid var(--border)">
                        <span class="flex items-center gap-2 font-poppins font-semibold text-[15px] text-text-strong"><span class="accent-dot w-2 h-2 rounded-full" style="background:${ideaDotColors[i % ideaDotColors.length]}"></span>${idea.title}</span>
                        <span class="font-inter text-sm leading-[1.65] text-text-2">${idea.text}</span>
                    </div>`).join('')}
                </div>
                <div class="flex gap-3.5 items-center p-4.5 rounded-2xl" style="background:rgba(242,181,68,0.1);border:1px solid rgba(242,181,68,0.45)">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--gold-text)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l2 2"></path><path d="M9 2h6"></path></svg>
                    <span class="font-inter font-semibold text-[15px] text-text-strong">${page.makeItYours.note}</span>
                </div>
            </section>`;

            // 06 Rules
            const rulesSection = `
            <section id="rules" class="rich-sec sec p-8 rounded-[24px] bg-surface border border-border flex flex-col gap-4.5">
                <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-gold-text" style="text-transform:uppercase">06</span>
                <h3 class="rich-h2 m-0 font-poppins font-semibold text-2xl text-text-strong flex items-center gap-3">Rules</h3>
                <div class="grid gap-2.5" style="grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))">
                    ${page.rules.map(r => `
                    <div class="rule-row flex gap-3 p-3.5 rounded-[14px] bg-surface-2">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green-text)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0 mt-0.5"><path d="M20 6 9 17l-5-5"></path></svg>
                        <span class="font-inter text-[14.5px] leading-[1.65] text-text-2"><strong class="text-text-strong">${r.lead}</strong> ${r.text}</span>
                    </div>`).join('')}
                </div>
            </section>`;

            // 07 How to submit
            const checklistState = state.richChecklist || {};
            const checkedCount = page.checklist.filter((_, i) => checklistState[i]).length;
            const doneText = checkedCount === page.checklist.length ? 'All set — ready to submit' : `${checkedCount} of ${page.checklist.length} checked`;
            const doneColorStyle = checkedCount === page.checklist.length ? 'color:var(--green-text)' : 'color:var(--text-muted)';
            const stepsHtml = page.howToSubmit.steps.map((step, i) => {
                const isLast = i === page.howToSubmit.steps.length - 1;
                const linkHtml = step.linkHref ? `<a href="${step.linkHref}" class="link-text font-inter font-semibold text-sm">${step.linkLabel}</a>` : '';
                const prefixHtml = step.showPrefixCheck ? `
                    <div class="grid gap-2.5 mt-2.5" style="grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))">
                        <div class="p-3.5 rounded-[14px] flex flex-col gap-1.5" style="background:rgba(63,166,107,0.1);border:1px solid rgba(63,166,107,0.5)">
                            <span class="font-inter font-semibold text-[12px] uppercase tracking-[1px]" style="color:var(--green-text);text-transform:uppercase">✓ It must start with</span>
                            ${page.howToSubmit.validPrefixes.map(p => `<code class="font-mono text-[13px] text-text-strong" style="word-break:break-all">${p}</code>`).join('')}
                        </div>
                        <div class="p-3.5 rounded-[14px] flex flex-col gap-1.5" style="background:rgba(242,102,122,0.1);border:1px solid rgba(242,102,122,0.5)">
                            <span class="font-inter font-semibold text-[12px] uppercase tracking-[1px]" style="color:#F7A1AE;text-transform:uppercase">✕ Not this</span>
                            <code class="font-mono text-[13px] text-text-strong" style="word-break:break-all">${page.howToSubmit.invalidPrefix}</code>
                            <span class="font-inter text-[13px] leading-[1.5] text-text-2">${page.howToSubmit.invalidNote}</span>
                        </div>
                    </div>` : '';
                return `
                <li class="step-item flex gap-4">
                    <div class="flex flex-col items-center">
                        <span class="num-badge w-[34px] h-[34px] shrink-0 rounded-full flex items-center justify-center font-poppins font-bold text-sm" style="background:var(--brand-blue);color:#050E1C">${i + 1}</span>
                        ${!isLast ? `<span class="flex-1 my-1" style="width:2px;background:var(--border)"></span>` : ''}
                    </div>
                    <div class="${isLast ? '' : 'pb-5'} flex flex-col gap-2 min-w-0">
                        <span class="font-inter font-medium text-text-strong">${step.text}</span>
                        ${linkHtml}
                        ${prefixHtml}
                    </div>
                </li>`;
            }).join('');
            const checklistHtml = page.checklist.map((label, i) => {
                const on = !!checklistState[i];
                return `
                <button type="button" onclick="toggleRichChecklistItem(${i})" aria-pressed="${on}" class="chk flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-surface text-left cursor-pointer w-full">
                    <span class="w-[22px] h-[22px] shrink-0 rounded-md flex items-center justify-center font-inter font-bold text-sm" style="${on ? 'background:var(--green);color:#050E1C;border:1.5px solid var(--green)' : 'background:transparent;color:transparent;border:1.5px solid var(--border-muted)'}">${on ? '✓' : ''}</span>
                    <span class="font-inter text-[14.5px] leading-[1.5]" style="color:${on ? 'var(--green-text)' : 'var(--text-2)'}">${label}</span>
                </button>`;
            }).join('');
            const howSection = `
            <section id="how" class="rich-sec sec p-8 rounded-[24px] bg-surface border border-border flex flex-col gap-5">
                <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-gold-text" style="text-transform:uppercase">07</span>
                <h3 class="rich-h2 m-0 font-poppins font-semibold text-2xl text-text-strong flex items-center gap-3">How to submit</h3>
                <ol class="list-none m-0 p-0 flex flex-col gap-0">${stepsHtml}</ol>
                <div class="p-5.5 rounded-2xl bg-surface-2 flex flex-col gap-3">
                    <div class="flex justify-between items-baseline gap-3 flex-wrap">
                        <span class="font-poppins font-semibold text-[17px] text-text-strong">Before you submit, check:</span>
                        <span class="no-print font-inter font-semibold text-[13px]" style="${doneColorStyle}">${doneText}</span>
                        <span class="print-only font-inter font-semibold text-[13px]"></span>
                    </div>
                    <div class="no-print flex flex-col gap-2">${checklistHtml}</div>
                    <div class="print-only" style="display:none">
                        ${page.checklist.map(label => `<div class="print-check-row">☐ ${label}</div>`).join('')}
                    </div>
                </div>
                <div class="flex gap-3 items-start p-3.5 rounded-[14px]" style="background:rgba(242,181,68,0.1);border:1px solid rgba(242,181,68,0.45)">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold-text)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4"></path><path d="M12 16h.01"></path></svg>
                    <span class="font-inter text-sm leading-[1.5]" style="color:#F6E2B8">${page.afterDeadlineNote}</span>
                </div>
            </section>`;

            // 08 Scoring
            const scoringColors = ['#E6533C', '#F2B544', '#00AEEF', '#B54FB8', '#3FA66B'];
            const scoringSection = `
            <section id="scoring" class="rich-sec sec p-8 rounded-[24px] bg-surface border border-border flex flex-col gap-4.5">
                <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-gold-text" style="text-transform:uppercase">08</span>
                <div class="flex justify-between items-center gap-4 flex-wrap">
                    <h3 class="rich-h2 m-0 font-poppins font-semibold text-2xl text-text-strong flex items-center gap-3">Scoring criteria</h3>
                    <span class="px-4 py-2 rounded-full font-poppins font-bold text-[15px]" style="background:rgba(242,181,68,0.16);border:1px solid rgba(242,181,68,0.45);color:var(--gold-text)">${page.scoring.total} points</span>
                </div>
                <p class="m-0 font-inter text-[15px] leading-[1.65] text-text-2">${page.scoring.intro}</p>
                <div class="p-3.5 rounded-[14px] font-inter text-sm leading-[1.6] text-text-2" style="background:rgba(0,174,239,0.08);border:1px solid rgba(0,174,239,0.4)"><strong class="text-link">An entry is valid when</strong> ${page.scoring.validity}</div>
                <div class="flex flex-col gap-2.5">
                    ${page.scoring.criteria.map((c, i) => {
                        const col = scoringColors[i % scoringColors.length];
                        return `
                        <div class="scoring-row accent-border flex flex-wrap gap-3.5 items-center p-4 rounded-2xl bg-surface-2" style="border-left:4px solid ${col}">
                            <div class="flex-[1_1_200px] flex flex-col gap-2">
                                <span class="font-poppins font-semibold text-base text-text-strong">${c.name}</span>
                                <span class="flex gap-1 items-center">
                                    ${Array.from({ length: c.points }).map(() => `<span class="swatch-chip w-5.5 rounded" style="width:22px;height:6px;background:${col}"></span>`).join('')}
                                    <span class="font-poppins font-bold text-[13px] text-text-strong ml-1.5">${c.points} pts</span>
                                </span>
                            </div>
                            <span class="flex-[2_1_320px] font-inter text-sm leading-[1.65] text-text-2"><span class="text-text-muted font-semibold">What earns full marks: </span>${c.full}</span>
                        </div>`;
                    }).join('')}
                </div>
            </section>`;

            // Closing CTA
            const closingSection = `
            <section class="rich-sec relative overflow-hidden p-8 rounded-[24px] border border-border flex flex-wrap gap-5 items-center justify-between" style="background:radial-gradient(circle at 85% 20%, #0F4A85 0%, #003366 50%, #061A33 100%)">
                <div class="flex flex-col gap-1.5">
                    <span class="font-poppins font-bold text-2xl text-text-strong">Ready to send some season's greetings?</span>
                    <span class="no-print font-inter font-medium text-sm text-text-2">Closes ${formatWATDateTime(round.closesAt).time} WAT, ${formatWATDateTime(round.closesAt).weekday} ${formatShortDateWAT(round.closesAt)}.</span>
                    <span class="print-only" style="display:none">Submit at ai.innovation-hub.com.ng before ${formatWATDateTime(round.closesAt).time} WAT, ${formatWATDateTime(round.closesAt).weekday} ${formatShortDateWAT(round.closesAt)}.</span>
                </div>
                <div class="no-print flex gap-3 flex-wrap">
                    ${submitBtn}
                    ${packBtn}
                    ${pdfBtn}
                </div>
            </section>`;

            const printLinksBlock = `
            <div class="print-only" style="display:none">
                <p>See a sample: ${page.sampleUrl}</p>
                <p>Design pack: ${page.designPack.url}</p>
            </div>`;

            return `
            <div class="flex flex-col gap-5">
                ${topCard}
                ${printLinksBlock}
                ${jumpNav}
                ${whySection}
                ${briefSection}
                ${callSection}
                ${packSection}
                ${yoursSection}
                ${rulesSection}
                ${howSection}
                ${scoringSection}
                ${closingSection}
                <div class="print-footer">Descasio AI Innovation Hub · ai.innovation-hub.com.ng · Empowering Your Digital Future</div>
            </div>`;
        }

        // Step 9 fix 3: scrolls to a rich-challenge-page section without ever touching
        // location.hash, so the router never mistakes it for a real route.
        function scrollToChallengeSection(id) {
            const el = document.getElementById(id);
            if (!el) return;
            let reduceMotion = false;
            try { reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
            el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        }

        function toggleRichChecklistItem(i) {
            const next = Object.assign({}, state.richChecklist || {});
            next[i] = !next[i];
            state.richChecklist = next;
            updateUI();
        }

        function triggerChallengePdf(month, title) {
            const prevTitle = document.title;
            document.title = `Descasio ${month} AI Challenge – ${title}`;
            const restore = () => {
                document.title = prevTitle;
                window.removeEventListener('afterprint', restore);
            };
            window.addEventListener('afterprint', restore);
            window.print();
        }
        function renderTabContent() {
            if (state.activeTab === 'dashboard') {
                return renderDashboard();
            }

            if (state.activeTab === 'ideahub') {
                return renderIdeaHub();
            }
            if (state.activeTab === 'challenge') {
                return renderChallenge();
            }

            if (state.activeTab === 'gallery') {
                return renderGallery();
            }
            if (state.activeTab === 'winners') {
                return renderWinners();
            }
            if (state.activeTab === 'leaderboard') {
                return renderLeaderboard();
            }
            if (state.activeTab === 'admin') {
                if (!state.isAdmin) {
                    return `
                        <div class="text-center py-24">
                            <h2 class="text-2xl font-black text-white italic uppercase tracking-tighter mb-4">Not an admin</h2>
                            <p class="text-slate-500 text-sm">This area is restricted. Use the Admin button to sign in with an admin Google account.</p>
                        </div>`;
                }
                return `
                    <div class="space-y-6">
                        <div class="flex justify-between items-end border-b border-slate-800 pb-10"><div><h2 class="text-4xl font-black text-white italic uppercase tracking-tighter leading-none">Admin Control</h2></div><button onclick="logoutAdmin()" class="bg-red-600/10 text-red-500 text-[10px] font-black uppercase px-6 py-3 rounded-xl border border-red-500/20 hover:bg-red-600 hover:text-white transition-all">Sign Out</button></div>
                        <div class="overflow-hidden rounded-[2.5rem] border border-slate-800 bg-slate-900 shadow-2xl">
                            <table class="w-full text-left text-xs">
                                <thead class="bg-slate-950 text-slate-500 uppercase font-black border-b border-slate-800"><tr><th class="p-6">Origin / Team</th><th class="p-6">Submission Detail</th><th class="p-6">Round</th><th class="p-6">Preview</th><th class="p-6 text-center">Shortlist</th><th class="p-6 text-center">Delete</th></tr></thead>
                                <tbody class="divide-y divide-slate-800">
                                    ${state.submissions.map(sub => `
                                        <tr class="hover:bg-white/5 transition">
                                            <td class="p-6"><b class="text-white uppercase tracking-tight">${sub.type === 'group' ? sub.teamName : sub.name}</b><br><span class="opacity-50 italic text-[10px] uppercase tracking-widest font-black text-blue-400">${sub.type === 'group' ? 'Group' : (sub.dept || 'Indiv')}</span></td>
                                            <td class="p-6 font-black uppercase text-blue-100 italic">${sub.round === 7 ? 'Descasio Security Trainer' : (sub.round === 6 ? 'Rogue AI Recovery Plan' : (sub.round === 5 ? 'The Optimizer 2 App' : (sub.round === 4 ? 'The Optimizer App' : (sub.round === 3 ? (sub.canvasLink ? 'Shared Link' : 'Website') : (sub.innovationName || 'Entry')))))}</td>
                                            <td class="p-6 font-black text-blue-500">R${sub.round || 1}</td>
                                            <td class="p-6">${sub.docLink ? `<img src="${sub.docLink}" class="w-10 h-10 rounded-lg object-cover">` : sub.round >= 4 ? (sub.solutionLink ? `<a href="${sub.solutionLink}" target="_blank" class="text-blue-500 underline text-[10px]">View Link</a>` : '-') : (sub.canvasLink ? `<a href="${sub.canvasLink}" target="_blank" class="text-blue-500 underline text-[10px]">View Link</a>` : '-')}</td>
                                            <td class="p-6 text-center"><button onclick="toggleShortlist('${sub.id}', ${sub.shortlisted})" class="p-4 rounded-2xl ${sub.shortlisted ? 'bg-yellow-500 text-black' : 'bg-slate-800 text-slate-500'} hover:scale-110 transition-all"><i data-lucide="star" class="w-6 h-6 ${sub.shortlisted ? 'fill-black' : ''}"></i></button></td>
                                            <td class="p-6 text-center"><button onclick="deleteSubmission('${sub.id}')" class="p-4 rounded-2xl bg-slate-800 text-red-500 hover:bg-red-600 hover:text-white hover:scale-110 transition-all"><i data-lucide="trash-2" class="w-6 h-6"></i></button></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            }
        }

        function tidyName(raw) {
            if (!raw) return '';
            return raw
                .replace(/\b([a-z])/g, (m) => m.toUpperCase())
                .replace(/\b([A-Z])([A-Z]{3,})\b/g, (m, a, b) => a + b.toLowerCase());
        }

        function initialsOf(name) {
            return (name || '')
                .replace(/\[.*?\]/g, '')
                .replace(/[^A-Za-z\s-]/g, '')
                .trim()
                .split(/[\s-]+/)
                .filter(Boolean)
                .map(w => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase();
        }

        function deptColorsFor(item) {
            const key = item.type === 'group' ? 'Team' : (DEPT_COLORS[item.dept] ? item.dept : 'Unknown');
            return DEPT_COLORS[key];
        }

        function getSubmissionDisplayName(item) {
            const raw = item.type === 'group' ? item.teamName : item.name;
            return tidyName(raw || 'Anonymous');
        }

        // Fallback order: existing title field -> "<Challenge title> entry".
        // ("Avatar name" for Round 1 is the same innovationName field, not a separate one.)
        function getSubmissionTitle(item, roundTitle) {
            return item.innovationName || `${roundTitle || 'Challenge'} entry`;
        }

        // Every link field present on the item: the viewing round's own url-type
        // requirements first (real labels), then a legacy fallback for any of the four
        // historical link field names not already covered. Fixes the old bug where
        // submissionDocLink never rendered for Round 8 (no isR8 branch existed).
        function collectLinkFields(item) {
            const round = Challenges.getRound(item.round === undefined || item.round === null ? 1 : item.round);
            const seen = new Set();
            const out = [];
            if (round && round.requirements) {
                for (const req of round.requirements) {
                    if (req.type === 'url' && item[req.id]) {
                        out.push({ label: req.label, url: item[req.id] });
                        seen.add(req.id);
                    }
                }
            }
            const legacy = [
                { id: 'docLink', label: 'Image / Doc Link' },
                { id: 'submissionDocLink', label: 'Submission Document Link' },
                { id: 'canvasLink', label: 'Canvas / Shared Link' },
                { id: 'solutionLink', label: 'Solution Link' }
            ];
            for (const f of legacy) {
                if (!seen.has(f.id) && item[f.id]) out.push({ label: f.label, url: item[f.id] });
            }
            return out;
        }

        // Every non-link text/textarea/multiselect answer, labelled from the round's own
        // requirements first, then legacy free-text fields from earlier rounds that
        // predate the requirements model.
        function collectTextFields(item) {
            const round = Challenges.getRound(item.round === undefined || item.round === null ? 1 : item.round);
            const out = [];
            const covered = new Set();
            if (round && round.requirements) {
                for (const req of round.requirements) {
                    if (req.type === 'url') continue;
                    covered.add(req.id);
                    const val = item[req.id];
                    if (req.type === 'multiselect') {
                        if (val && val.length) out.push({ label: req.label, value: Array.isArray(val) ? val.join(', ') : val });
                    } else if (val) {
                        out.push({ label: req.label, value: val });
                    }
                }
            }
            const legacyText = [
                { id: 'achievements', label: 'Description' },
                { id: 'bugsIdentified', label: 'Bugs Identified' },
                { id: 'productRecommendations', label: 'Product Recommendations' },
                { id: 'problemDefinition', label: 'Problem Definition' },
                { id: 'operationalimpact', label: 'Operational Impact' },
                { id: 'rootCauseAnalysis', label: 'Root Cause Analysis' },
                { id: 'recoveryEmail', label: 'Client Recovery Email' },
                { id: 'guardrailRules', label: 'Guardrail System Rules' },
                { id: 'toolsUsed', label: 'Tools Used' }
            ];
            for (const f of legacyText) {
                if (!covered.has(f.id) && item[f.id]) {
                    const val = Array.isArray(item[f.id]) ? item[f.id].join(', ') : item[f.id];
                    out.push({ label: f.label, value: val });
                }
            }
            return out;
        }

        function renderRequirementField(req, disabled) {
            const value = state.formData[req.id] || '';
            if (req.type === 'multiselect') {
                const options = req.options || [];
                const chips = options.map(opt => {
                    const on = state.formToolsSelected.includes(opt);
                    const safeOpt = opt.replace(/'/g, "\\'");
                    return `<button type="button" ${disabled ? 'disabled' : ''} onclick="toggleToolChip('${safeOpt}')" class="h-[38px] px-3.5 rounded-full font-inter font-semibold text-[13px] cursor-pointer border ${on ? 'border-[#00AEEF]' : 'border-border-strong bg-transparent text-text-2'}" style="${on ? 'background:rgba(0,174,239,0.16);color:var(--link)' : ''}">${on ? '✓ ' : ''}${opt}</button>`;
                }).join('');
                return `
                <div class="space-y-2">
                    <span class="lbl">${req.label} <span class="font-normal text-text-muted">(pick all that apply)</span></span>
                    <div class="flex gap-2 flex-wrap">${chips}</div>
                </div>`;
            }
            if (req.type === 'textarea') {
                return `
                <div class="space-y-2">
                    <label class="lbl">${req.label}</label>
                    <textarea ${disabled ? 'disabled' : ''} ${req.required ? 'required' : ''} rows="4" oninput="handleFormInput('formData','${req.id}',this.value)" class="fld" style="height:auto;padding-top:12px;padding-bottom:12px" placeholder="${req.placeholder || ''}">${value}</textarea>
                </div>`;
            }
            const inputType = req.type === 'url' ? 'url' : 'text';
            return `
            <div class="space-y-2">
                <label class="lbl">${req.label}</label>
                <input ${disabled ? 'disabled' : ''} ${req.required ? 'required' : ''} type="${inputType}" oninput="handleFormInput('formData','${req.id}',this.value)" value="${value}" class="fld" placeholder="${req.placeholder || ''}">
            </div>`;
        }

        function toggleToolChip(label) {
            const idx = state.formToolsSelected.indexOf(label);
            if (idx > -1) state.formToolsSelected.splice(idx, 1);
            else state.formToolsSelected.push(label);
            updateUI();
        }

        function resetSubmissionForm() {
            state.submissionSent = false;
            state.formData = {};
            state.formToolsSelected = [];
            updateUI();
        }

        function renderSubmissionFormSection(round) {
            const status = Challenges.statusOf(round);
            const reqLabels = (round.requirements || []).map(r => r.label);
            const needText = reqLabels.length
                ? `This month you only need ${reqLabels.length === 1 ? 'one thing' : reqLabels.length + ' things'}: ${reqLabels.join(' and ')}.`
                : '';
            const checklistHtml = (round.checklist || []).map(c => `<span class="font-inter text-sm leading-[1.5] text-text-2">✓ ${c}</span>`).join('');
            const opensInfo = round.opensAt ? formatWATDateTime(round.opensAt) : null;
            const closesInfo = round.closesAt ? formatWATDateTime(round.closesAt) : null;

            let statusBadge;
            if (status === 'open') {
                statusBadge = `<span class="self-start inline-flex items-center gap-2 h-7 px-3 rounded-full bg-[rgba(63,166,107,0.18)] border border-[rgba(63,166,107,0.5)] text-green-text font-inter font-semibold text-xs shell-sentence-case"><span class="w-2 h-2 rounded-full bg-green"></span>Round ${round.round} · Open</span>`;
            } else if (status === 'upcoming') {
                statusBadge = `<span class="self-start inline-flex items-center h-7 px-3 rounded-full bg-[rgba(242,181,68,0.14)] border border-[rgba(242,181,68,0.4)] text-gold-text font-inter font-semibold text-xs shell-sentence-case">Round ${round.round} · Opens ${opensInfo ? opensInfo.weekday : 'soon'}</span>`;
            } else {
                statusBadge = `<span class="self-start inline-flex items-center h-7 px-3 rounded-full bg-[rgba(159,179,200,0.12)] border border-border-strong text-text-2 font-inter font-semibold text-xs shell-sentence-case">Round ${round.round} · ${status === 'judging' ? 'Judging' : 'Closed'}</span>`;
            }

            const infoCard = `
            <div class="flex-[1_1_320px] p-8 rounded-[24px] border border-border flex flex-col gap-4" style="background:radial-gradient(circle at 90% 10%, #0F4A85 0%, #003366 55%, #0B1A2E 100%)">
                ${statusBadge}
                <h1 class="m-0 font-poppins font-bold text-[32px] leading-[1.15] text-text-strong shell-sentence-case">Submit your ${round.title}</h1>
                ${needText ? `<p class="m-0 font-inter text-[15px] leading-[1.6] text-text-2">${needText}</p>` : ''}
                ${checklistHtml ? `
                <div class="flex flex-col gap-2.5 p-4 rounded-2xl" style="background:rgba(5,14,28,0.45)">
                    <span class="font-inter font-semibold text-xs tracking-[1.2px] uppercase text-gold-text shell-sentence-case" style="text-transform:uppercase">Before you submit</span>
                    ${checklistHtml}
                </div>` : ''}
                <div class="mt-auto flex gap-4 flex-wrap items-center">
                    ${closesInfo ? `<span class="font-inter font-semibold text-sm text-text-strong shell-sentence-case">Closes ${closesInfo.time} WAT, ${closesInfo.day} ${closesInfo.month}</span>` : ''}
                    <a href="${Router.buildHash('challenge', round.slug || `round-${round.round}`)}" class="link-text font-inter font-semibold text-sm shell-sentence-case">Read the full brief</a>
                </div>
            </div>`;

            let formCard;
            if (state.submissionSent) {
                formCard = `
                <div class="flex-[999_1_560px] min-w-0 p-8 rounded-[24px] bg-surface border border-border flex items-center justify-center" style="min-height:420px">
                    <div class="flex flex-col items-center gap-3 text-center">
                        <div class="w-16 h-16 rounded-full flex items-center justify-center" style="background:rgba(63,166,107,0.18);border:1px solid rgba(63,166,107,0.5)">
                            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#8FE0B0" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>
                        </div>
                        <span class="font-poppins font-semibold text-2xl text-text-strong">Entry received</span>
                        <span class="font-inter text-[15px] leading-[1.6] text-text-muted" style="max-width:380px">Thanks for taking part. Round ${round.round} entries go live in the feed after the deadline.</span>
                        <button type="button" onclick="resetSubmissionForm()" class="btn-outline mt-2 rounded-full border-[1.5px] border-border-muted bg-transparent text-text-strong font-inter font-semibold text-sm cursor-pointer" style="height:42px;padding:0 20px">Back to the form</button>
                    </div>
                </div>`;
            } else if (status === 'judging' || status === 'closed') {
                formCard = `
                <div class="flex-[999_1_560px] min-w-0 p-8 rounded-[24px] bg-surface border border-border flex items-center justify-center text-center" style="min-height:420px">
                    <span class="font-poppins font-semibold text-xl text-text-strong">Round ${round.round} is closed — see the entries below.</span>
                </div>`;
            } else {
                const disabled = status === 'upcoming';
                const upcomingNotice = disabled && opensInfo
                    ? `<div class="p-4 rounded-2xl font-inter text-sm shell-sentence-case" style="background:rgba(242,181,68,0.12);border:1px solid rgba(242,181,68,0.4);color:var(--gold-text)">The form unlocks ${opensInfo.weekday} ${formatShortDateWAT(round.opensAt)} at ${opensInfo.time}.</div>`
                    : '';
                const memberBlock = (n, label) => `
                    <div class="grid gap-4 p-5 rounded-2xl bg-bg border border-border" style="grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))">
                        <div class="font-inter font-semibold text-xs text-link uppercase shell-sentence-case" style="grid-column:1/-1;text-transform:uppercase">${label}</div>
                        <div class="space-y-2"><label class="lbl">Name</label><input ${disabled ? 'disabled' : ''} required oninput="handleFormInput('formData','member${n}Name',this.value)" value="${state.formData['member' + n + 'Name'] || ''}" class="fld"></div>
                        <div class="space-y-2"><label class="lbl">Email</label><input ${disabled ? 'disabled' : ''} required type="email" oninput="handleFormInput('formData','member${n}Email',this.value)" value="${state.formData['member' + n + 'Email'] || ''}" class="fld" placeholder="name@descasio.io"></div>
                        <div class="space-y-2"><label class="lbl">Department</label><select ${disabled ? 'disabled' : ''} required onchange="handleFormInput('formData','member${n}Dept',this.value)" class="fld"><option value="">Select department</option>${DEPARTMENTS.map(d => `<option value="${d}" ${state.formData['member' + n + 'Dept'] === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
                    </div>`;
                const groupFieldsHtml = state.submissionType === 'group' ? `
                    <div class="space-y-2">
                        <label class="lbl">Team name</label>
                        <input ${disabled ? 'disabled' : ''} required oninput="handleFormInput('formData','teamName',this.value)" value="${state.formData.teamName || ''}" class="fld" placeholder="e.g. Team DataFlow TS">
                    </div>
                    ${memberBlock(1, 'Member 1 (team lead)')}
                    ${memberBlock(2, 'Member 2')}` : '';
                const individualFieldsHtml = state.submissionType !== 'group' ? `
                    <div class="grid gap-4" style="grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))">
                        <div class="space-y-2">
                            <label class="lbl">Full name</label>
                            <input ${disabled ? 'disabled' : ''} required oninput="handleFormInput('formData','name',this.value)" value="${state.formData.name || ''}" class="fld" placeholder="Your full name">
                        </div>
                        <div class="space-y-2">
                            <label class="lbl">Work email</label>
                            <input ${disabled ? 'disabled' : ''} required type="email" oninput="handleFormInput('formData','email',this.value)" value="${state.formData.email || ''}" class="fld" placeholder="name@descasio.io">
                        </div>
                        <div class="space-y-2">
                            <label class="lbl">Department</label>
                            <select ${disabled ? 'disabled' : ''} required onchange="handleFormInput('formData','dept',this.value)" class="fld">
                                <option value="">Select department</option>
                                ${DEPARTMENTS.map(d => `<option value="${d}" ${state.formData.dept === d ? 'selected' : ''}>${d}</option>`).join('')}
                            </select>
                        </div>
                    </div>` : '';

                formCard = `
                <div class="flex-[999_1_560px] min-w-0 p-8 rounded-[24px] bg-surface border border-border">
                    <form id="submission-form" onsubmit="handleFormSubmit(event)" class="space-y-5">
                        ${upcomingNotice}
                        <div class="space-y-2">
                            <span class="lbl">Entry type</span>
                            <div role="group" aria-label="Entry type" class="inline-flex self-start p-1 rounded-[14px] bg-bg border border-border-strong">
                                <button type="button" ${disabled ? 'disabled' : ''} aria-pressed="${state.submissionType === 'individual'}" onclick="setSubmissionType('individual')" class="h-10 px-5 rounded-[10px] border-0 font-inter font-semibold text-sm cursor-pointer ${state.submissionType === 'individual' ? 'bg-text text-bg' : 'bg-transparent text-text-2'}">Individual</button>
                                <button type="button" ${disabled ? 'disabled' : ''} aria-pressed="${state.submissionType === 'group'}" onclick="setSubmissionType('group')" class="h-10 px-5 rounded-[10px] border-0 font-inter font-semibold text-sm cursor-pointer ${state.submissionType === 'group' ? 'bg-text text-bg' : 'bg-transparent text-text-2'}">Group</button>
                            </div>
                        </div>
                        ${individualFieldsHtml}
                        ${groupFieldsHtml}
                        <div class="flex items-center gap-3 pt-1">
                            <span class="font-inter font-semibold text-xs tracking-[1.2px] uppercase text-link shell-sentence-case whitespace-nowrap" style="text-transform:uppercase">Round ${round.round} requirements</span>
                            <span class="flex-1 h-px bg-border"></span>
                        </div>
                        ${(round.requirements || []).map(req => renderRequirementField(req, disabled)).join('')}
                        <div id="formStatus" class="hidden rounded-xl px-4 py-3 text-red-300 text-xs font-semibold" style="background:rgba(230,83,60,0.12);border:1px solid rgba(230,83,60,0.4)"></div>
                        ${state.showSubmitConfirm ? renderSubmitConfirmPanel() : `
                        <button type="submit" ${disabled || state.submitting ? 'disabled' : ''} class="w-full rounded-full border-0 font-inter font-semibold text-[15px] cursor-pointer mt-1 ${disabled ? 'bg-border-strong text-text-faint cursor-not-allowed' : 'btn-coral bg-coral-btn text-text-strong'}" style="height:52px">
                            ${disabled ? formatOpenShort(round.opensAt) : (state.submitting ? 'Submitting…' : 'Submit entry')}
                        </button>`}
                    </form>
                </div>`;
            }

            return `<section id="submit-section" class="flex flex-wrap gap-6 items-stretch">${infoCard}${formCard}</section>`;
        }

        function renderArchiveFeed(current) {
            const allRounds = Challenges.allRounds(); // newest first
            const currentKey = current.slug || `round-${current.round}`;
            const filter = state.routeSub;
            const selectedKey = filter || currentKey;

            const others = allRounds.filter(r => r.round !== current.round).sort((a, b) => b.round - a.round);
            const chipDefs = [current, ...others].map(r => ({ key: r.slug || `round-${r.round}`, label: `Round ${r.round} · ${(r.month || '').slice(0, 3)}` }));
            chipDefs.push({ key: 'all', label: 'All rounds' });

            const chipsHtml = chipDefs.map(c => {
                const on = c.key === selectedKey;
                return `<button type="button" onclick="navigate('gallery','${c.key}')" aria-pressed="${on}" class="card-hover h-9 px-3.5 rounded-full font-inter font-semibold text-[13px] cursor-pointer ${on ? 'bg-text text-bg border border-text' : 'bg-transparent text-text-2 border border-border-strong'}">${c.label}</button>`;
            }).join('');

            let roundsToShow, headerTitle, headerMeta, isCurrentUpcomingView = false;
            if (selectedKey === 'all') {
                roundsToShow = allRounds.slice().sort((a, b) => b.round - a.round);
                headerTitle = `All rounds · March to ${current.month} ${current.year}`;
                headerMeta = 'Newest round first';
            } else {
                const r = allRounds.find(x => (x.slug || `round-${x.round}`) === selectedKey) || current;
                roundsToShow = [r];
                const st = Challenges.statusOf(r);
                if (r.round === current.round && (st === 'open' || st === 'upcoming')) isCurrentUpcomingView = true;
                headerTitle = `Round ${r.round} · ${r.title}`;
                headerMeta = r.winnerName
                    ? `Completed · ${r.month} ${r.year} · winner: ${r.winnerName}`
                    : (st === 'open' ? 'Open now · entries are revealed after the deadline'
                        : (st === 'upcoming' ? `Opens ${formatShortDateWAT(r.opensAt)}`
                            : `${st === 'judging' ? 'Judging' : 'Completed'} · ${r.month} ${r.year}`));
            }

            const cards = [];
            for (const r of roundsToShow) {
                const st = Challenges.statusOf(r);
                const hideBecauseOpenCurrent = (r.round === current.round) && (st === 'open' || st === 'upcoming') && !state.isAdmin;
                if (hideBecauseOpenCurrent) continue;
                const roundSubs = state.submissions.filter(s => {
                    const effRound = (s.round === undefined || s.round === null) ? 1 : s.round;
                    if (effRound !== r.round) return false;
                    if (s.hidden === true && !state.isAdmin) return false;
                    return true;
                });
                for (const s of roundSubs) cards.push({ item: s, round: r });
            }

            const totalKnown = selectedKey === 'all' ? null : (roundsToShow[0] && roundsToShow[0].entryCount);
            const countText = selectedKey === 'all'
                ? `${cards.length} entries`
                : (totalKnown != null && cards.length < totalKnown ? `${totalKnown} entries · ${cards.length} shown` : `${cards.length} entries`);

            const underWraps = isCurrentUpcomingView && selectedKey !== 'all';

            let bodyHtml;
            if (underWraps) {
                bodyHtml = `
                <div class="p-14 rounded-[24px] border border-dashed border-border-strong bg-surface text-center flex flex-col gap-2 items-center">
                    <span class="font-poppins font-semibold text-xl text-text-strong">Round ${current.round} entries are under wraps</span>
                    <span class="font-inter text-sm leading-[1.6] text-text-muted" style="max-width:460px">Entries for the open round appear here after the deadline, so nobody copies a design before judging.</span>
                </div>`;
            } else if (cards.length) {
                bodyHtml = `
                <div class="grid gap-5" style="grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr))">
                    ${cards.map(c => renderSubmissionCard(c.item, c.round)).join('')}
                </div>`;
            } else {
                bodyHtml = `
                <div class="p-14 rounded-[24px] border border-dashed border-border-strong bg-surface text-center flex flex-col gap-2 items-center">
                    <span class="font-poppins font-semibold text-xl text-text-strong">No entries yet</span>
                </div>`;
            }

            return `
            <section class="space-y-5">
                <div class="flex justify-between items-end gap-4 flex-wrap">
                    <div class="flex flex-col gap-1.5">
                        <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-gold-text shell-sentence-case" style="text-transform:uppercase">Submissions archive</span>
                        <h2 class="m-0 font-poppins font-bold text-[30px] leading-[1.15] text-text-strong shell-sentence-case">What the team built</h2>
                    </div>
                    <span class="font-inter font-medium text-[13px] text-text-muted">${countText}</span>
                </div>
                <div class="flex gap-2 flex-wrap" role="group" aria-label="Filter by round">${chipsHtml}</div>
                <div class="px-4.5 py-3.5 rounded-2xl bg-surface border border-border flex gap-3 flex-wrap items-baseline">
                    <span class="font-poppins font-semibold text-[15px] text-text-strong">${headerTitle}</span>
                    <span class="font-inter text-[13px] text-text-muted">${headerMeta}</span>
                </div>
                ${bodyHtml}
                <div class="px-5 py-4 rounded-2xl bg-surface border border-border font-inter text-[13px] leading-[1.6] text-text-muted">
                    <strong class="text-text">How the cover works:</strong> each card draws its own cover from the entry title, round and entrant initials, tinted by department, so no card is ever blank.
                </div>
            </section>`;
        }

        function renderGallery() {
            const round = Challenges.currentRound();
            if (!round) {
                return `<div class="text-center py-24 font-inter text-text-muted">Loading challenge data…</div>`;
            }
            return `
            <div class="space-y-8 animate-in fade-in">
                ${renderSubmissionFormSection(round)}
                ${renderArchiveFeed(round)}
            </div>`;
        }

        function renderIdeaCard(idea) {
            const expanded = state.expandedIdeaId === idea.id;
            const text = idea.description || '';
            return `
            <button type="button" onclick="toggleIdeaExpand('${idea.id}')" aria-expanded="${expanded}" class="card-hover text-left flex flex-col gap-3 p-6 rounded-[20px] border" style="min-height:260px;${expanded ? 'background:var(--surface-2);border-color:var(--brand-blue)' : 'background:var(--surface);border-color:var(--border)'}">
                <span class="flex items-center gap-2 font-inter font-semibold text-[11px] tracking-[1.2px] uppercase text-link" style="text-transform:uppercase"><i data-lucide="lightbulb" class="w-3.5 h-3.5"></i> Concept</span>
                <span class="font-poppins font-semibold text-[19px] leading-[1.3] text-text-strong">${idea.title}</span>
                <span class="font-inter italic text-sm leading-[1.6] text-text-muted" style="${expanded ? '' : 'display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden'}">${text}</span>
                <span class="mt-auto pt-3.5 border-t border-border flex justify-between items-center gap-2.5">
                    <span class="font-inter font-semibold text-xs text-text-muted truncate">By ${idea.name || 'Anonymous'}</span>
                    <span class="font-inter font-semibold text-sm text-link shrink-0">${expanded ? 'Show less' : 'Read more →'}</span>
                </span>
            </button>`;
        }

        function renderIdeaHub() {
            const ideaCount = state.ideas.length;
            const contributorCount = new Set(state.ideas.map(i => (i.email || i.name || '').toLowerCase().trim()).filter(Boolean)).size;

            const formCard = state.ideaSent ? `
                <div class="flex flex-col items-center justify-center gap-3 text-center" style="min-height:380px">
                    <span class="font-poppins font-semibold text-2xl text-text-strong">Thanks, your idea is in</span>
                    <span class="font-inter text-[15px] leading-[1.6] text-text-muted" style="max-width:380px">It now appears in the concept wall below for everyone to read.</span>
                    <button type="button" onclick="resetIdeaForm()" class="btn-outline mt-2 rounded-full border-[1.5px] border-border-muted bg-transparent text-text-strong font-inter font-semibold text-sm cursor-pointer" style="height:42px;padding:0 20px">Pitch another</button>
                </div>` : `
                <form onsubmit="handleIdeaSubmit(event)" class="space-y-4.5">
                    <h2 class="m-0 flex items-center gap-2.5 font-poppins font-semibold text-[22px] text-text-strong"><i data-lucide="lightbulb" class="text-gold w-[22px] h-[22px]"></i> Pitch a concept</h2>
                    <div class="grid gap-4" style="grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))">
                        <div class="space-y-2"><label class="lbl">Full name</label><input required oninput="handleFormInput('ideaData','name',this.value)" value="${state.ideaData.name || ''}" class="fld" placeholder="Your full name"></div>
                        <div class="space-y-2"><label class="lbl">Work email</label><input required type="email" oninput="handleFormInput('ideaData','email',this.value)" value="${state.ideaData.email || ''}" class="fld" placeholder="name@descasio.io"></div>
                        <div class="space-y-2"><label class="lbl">Department</label>
                            <select required onchange="handleFormInput('ideaData','dept',this.value)" class="fld">
                                <option value="">Select department</option>
                                ${DEPARTMENTS.map(d => `<option value="${d}" ${state.ideaData.dept === d ? 'selected' : ''}>${d}</option>`).join('')}
                            </select>
                        </div>
                        <div class="space-y-2"><label class="lbl">Idea title</label><input required oninput="handleFormInput('ideaData','title',this.value)" value="${state.ideaData.title || ''}" class="fld" placeholder="Give it a short name"></div>
                    </div>
                    <div class="space-y-2">
                        <label class="lbl">Description</label>
                        <textarea required oninput="handleFormInput('ideaData','description',this.value)" rows="5" class="fld" style="height:auto;padding-top:12px;padding-bottom:12px" placeholder="What problem does it solve, who is it for, and how could AI help?">${state.ideaData.description || ''}</textarea>
                    </div>
                    <div id="ideaStatus" class="hidden rounded-xl px-4 py-3 text-red-300 text-xs font-semibold" style="background:rgba(230,83,60,0.12);border:1px solid rgba(230,83,60,0.4)"></div>
                    <button type="submit" ${state.ideaSubmitting ? 'disabled' : ''} class="btn-coral w-full rounded-full border-0 font-inter font-semibold text-[15px] cursor-pointer bg-coral-btn text-text-strong" style="height:52px">${state.ideaSubmitting ? 'Sharing…' : 'Share concept'}</button>
                </form>`;

            return `
            <div class="max-w-6xl mx-auto space-y-10 animate-in fade-in">
                <div class="flex flex-col gap-2 items-center text-center">
                    <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-gold-text shell-sentence-case" style="text-transform:uppercase">Idea Hub</span>
                    <h1 class="m-0 font-poppins font-bold text-[40px] leading-[1.1] text-text-strong shell-sentence-case">Idea crowdsourcing</h1>
                    <p class="m-0 font-inter text-[17px] leading-[1.6] text-text-muted shell-sentence-case">What solutions should we build next?</p>
                </div>

                <div class="flex flex-wrap gap-6 items-stretch">
                    <section class="flex-[999_1_560px] min-w-0 p-8 rounded-[24px] bg-surface border border-border">${formCard}</section>
                    <aside class="flex-[1_1_280px] p-7 rounded-[24px] border border-border flex flex-col gap-4.5" style="background:linear-gradient(160deg, #003366 0%, var(--surface) 100%)">
                        <span class="font-inter font-semibold text-xs tracking-[1.2px] uppercase text-link shell-sentence-case" style="text-transform:uppercase">How ideas travel</span>
                        <div class="flex gap-3.5"><span class="w-[30px] h-[30px] shrink-0 rounded-full flex items-center justify-center font-poppins font-bold text-[13px] text-white" style="background:var(--coral)">1</span><div class="flex flex-col gap-0.5"><span class="font-poppins font-semibold text-[15px] text-text-strong">Pitch it</span><span class="font-inter text-[13px] leading-[1.5] text-text-2">Share a problem worth solving with AI.</span></div></div>
                        <div class="flex gap-3.5"><span class="w-[30px] h-[30px] shrink-0 rounded-full flex items-center justify-center font-poppins font-bold text-[13px] text-white" style="background:var(--coral)">2</span><div class="flex flex-col gap-0.5"><span class="font-poppins font-semibold text-[15px] text-text-strong">The Hub team reviews</span><span class="font-inter text-[13px] leading-[1.5] text-text-2">Strong concepts are shortlisted.</span></div></div>
                        <div class="flex gap-3.5"><span class="w-[30px] h-[30px] shrink-0 rounded-full flex items-center justify-center font-poppins font-bold text-[13px] text-white" style="background:var(--coral)">3</span><div class="flex flex-col gap-0.5"><span class="font-poppins font-semibold text-[15px] text-text-strong">It may become a challenge</span><span class="font-inter text-[13px] leading-[1.5] text-text-2">Your idea could be next month's round.</span></div></div>
                        <div class="mt-auto pt-4 border-t border-border-strong flex gap-5">
                            <div><div class="font-poppins font-bold text-[28px] text-text-strong">${ideaCount}</div><div class="font-inter font-medium text-xs text-text-muted">concepts shared</div></div>
                            <div><div class="font-poppins font-bold text-[28px] text-text-strong">${contributorCount}</div><div class="font-inter font-medium text-xs text-text-muted">contributors</div></div>
                        </div>
                    </aside>
                </div>

                <section class="space-y-4.5">
                    <div class="flex justify-between items-baseline gap-3 flex-wrap">
                        <h2 class="m-0 font-poppins font-semibold text-2xl text-text-strong">Concept wall</h2>
                        <span class="font-inter font-medium text-[13px] text-text-muted">Click a card to read the full pitch</span>
                    </div>
                    <div class="grid gap-5" style="grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))">
                        ${state.ideas.length ? state.ideas.map(idea => renderIdeaCard(idea)).join('') : `<div class="col-span-full p-14 rounded-[24px] border border-dashed border-border-strong bg-surface text-center font-poppins font-semibold text-text-strong">No ideas yet - be the first to pitch one.</div>`}
                    </div>
                </section>
            </div>`;
        }

        function winnerInfoForMonth(monthName) {
            const round = Challenges.allRounds().find(r => r.month === monthName);
            const record = MONTHLY_RECORDS.find(m => m.month === monthName);
            if (round && round.winnerName) {
                return {
                    month: monthName, round,
                    name: round.winnerName, label: round.winnerLabel, image: round.winnerImage,
                    challengeTitle: round.title, winningSubmissionId: round.winningSubmissionId
                };
            }
            return {
                month: monthName, round: round || null,
                name: record ? record.winner : null, label: record ? record.solution : null,
                image: record ? record.image : null,
                challengeTitle: round ? round.title : (record ? record.solution : ''),
                winningSubmissionId: round ? round.winningSubmissionId : null
            };
        }

        function renderWinners() {
            const monthOrder = MONTHLY_RECORDS.map(m => m.month);
            const infos = monthOrder.map(winnerInfoForMonth);
            const decided = infos.filter(i => i.name);
            const latest = decided[decided.length - 1] || null;

            const roundsTotal = Challenges.allRounds().length;
            const roundsDecided = decided.filter(i => i.round).length || decided.length;
            const nameCounts = {};
            decided.forEach(i => { nameCounts[i.name] = (nameCounts[i.name] || 0) + 1; });
            const repeatWinners = Object.keys(nameCounts).filter(n => nameCounts[n] >= 2);
            const differentWinners = Object.keys(nameCounts).length;

            const current = Challenges.currentRound();
            const currentStatus = current ? Challenges.statusOf(current) : null;
            const upNext = (current && (currentStatus === 'open' || currentStatus === 'upcoming' || currentStatus === 'judging')) ? current : null;

            const spotlightHtml = latest ? `
            <section class="relative overflow-hidden rounded-[28px] p-9 border flex flex-wrap gap-8 items-center" style="background:radial-gradient(circle at 85% 20%, rgba(242,181,68,0.22) 0%, #003366 45%, #061A33 100%);border-color:rgba(242,181,68,0.4)">
                <div class="w-[180px] h-[180px] shrink-0 rounded-3xl border-[3px] flex flex-col items-center justify-center gap-2 overflow-hidden" style="border-color:var(--gold);background:linear-gradient(160deg, var(--surface-2), var(--bg));box-shadow:0 0 40px rgba(242,181,68,0.25)">
                    ${latest.image
                        ? `<img src="${latest.image}" class="w-full h-full object-cover">`
                        : `<span class="font-inter font-bold text-[10px] tracking-[1px] uppercase text-gold-text text-center px-2">AI Innovator of the Month</span><span class="font-poppins font-bold text-[44px] text-text-strong">${initialsOf(latest.name)}</span>`}
                </div>
                <div class="flex-[1_1_360px] flex flex-col gap-2.5">
                    <span class="self-start px-3 py-1.5 rounded-[14px] font-inter font-semibold text-xs text-gold-text" style="background:rgba(242,181,68,0.16);border:1px solid rgba(242,181,68,0.45)">Latest winner · ${latest.month}${latest.round ? ' ' + latest.round.year : ''}</span>
                    <h2 class="m-0 font-poppins font-bold text-[36px] leading-[1.15] text-text-strong">${latest.name}</h2>
                    <p class="m-0 font-inter font-medium text-base text-link">${latest.round ? `Round ${latest.round.round} · ${latest.challengeTitle || ''}` : (latest.label || '')}</p>
                    <div class="flex gap-3 flex-wrap mt-2">
                        ${latest.winningSubmissionId ? `<button type="button" onclick="showDetails('${latest.winningSubmissionId}')" class="btn-coral inline-flex items-center h-11 px-5 rounded-full bg-coral-btn text-text-strong font-inter font-semibold text-sm border-0 cursor-pointer">See the winning entry</button>` : ''}
                        ${latest.round ? `<a href="${Router.buildHash('challenge', latest.round.slug || `round-${latest.round.round}`)}" class="btn-outline inline-flex items-center h-11 px-5 rounded-full border-[1.5px] font-inter font-semibold text-sm no-underline" style="border-color:#7FA9D6">View the challenge</a>` : ''}
                    </div>
                </div>
            </section>` : '';

            const highlightsHtml = `
            <section aria-label="Highlights" class="grid gap-4" style="grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))">
                <div class="p-5 rounded-[18px] bg-surface border border-border"><div class="font-inter font-medium text-[13px] text-text-muted">Rounds decided</div><div class="font-poppins font-bold text-[30px] text-text-strong mt-1">${roundsDecided} <span class="font-inter font-medium text-sm text-text-muted">of ${roundsTotal}</span></div></div>
                <div class="p-5 rounded-[18px] bg-surface border border-border"><div class="font-inter font-medium text-[13px] text-text-muted">Two-time winners</div><div class="font-poppins font-semibold text-base leading-[1.4] text-text-strong mt-1.5">${repeatWinners.length ? repeatWinners.join('<br>') : 'None yet'}</div></div>
                <div class="p-5 rounded-[18px] bg-surface border border-border"><div class="font-inter font-medium text-[13px] text-text-muted">Different winners</div><div class="font-poppins font-bold text-[30px] text-text-strong mt-1">${differentWinners}</div></div>
                <div class="p-5 rounded-[18px] bg-surface border" style="border-color:rgba(63,166,107,0.5)"><div class="font-inter font-medium text-[13px] text-text-muted">Up next</div>${upNext ? `<div class="font-poppins font-semibold text-base leading-[1.4] text-text-strong mt-1.5">Round ${upNext.round} · ${upNext.month}</div><a href="#submit" class="link-text font-inter font-semibold text-[13px]">Enter now</a>` : `<div class="font-poppins font-semibold text-base leading-[1.4] text-text-strong mt-1.5">All rounds complete</div>`}</div>
            </section>`;

            const gridHtml = infos.map(info => {
                const isCurrentRound = !!(info.round && current && info.round.round === current.round);
                const isCurrentOpen = isCurrentRound && currentStatus === 'open';

                if (info.name) {
                    return `
                    <article class="p-6 rounded-3xl flex flex-col gap-4.5 bg-surface border border-border">
                        <div class="flex justify-between items-center">
                            <span class="font-inter font-semibold text-xs tracking-[1.6px] uppercase text-text-muted" style="text-transform:uppercase">${info.month}</span>
                            <i data-lucide="medal" class="text-gold w-[22px] h-[22px]"></i>
                        </div>
                        <div class="flex flex-col items-center gap-3.5 text-center">
                            <div class="w-[104px] h-[104px] rounded-[18px] border-2 flex items-center justify-center overflow-hidden" style="border-color:var(--brand-blue);background:linear-gradient(160deg, var(--surface-2), var(--bg))">
                                ${info.image ? `<img src="${info.image}" class="w-full h-full object-cover">` : `<span class="font-poppins font-bold text-[28px] text-text-strong">${initialsOf(info.name)}</span>`}
                            </div>
                            <span class="font-poppins font-bold text-[21px] leading-[1.2] text-text-strong">${info.name}</span>
                            <span class="font-inter font-semibold text-[13px] text-link">${info.label || ''}</span>
                            <span class="font-inter text-[13px] text-text-muted">Challenge: ${info.challengeTitle || ''}</span>
                            ${info.round ? `<a href="${Router.buildHash('challenge', info.round.slug || `round-${info.round.round}`)}" class="link-text font-inter font-semibold text-[13px]">View challenge →</a>` : ''}
                        </div>
                    </article>`;
                }

                const roundStatus = info.round ? Challenges.statusOf(info.round) : null;
                let pendingLabel, pendingColor;
                if (isCurrentOpen) {
                    pendingLabel = `Round ${info.round.round} · In progress`; pendingColor = 'var(--green-text)';
                } else if (isCurrentRound && roundStatus === 'judging') {
                    pendingLabel = `Round ${info.round.round} · Judging`; pendingColor = 'var(--text-muted)';
                } else if (info.round && roundStatus === 'upcoming') {
                    pendingLabel = `Opens ${formatShortDateWAT(info.round.opensAt)}`; pendingColor = 'var(--text-muted)';
                } else {
                    pendingLabel = 'Upcoming'; pendingColor = 'var(--text-muted)';
                }
                const pendingNote = info.round ? info.round.title : 'Year-end finale';

                return `
                <article class="p-6 rounded-3xl flex flex-col gap-4.5 bg-surface border" style="border-color:${isCurrentOpen ? 'rgba(63,166,107,0.5)' : 'var(--border)'}">
                    <div class="flex justify-between items-center">
                        <span class="font-inter font-semibold text-xs tracking-[1.6px] uppercase text-text-muted" style="text-transform:uppercase">${info.month}</span>
                    </div>
                    <div class="flex flex-col items-center justify-center gap-2 text-center rounded-[18px] border-[1.5px] border-dashed border-border-strong" style="height:210px;padding:16px">
                        <span class="font-poppins font-semibold text-sm" style="color:${pendingColor}">${pendingLabel}</span>
                        <span class="font-inter text-[13px] text-text-muted">${pendingNote}</span>
                        ${isCurrentOpen ? `<a href="#submit" class="link-text font-inter font-semibold text-[13px]">Enter Round ${info.round.round} →</a>` : ''}
                    </div>
                </article>`;
            }).join('');

            return `
            <div class="max-w-6xl mx-auto space-y-10 animate-in fade-in">
                <div class="flex flex-col gap-2 items-center text-center">
                    <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-gold-text shell-sentence-case" style="text-transform:uppercase">Winners</span>
                    <h1 class="m-0 font-poppins font-bold text-[44px] leading-[1.1] text-text-strong shell-sentence-case">Hall of Fame</h1>
                    <p class="m-0 font-inter text-[17px] leading-[1.6] text-text-muted shell-sentence-case">Celebrating the AI transformation journey</p>
                </div>
                ${spotlightHtml}
                ${highlightsHtml}
                <div class="grid gap-5" style="grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))">${gridHtml}</div>
            </div>`;
        }

        function leaderboardBadgeHtml(rank) {
            const medalBg = { 1: 'var(--medal-gold)', 2: 'var(--medal-silver)', 3: 'var(--medal-bronze)' };
            const bg = medalBg[rank];
            return `<span class="inline-flex items-center justify-center rounded-full font-poppins font-bold text-[13px]" style="width:34px;height:34px;${bg ? `background:${bg};color:#050E1C` : 'background:var(--border-strong);color:var(--text-2)'}">${rank}</span>`;
        }

        function renderLeaderboardResults() {
            const current = Challenges.currentRound();
            const maxRound = current ? current.round : 9;
            const roundCols = Challenges.allRounds().filter(r => r.round <= maxRound).sort((a, b) => a.round - b.round);
            const roundColorVars = ['var(--r1)', 'var(--r2)', 'var(--r3)', 'var(--r4)', 'var(--r5)', 'var(--r6)', 'var(--r7)', 'var(--r8)', 'var(--r9)'];

            const rows = leaderboardFilteredRows();

            const podiumOrder = [rows[1], rows[0], rows[2]].filter(Boolean);
            const podiumHtml = podiumOrder.map(e => {
                const h = e.rank === 1 ? 210 : (e.rank === 2 ? 186 : 170);
                const medalBg = { 1: 'var(--medal-gold)', 2: 'var(--medal-silver)', 3: 'var(--medal-bronze)' };
                return `
                <div class="flex flex-col items-center gap-2.5 text-center rounded-[22px] bg-surface border-[1.5px] justify-end box-border" style="width:220px;padding:22px;min-height:${h}px;border-color:${medalBg[e.rank] || 'var(--border)'};${e.rank === 1 ? 'box-shadow:0 0 40px rgba(242,181,68,0.22)' : ''}">
                    ${leaderboardBadgeHtml(e.rank)}
                    <span class="font-poppins font-semibold text-[17px] leading-[1.25] text-text-strong">${e.name}</span>
                    <span class="font-poppins font-bold text-[28px] text-text-strong">${e.cumulativeScore.toFixed(1)} <span class="font-inter font-medium text-[13px] text-text-muted">pts</span></span>
                </div>`;
            }).join('');

            const headCols = roundCols.map(r => `<th class="p-4 text-center font-inter font-semibold text-[11px] tracking-[1px] uppercase text-text-muted" style="text-transform:uppercase">R${r.round}<br><span class="font-medium normal-case" style="letter-spacing:0">${(r.month || '').slice(0, 3)}</span></th>`).join('');

            const rowsHtml = rows.map(entry => {
                const cells = roundCols.map(r => {
                    const v = entry['r' + r.round];
                    const has = v !== undefined && v !== null;
                    const color = has ? roundColorVars[r.round - 1] : 'var(--text-faint)';
                    const opacity = has && v === 0 ? 'opacity:0.55' : '';
                    return `<td class="p-3.5 text-center font-poppins font-bold text-[15px]" style="color:${color};${opacity}">${has ? v : '–'}</td>`;
                }).join('');
                return `
                <tr class="hover:bg-surface-2 transition">
                    <td class="p-3.5 text-center">${leaderboardBadgeHtml(entry.rank)}</td>
                    <td class="p-3.5 text-left">
                        <div class="font-poppins font-semibold text-[15px] text-text-strong">${entry.name}</div>
                    </td>
                    ${cells}
                    <td class="p-3.5 text-center font-poppins font-bold text-[17px] text-text-strong" style="background:var(--surface-2)">${entry.cumulativeScore.toFixed(1)}</td>
                </tr>`;
            }).join('');

            return `
            <section aria-label="Top three" class="flex justify-center items-end gap-4 flex-wrap mb-7">${podiumHtml}</section>
            <section class="rounded-3xl bg-surface border border-border overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="border-collapse w-full" style="min-width:1080px">
                        <thead>
                            <tr style="background:var(--surface-2)">
                                <th class="p-4 font-inter font-semibold text-[11px] tracking-[1px] uppercase text-text-muted" style="width:70px;text-transform:uppercase">Rank</th>
                                <th class="p-4 text-left font-inter font-semibold text-[11px] tracking-[1px] uppercase text-text-muted" style="min-width:220px;text-transform:uppercase">Participant</th>
                                ${headCols}
                                <th class="p-4 font-inter font-semibold text-[11px] tracking-[1px] uppercase text-gold-text" style="background:var(--surface-2);text-transform:uppercase">Total</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </section>`;
        }

        function renderLeaderboard() {
            const lastClosed = Challenges.allRounds().find(r => Challenges.statusOf(r) === 'closed');
            const eyebrowText = lastClosed ? `Leaderboard · after Round ${lastClosed.round}` : 'Leaderboard';

            return `
            <div class="max-w-6xl mx-auto space-y-7 animate-in fade-in">
                <div class="flex flex-col gap-2 items-center text-center">
                    <span class="font-inter font-semibold text-xs tracking-[1.4px] uppercase text-gold-text shell-sentence-case" style="text-transform:uppercase">${eyebrowText}</span>
                    <h1 class="m-0 font-poppins font-bold text-[44px] leading-[1.1] text-text-strong shell-sentence-case">Innovation leaderboard</h1>
                    <p class="m-0 font-inter font-medium text-[15px] text-link shell-sentence-case">Real-time performance standings (verified)</p>
                </div>
                <div class="flex justify-between items-center gap-4 flex-wrap">
                    <label class="flex items-center gap-2.5 flex-1 min-w-0" style="max-width:340px">
                        <span class="font-inter font-semibold text-[13px] text-text-2 whitespace-nowrap">Find a name</span>
                        <input class="fld" style="width:100%;min-width:100px;max-width:240px;height:44px" value="${state.leaderboardQuery || ''}" oninput="handleLeaderboardSearch(this.value)" placeholder="Type to filter…">
                    </label>
                    <span id="leaderboard-count" class="font-inter font-medium text-[13px] text-text-muted">${leaderboardCountText()}</span>
                </div>
                <div id="leaderboard-results">${renderLeaderboardResults()}</div>
                <div class="px-5 py-4.5 rounded-2xl bg-surface border flex gap-3 flex-wrap items-center justify-between" style="border-color:rgba(242,181,68,0.45)">
                    <span class="font-inter font-medium text-sm leading-[1.5] text-text-2"><strong class="text-gold-text">Heads up:</strong> positions count for the year-end rewards only when all assigned Alison courses are complete.</span>
                    <a href="${Router.buildHash('winners')}" class="link-text font-inter font-semibold text-sm">See monthly winners →</a>
                </div>
            </div>`;
        }
        function renderSubmissionCard(item, round) {
            const [c1, c2] = deptColorsFor(item);
            const name = getSubmissionDisplayName(item);
            const initials = initialsOf(name);
            const title = getSubmissionTitle(item, round ? round.title : 'Challenge');
            const roundLabel = `Round ${item.round === undefined || item.round === null ? 1 : item.round}`;
            const deptLabel = item.type === 'group' ? 'Team' : (item.dept || 'Unknown');
            const isWinner = !!(round && round.winningSubmissionId && round.winningSubmissionId === item.id);
            const hiddenChip = item.hidden
                ? `<span class="px-2.5 py-1 rounded-[10px] font-inter font-semibold text-[10px]" style="background:rgba(230,83,60,0.18);color:#F2A08A">Hidden · ${item.hiddenReason || 'hidden'}</span>`
                : '';
            return `
            <article class="card-hover rounded-[20px] bg-surface border border-border overflow-hidden flex flex-col">
                <div class="relative" style="height:168px;overflow:hidden;background:linear-gradient(135deg, ${c1} 0%, ${c2} 100%)">
                    <div class="absolute rounded-t-[10px] overflow-hidden flex flex-col" style="left:18px;right:18px;top:18px;bottom:0;background:#F5F7FA;box-shadow:0 10px 30px rgba(0,0,0,0.35)">
                        <div class="flex items-center gap-1" style="height:18px;flex-shrink:0;background:#E3E9F0;padding:0 8px">
                            <span class="rounded-full" style="width:6px;height:6px;background:#E6533C"></span>
                            <span class="rounded-full" style="width:6px;height:6px;background:#F2B544"></span>
                            <span class="rounded-full" style="width:6px;height:6px;background:#3FA66B"></span>
                        </div>
                        <div class="flex flex-col justify-end gap-0.5 box-border" style="height:72px;flex-shrink:0;padding:10px 12px;background:linear-gradient(135deg, ${c1}, ${c2})">
                            <span class="font-inter font-bold text-[10px] tracking-[1px] uppercase text-white" style="opacity:0.85;text-transform:uppercase">${roundLabel}</span>
                            <span class="font-poppins font-bold text-[15px] leading-[1.2] text-white truncate">${title}</span>
                        </div>
                        <div class="flex gap-1.5" style="padding:8px 10px">
                            <span class="rounded" style="flex:2;height:6px;background:#CDD7E2"></span>
                            <span class="rounded" style="flex:1;height:6px;background:#CDD7E2"></span>
                        </div>
                    </div>
                    <span class="absolute rounded-full flex items-center justify-center font-poppins font-bold text-sm text-white" style="right:14px;bottom:12px;width:40px;height:40px;background:#050E1C;border:2px solid ${c2}">${initials}</span>
                </div>
                <div class="flex flex-col gap-2.5 flex-1" style="padding:18px">
                    <div class="flex gap-1.5 flex-wrap">
                        <span class="px-2.5 py-1 rounded-[10px] bg-surface-2 font-inter font-semibold text-[11px] text-link">${roundLabel}</span>
                        <span class="px-2.5 py-1 rounded-[10px] bg-surface-2 font-inter font-semibold text-[11px]" style="color:${c2}">${deptLabel}</span>
                        ${isWinner ? `<span class="px-2.5 py-1 rounded-[10px] font-inter font-semibold text-[11px] text-gold-text" style="background:rgba(242,181,68,0.16)">Winner</span>` : ''}
                        ${hiddenChip}
                    </div>
                    <h3 class="m-0 font-poppins font-semibold text-[17px] leading-[1.3] text-text-strong break-words">${title}</h3>
                    <p class="m-0 font-inter text-[13px] leading-[1.5] text-text-muted truncate">By ${name}</p>
                    <div class="mt-auto flex gap-2" style="padding-top:6px">
                        <button type="button" onclick="showDetails('${item.id}')" class="btn-neutral flex-1 inline-flex justify-center items-center rounded-full bg-surface-active text-text-strong font-inter font-semibold text-[13px] cursor-pointer border-0" style="height:38px">Details and impact</button>
                    </div>
                </div>
            </article>`;
        }

        function renderModal() {
            const item = state.selectedInnovation;
            if (!item) return '';
            const round = Challenges.getRound(item.round === undefined || item.round === null ? 1 : item.round);
            const title = getSubmissionTitle(item, round ? round.title : 'Submission');
            const links = collectLinkFields(item);
            const texts = collectTextFields(item);
            return `
                <div class="fixed inset-0 z-[110] bg-slate-950/98 backdrop-blur-3xl flex items-center justify-center p-6 animate-in fade-in duration-300">
                    <div class="modal-card bg-slate-900 max-w-2xl w-full p-12 rounded-[4rem] border-2 border-blue-500/30 shadow-[0_0_100px_rgba(37,99,235,0.2)] relative max-h-[90vh] overflow-y-auto custom-card">
                        <button onclick="closeModal()" class="absolute top-10 right-10 text-slate-500 hover:text-white transition-all hover:rotate-90"><i data-lucide="x" class="w-10 h-10"></i></button>
                        <span class="bg-blue-600/20 text-blue-400 border border-blue-400/30 px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] italic">ROUND ${item.round === undefined || item.round === null ? 1 : item.round} ENTRY DETAIL</span>
                        <h3 class="text-4xl font-black text-white italic tracking-tighter uppercase leading-tight mt-8 mb-6 break-words">${title}</h3>
                        ${item.docLink ? `<img src="${item.docLink}" class="w-full aspect-square object-cover rounded-[2rem] border-2 border-blue-500/20 mb-10 shadow-2xl">` : ''}
                        <div class="space-y-4 mb-10">
                            ${item.type === 'group' ? `
                                <div class="flex items-center gap-3 text-slate-200 text-xs font-black uppercase tracking-widest truncate"><i data-lucide="shield" class="text-blue-500 w-4 h-4"></i> ${item.teamName || ''}</div>
                                <div class="p-6 bg-black/40 rounded-3xl border border-white/5 space-y-3">
                                    ${item.member1Name ? `<div class="flex items-center gap-3 text-slate-400 text-[10px] font-black uppercase tracking-widest truncate"><i data-lucide="user" class="w-3 h-3"></i> ${item.member1Name} • ${item.member1Dept || ''}</div>` : ''}
                                    ${item.member2Name ? `<div class="flex items-center gap-3 text-slate-400 text-[10px] font-black uppercase tracking-widest truncate"><i data-lucide="user" class="w-3 h-3"></i> ${item.member2Name} • ${item.member2Dept || ''}</div>` : ''}
                                </div>
                            ` : `
                                <div class="flex items-center gap-3 text-slate-300 text-sm font-black uppercase tracking-widest truncate"><i data-lucide="user" class="text-blue-500 w-4 h-4"></i> ${item.name || 'Anonymous'} • ${item.email || ''}</div>
                                <div class="flex items-center gap-3 text-slate-400 text-[10px] font-black uppercase tracking-widest px-1"><i data-lucide="briefcase" class="w-3 h-3"></i> ${item.dept || 'CORE'}</div>
                            `}
                        </div>
                        ${links.length ? `
                        <div class="space-y-4 mb-6">
                            <h4 class="text-[11px] font-black text-blue-400 uppercase tracking-[0.3em] flex items-center gap-3"><i data-lucide="link" class="w-4 h-4"></i> Links</h4>
                            <div class="flex flex-wrap gap-3">
                                ${links.map(l => `<a href="${l.url}" target="_blank" rel="noopener noreferrer" class="btn-outline inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-100 font-black text-[11px] uppercase tracking-widest no-underline"><i data-lucide="external-link" class="w-3.5 h-3.5"></i>${l.label}</a>`).join('')}
                            </div>
                        </div>` : ''}
                        ${texts.map(t => `
                        <div class="bg-black/60 rounded-[2.5rem] p-10 border border-white/5 mb-6 shadow-inner">
                            <h4 class="text-[11px] font-black text-amber-400 uppercase tracking-[0.3em] flex items-center gap-3 mb-4"><i data-lucide="file-text" class="w-4 h-4"></i> ${t.label}</h4>
                            <p class="text-slate-200 text-base leading-relaxed italic break-words whitespace-pre-wrap">${t.value}</p>
                        </div>`).join('')}
                        ${(!links.length && !texts.length) ? `<p class="text-slate-500 italic text-sm">No additional details recorded.</p>` : ''}
                    </div>
                </div>
            `;
        }

        function renderIdeaModal() {
            const idea = state.selectedIdea;
            if (!idea) return '';
            return `
                <div class="fixed inset-0 z-[110] bg-slate-950/98 backdrop-blur-3xl flex items-center justify-center p-6 animate-in fade-in duration-300">
                    <div class="modal-card bg-slate-900 max-w-3xl w-full p-12 rounded-[4rem] border-2 border-yellow-500/30 shadow-[0_0_100px_rgba(234,179,8,0.1)] relative max-h-[90vh] overflow-y-auto custom-card">
                        <button onclick="closeIdeaModal()" class="absolute top-10 right-10 text-slate-500 hover:text-white transition-all hover:rotate-90"><i data-lucide="x" class="w-10 h-10"></i></button>
                        <div class="flex items-center gap-3 text-yellow-500 mb-8"><i data-lucide="lightbulb" class="w-6 h-6"></i> <span class="text-xs font-black uppercase tracking-[0.3em] italic">Concept Detail</span></div>
                        <h3 class="text-5xl font-black text-white italic tracking-tighter uppercase leading-none mb-10 break-words">${idea.title}</h3>
                        <div class="bg-black/60 rounded-[3rem] p-12 border border-white/5 shadow-inner">
                            <h4 class="text-[11px] font-black text-blue-400 uppercase tracking-[0.4em] mb-10 flex items-center gap-3"><i data-lucide="align-left" class="w-4 h-4"></i> Detailed Description</h4>
                            <p class="text-slate-100 text-xl leading-[1.8] italic font-medium break-words whitespace-pre-wrap">"${idea.description}"</p>
                        </div>
                    </div>
                </div>
            `;
        }

        function renderAdminLogin() {
            return `
                <div class="fixed inset-0 z-[100] bg-bg/[0.92] backdrop-blur-2xl flex items-center justify-center p-6 animate-in zoom-in duration-300">
                    <div class="modal-card bg-surface max-w-md w-full p-10 rounded-[28px] border border-border shadow-2xl text-center">
                        <div class="w-20 h-20 rounded-[20px] flex items-center justify-center mx-auto mb-7" style="background:rgba(0,174,239,0.1);border:1px solid rgba(0,174,239,0.2)">
                            <i data-lucide="shield-check" class="w-10 h-10" style="color:var(--brand-blue)"></i>
                        </div>
                        <h3 class="m-0 font-poppins font-semibold text-2xl text-text-strong shell-sentence-case mb-3">Admin access</h3>
                        <p class="m-0 font-inter text-sm leading-relaxed text-text-muted mb-7 px-2">Sign in with your Descasio Google account. Only accounts granted admin access will see the Admin tab.</p>
                        ${state.adminSignInError ? `<div class="font-inter text-sm mb-6" style="color:#F2667A">${state.adminSignInError}</div>` : ''}
                        <div class="flex flex-col gap-3">
                            <button onclick="signInAdminWithGoogle()" ${state.adminSigningIn ? 'disabled' : ''} class="btn-coral w-full rounded-full border-0 bg-coral-btn text-text-strong font-inter font-semibold text-[15px] cursor-pointer flex items-center justify-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed" style="height:52px">
                                ${state.adminSigningIn ? '<div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>' : 'Sign in with Google'}
                            </button>
                            <button onclick="toggleAdminLogin()" class="btn-outline w-full rounded-full border-[1.5px] border-border-muted bg-transparent text-text-strong font-inter font-semibold text-sm cursor-pointer" style="height:48px">Cancel</button>
                        </div>
                    </div>
                </div>
            `;
        }

        function navigate(tab, sub) {
            Router.go(tab, sub || null);
        }

        function toggleAdminLogin() {
            state.showAdminLogin = !state.showAdminLogin;
            state.adminSignInError = null;
            updateUI();
        }

        // Admin access is now a Google Sign-In + custom claim (set via scripts/set-admin.js),
        // not a client-side password - see Step 7B. Anyone can sign in with Google; only an
        // account with the admin claim actually gets the Admin tab. A non-admin signer is
        // told politely and dropped back to the normal anonymous session.
        async function signInAdminWithGoogle() {
            state.adminSignInError = null;
            state.adminSigningIn = true;
            updateUI();
            try {
                const provider = new firebase.auth.GoogleAuthProvider();
                await auth.signInWithPopup(provider);
                const tokenResult = await auth.currentUser.getIdTokenResult(true); // force-refresh: custom claims aren't in a cached token
                if (tokenResult.claims && tokenResult.claims.admin === true) {
                    state.isAdmin = true;
                    state.showAdminLogin = false;
                    state.activeTab = 'admin';
                } else {
                    state.adminSignInError = "This Google account isn't an admin yet.";
                    await auth.signOut(); // onAuthStateChanged below re-establishes the anonymous session
                }
            } catch (e) {
                console.error(e);
                state.adminSignInError = 'Google sign-in failed. Please try again.';
            }
            state.adminSigningIn = false;
            updateUI();
        }

        async function logoutAdmin() {
            state.isAdmin = false;
            state.activeTab = 'dashboard';
            try {
                await auth.signOut(); // onAuthStateChanged below re-establishes the anonymous session
            } catch (e) {
                console.error(e);
            }
            updateUI();
        }

        function closeModal() {
            state.selectedInnovation = null;
            updateUI();
        }

        function closeIdeaModal() {
            state.selectedIdea = null;
            updateUI();
        }

        function showDetails(id) {
            state.selectedInnovation = state.submissions.find(s => String(s.id) === String(id));
            updateUI();
        }

        function showIdeaDetails(id) {
            state.selectedIdea = state.ideas.find(i => String(i.id) === String(id));
            updateUI();
        }

        function handleFormInput(stateKey, field, value) {
            state[stateKey][field] = value;
        }

        function setSubmissionType(type) {
            state.submissionType = type;
            updateUI();
        }

        async function toggleShortlist(id, current) {
            try {
                const docRef = db.collection('artifacts').doc(STABLE_APP_ID).collection('public').doc('data').collection('submissions').doc(id);
                await docRef.update({
                    shortlisted: !current
                });
            } catch (e) {
                console.error(e);
            }
        }

        async function deleteSubmission(id) {
            const confirmed = confirm('Permanently delete this submission? This removes it everywhere on the Hub and cannot be undone.');
            if (!confirmed) return;
            try {
                const docRef = db.collection('artifacts').doc(STABLE_APP_ID).collection('public').doc('data').collection('submissions').doc(id);
                await docRef.delete();
            } catch (e) {
                console.error(e);
                alert('Failed to delete submission. Check console for details.');
            }
        }

        function showFormError(msg) {
            const errEl = document.getElementById('formStatus');
            if (errEl) {
                errEl.innerText = msg;
                errEl.classList.remove('hidden');
            }
        }

        function isDescasioEmail(v) {
            return !!v && v.toLowerCase().trim().endsWith('@descasio.io');
        }

        // Step 8D: soft checks the mockup calls "Quick check before you submit" - neither
        // ever blocks a submission, they just ask for confirmation. Empty array = submit
        // straight away.
        function buildSubmitWarnings(round, data) {
            const warnings = [];
            const email = (data.email || '').toLowerCase().trim();
            if (email) {
                const existingCount = state.submissions.filter(s => {
                    if (s.hiddenReason) return false;
                    const effRound = (s.round === undefined || s.round === null) ? 1 : s.round;
                    return effRound === round.round && (s.email || '').toLowerCase().trim() === email;
                }).length;
                if (existingCount > 0) {
                    const plural = existingCount === 1 ? 'entry' : 'entries';
                    warnings.push({
                        icon: String(existingCount),
                        iconStyle: 'background:rgba(0,174,239,0.16);color:var(--link)',
                        html: `<strong class="text-text-strong">You've already submitted ${existingCount} ${plural} for Round ${round.round}.</strong> Sending another is fine; every entry you send is scored.`
                    });
                }
            }

            const validPrefixes = round.page && round.page.howToSubmit && round.page.howToSubmit.validPrefixes;
            if (validPrefixes && validPrefixes.length) {
                for (const req of (round.requirements || [])) {
                    if (req.type !== 'url') continue;
                    const val = data[req.id];
                    if (val && !validPrefixes.some(p => val.startsWith(p))) {
                        const note = round.page.howToSubmit.invalidNote || `This doesn't look like a valid ${req.label}.`;
                        const prefixList = validPrefixes.map(p => `<code class="text-text-strong">${p}</code>`).join(' or ');
                        warnings.push({
                            icon: '!',
                            iconStyle: 'background:rgba(242,181,68,0.16);color:var(--gold-text)',
                            html: `<strong class="text-text-strong">This doesn't look like a ${req.label}.</strong> ${note} Links start with ${prefixList}.`
                        });
                    }
                }
            }

            return warnings;
        }

        function renderSubmitConfirmPanel() {
            const warnings = state.pendingWarnings || [];
            return `
            <div role="alertdialog" aria-label="Check before submitting" class="p-5 rounded-2xl bg-surface-2 flex flex-col gap-3.5" style="border:1px solid rgba(242,181,68,0.5)">
                <span class="font-poppins font-semibold text-[17px] text-text-strong">Quick check before you submit</span>
                ${warnings.map(w => `
                <div class="flex gap-3 items-start">
                    <span class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center font-poppins font-bold text-[13px]" style="${w.iconStyle}">${w.icon}</span>
                    <span class="font-inter text-sm leading-[1.55] text-text-2">${w.html}</span>
                </div>`).join('')}
                <div class="flex gap-2.5 flex-wrap">
                    <button type="button" onclick="cancelSubmitConfirm()" class="btn-outline flex-1 rounded-full border-[1.5px] border-border-muted bg-transparent text-text-strong font-inter font-semibold text-sm cursor-pointer" style="min-width:180px;height:46px">Go back and edit</button>
                    <button type="button" onclick="confirmSubmitAnyway()" class="btn-coral flex-1 rounded-full border-0 bg-coral-btn text-text-strong font-inter font-semibold text-sm cursor-pointer" style="min-width:180px;height:46px">Yes, submit anyway</button>
                </div>
                <span class="font-inter text-xs leading-[1.5] text-text-faint">Each check only appears when it applies.</span>
            </div>`;
        }

        async function handleFormSubmit(e) {
            e.preventDefault();
            const round = Challenges.currentRound();
            if (!round || Challenges.statusOf(round) !== 'open') {
                showFormError('Submissions are closed for this round.');
                return;
            }
            const data = state.formData;
            const isGroup = state.submissionType === 'group';

            if (isGroup) {
                if (!data.teamName) { showFormError('Team name is required.'); return; }
                if (!data.member1Name) { showFormError('Member 1 (team lead) name is required.'); return; }
                if (!isDescasioEmail(data.member1Email)) { showFormError('Member 1 (team lead) email must be a @descasio.io address.'); return; }
                if (!data.member1Dept) { showFormError('Member 1 (team lead) department is required.'); return; }
                if (!data.member2Name) { showFormError('Member 2 name is required.'); return; }
                if (!isDescasioEmail(data.member2Email)) { showFormError('Member 2 email must be a @descasio.io address.'); return; }
                if (!data.member2Dept) { showFormError('Member 2 department is required.'); return; }
                // The feed and the duplicate check always read name/email/dept, so the
                // team lead (member 1) doubles as those fields for group entries too.
                data.name = data.member1Name;
                data.email = data.member1Email;
                data.dept = data.member1Dept;
            } else {
                if (!data.name) { showFormError('Full name is required.'); return; }
                if (!isDescasioEmail(data.email)) { showFormError('Work email must be a @descasio.io address.'); return; }
                if (!data.dept) { showFormError('Department is required.'); return; }
            }

            for (const req of (round.requirements || [])) {
                if (!req.required) continue;
                if (req.type === 'multiselect') {
                    if (!state.formToolsSelected.length) {
                        showFormError(`${req.label} is required.`);
                        return;
                    }
                } else {
                    const val = data[req.id];
                    if (!val) {
                        showFormError(`${req.label} is required.`);
                        return;
                    }
                    if (req.type === 'url' && !val.startsWith('https://')) {
                        showFormError(`${req.label} must start with https://`);
                        return;
                    }
                }
            }

            const errEl = document.getElementById('formStatus');
            if (errEl) errEl.classList.add('hidden');

            const warnings = buildSubmitWarnings(round, data);
            if (warnings.length) {
                state.pendingWarnings = warnings;
                state.showSubmitConfirm = true;
                updateUI();
                return;
            }

            await performSubmit(round, data);
        }

        function cancelSubmitConfirm() {
            state.showSubmitConfirm = false;
            state.pendingWarnings = [];
            updateUI();
        }

        async function confirmSubmitAnyway() {
            const round = Challenges.currentRound();
            await performSubmit(round, state.formData);
        }

        async function performSubmit(round, data) {
            const payload = {
                ...data,
                type: state.submissionType,
                round: round.round,
                shortlisted: false,
                timestamp: new Date().toISOString()
            };
            for (const req of (round.requirements || [])) {
                if (req.type === 'multiselect') payload[req.id] = [...state.formToolsSelected];
            }

            state.submitting = true;
            state.showSubmitConfirm = false;
            updateUI();
            try {
                await db.collection('artifacts').doc(STABLE_APP_ID).collection('public').doc('data').collection('submissions').add(payload);
                state.formData = {};
                state.formToolsSelected = [];
                state.submitting = false;
                state.pendingWarnings = [];
                state.submissionSent = true;
                updateUI();
            } catch (err) {
                console.error(err);
                state.submitting = false;
                showFormError('Something went wrong - please try again.');
                updateUI();
            }
        }

        function showIdeaFormError(msg) {
            const errEl = document.getElementById('ideaStatus');
            if (errEl) {
                errEl.innerText = msg;
                errEl.classList.remove('hidden');
            }
        }

        function resetIdeaForm() {
            state.ideaSent = false;
            updateUI();
        }

        function toggleIdeaExpand(id) {
            state.expandedIdeaId = state.expandedIdeaId === id ? null : id;
            updateUI();
        }

        async function handleIdeaSubmit(e) {
            e.preventDefault();
            const data = state.ideaData;
            if (!data.name) { showIdeaFormError('Full name is required.'); return; }
            if (!data.email || !data.email.toLowerCase().trim().endsWith('@descasio.io')) { showIdeaFormError('Work email must be a @descasio.io address.'); return; }
            if (!data.dept) { showIdeaFormError('Department is required.'); return; }
            if (!data.title) { showIdeaFormError('Idea title is required.'); return; }
            if (!data.description) { showIdeaFormError('Description is required.'); return; }

            const errEl = document.getElementById('ideaStatus');
            if (errEl) errEl.classList.add('hidden');

            state.ideaSubmitting = true;
            updateUI();
            try {
                await db.collection('artifacts').doc(STABLE_APP_ID).collection('public').doc('data').collection('ideas').add({
                    ...data,
                    timestamp: new Date().toISOString()
                });
                state.ideaData = {};
                state.ideaSubmitting = false;
                state.ideaSent = true;
                updateUI();
            } catch (err) {
                console.error(err);
                state.ideaSubmitting = false;
                showIdeaFormError('Something went wrong - please try again.');
                updateUI();
            }
        }

        function leaderboardFilteredRows() {
            const q = (state.leaderboardQuery || '').trim().toLowerCase();
            return q ? state.leaderboard.filter(e => (e.name || '').toLowerCase().includes(q)) : state.leaderboard;
        }

        function leaderboardCountText() {
            const q = (state.leaderboardQuery || '').trim().toLowerCase();
            if (!q) return 'Ties share a rank';
            const n = leaderboardFilteredRows().length;
            return `${n} match${n === 1 ? '' : 'es'}`;
        }

        // Direct DOM patch (not updateUI()) so typing in the search box isn't blocked by
        // updateUI()'s focused-input guard - see js/app.js's updateUI() for that guard.
        function handleLeaderboardSearch(value) {
            state.leaderboardQuery = value;
            const resultsEl = document.getElementById('leaderboard-results');
            const countEl = document.getElementById('leaderboard-count');
            if (resultsEl) resultsEl.innerHTML = renderLeaderboardResults();
            if (countEl) countEl.innerText = leaderboardCountText();
        }

        Router.onRouteChange((route) => {
            if (route.tab !== 'gallery' && state.activeTab === 'gallery') {
                state.submissionSent = false; // don't leave a stale "Entry received" screen behind
                state.showSubmitConfirm = false;
                state.pendingWarnings = [];
            }
            state.activeTab = route.tab;
            state.routeSub = route.sub;
            updateUI();
        });

        // Fires on every auth transition - initial anonymous sign-in, Google sign-in for
        // admin, and signing back out of Google into a fresh anonymous session. The
        // Firestore listeners/Challenges/router wiring must only ever run ONCE (guarded by
        // listenersWired below); re-running it on every admin sign-in/out would re-register
        // duplicate onSnapshot listeners. The admin-claim check, by contrast, must run on
        // EVERY transition, since that's exactly how an admin session starts/ends.
        let listenersWired = false;
        auth.onAuthStateChanged(async (user) => {
            if (!user) {
                await auth.signInAnonymously();
                return; // the resulting call with a real (anonymous) user handles the rest
            }

            state.user = user;
            try {
                const tokenResult = await user.getIdTokenResult();
                state.isAdmin = !!(tokenResult.claims && tokenResult.claims.admin === true);
            } catch (e) {
                state.isAdmin = false;
            }

            if (!listenersWired) {
                listenersWired = true;

                setInterval(() => {
                    updateCountdown();
                }, 60000); // spec: "Update every minute"

                db.collection('artifacts').doc(STABLE_APP_ID).collection('public').doc('data').collection('submissions')
                    .onSnapshot((snapshot) => {
                        state.submissions = snapshot.docs.map(doc => ({
                            id: doc.id,
                            ...doc.data()
                        }));
                        state.submissions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                        updateUI();
                    });

                db.collection('artifacts').doc(STABLE_APP_ID).collection('public').doc('data').collection('ideas')
                    .onSnapshot((snapshot) => {
                        state.ideas = snapshot.docs.map(doc => ({
                            id: doc.id,
                            ...doc.data()
                        }));
                        state.ideas.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                        updateUI();
                    });

                db.collection('artifacts').doc(STABLE_APP_ID).collection('public').doc('data').collection('leaderboard')
                    .onSnapshot((snapshot) => {
                        const firestoreData = snapshot.docs.map(doc => ({
                            id: doc.id,
                            ...doc.data()
                        }));
                        const combined = [...FINAL_STANDINGS];
                        firestoreData.forEach(item => {
                            const existingIdx = combined.findIndex(e => e.name === item.name);
                            if (existingIdx > -1) combined[existingIdx] = item;
                            else combined.push(item);
                        });
                        state.leaderboard = combined.sort((a, b) => (b.cumulativeScore || 0) - (a.cumulativeScore || 0));
                        updateUI();
                    });

                Challenges.init(db, STABLE_APP_ID);
                Challenges.onUpdate(() => {
                    updateCountdown();
                    updateUI();
                });

                Router.onRoute(); // sync state.activeTab/routeSub from the current URL hash
            }

            updateUI();
        });
