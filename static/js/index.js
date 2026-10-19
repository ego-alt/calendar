// Current date (fixed, doesn't change)
const TODAY = new Date();
const CURRENT_YEAR = TODAY.getFullYear();
const CURRENT_MONTH = TODAY.getMonth() + 1; // getMonth() returns 0-11
const CURRENT_DAY = TODAY.getDate();

// View state (changes as user navigates)
let viewState = {
    year: CURRENT_YEAR,
    month: CURRENT_MONTH,
};

let viewToken = 0;   // latest month load; older responses are ignored
let currentOpenDay = null;

/** Shared by color picker UI (eye icon, options, document dismiss). */
let moodPickerSelectedDay = null;
let moodPickerMenuOpen = false;

let globalListenersAttached = false;

/** True when start ends at 00:00 and end ends at 23:59: how all-day entries are stored. */
function isAllDayEvent(event) {
    return Boolean(
        event.start_time && event.start_time.endsWith('00:00')
        && event.end_time && event.end_time.endsWith('23:59')
    );
}

/** A trip's note for one of its days: a moment of a multi-day entry named
 *  just "Day #3" (or "Half-day"), within one day. The entry already shows
 *  "day 3 of 5", so this reads as plain text under it, not a titled moment. */
function isTripDayNote(entry, moment) {
    const day = (s) => (s || '').slice(0, 10);
    return Boolean(entry.end_time) && day(entry.start_time) !== day(entry.end_time)
        && day(moment.start_time) === day(moment.end_time || moment.start_time)
        && /^(day\s*#?\s*\d+|half[- ]?day)$/i.test((moment.name || '').trim());
}

/** Parse "YYYY-MM-DD HH:MM" as a local-time Date — explicit to dodge browser parsing differences. */
function parseLocalDateTime(str) {
    const [datePart, timePart] = str.split(' ');
    const [y, m, d] = datePart.split('-').map(Number);
    const [hh, mm] = (timePart || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm);
}

/** The mosaic's depth: a folded corner that grows with how much was written
 *  that day, and a small notch when the day holds a photo or ticket. */
function foldMarkup(data, day) {
    const info = (data.day_info || {})[day];
    let html = '';
    if (info && info.chars) {
        const level = info.chars < 280 ? 1 : info.chars < 1200 ? 2 : 3;
        html += `<div class="fold fold-${level}" aria-hidden="true"></div>`;
    } else if ((data.days_with_events || []).includes(day)) {
        html += '<div class="fold fold-1" aria-hidden="true"></div>';
    }
    if (info && info.attachments) html += '<div class="photo-notch" aria-hidden="true"></div>';
    return html;
}

// ---------- status line (desktop month view) ----------
// A vim-style line under the grid: the month in numbers, or the hovered day.

function moodNameForColor(color) {
    return (window.MOODS || []).find((m) => m.color === color)?.name || '';
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function renderStatusLine(day = null) {
    const el = document.getElementById('statusLine');
    const data = window.monthData;
    if (!el || !data) return;
    const info = data.day_info || {};
    if (day) {
        const date = new Date(data.year, data.month - 1, day);
        const d = info[day] || {};
        const mood = moodNameForColor((data.mood_colors || {})[day]);
        const bits = [formatDate(date), mood || 'no mood',
            d.entries ? `${d.entries} ${d.entries === 1 ? 'entry' : 'entries'}` : 'no entries'];
        if (d.note) bits.push('a note');
        if (d.attachments) bits.push(plural(d.attachments, 'attachment'));
        el.textContent = bits.join('  ·  ');
        return;
    }
    const days = Object.keys(data.mood_colors || {}).length;
    const entries = Object.values(info).reduce((n, d) => n + (d.entries || 0), 0);
    const files = Object.values(info).reduce((n, d) => n + (d.attachments || 0), 0);
    const monthName = `${MONTH_ABBR[data.month - 1]} ${data.year}`;
    const bits = [monthName, `${days} ${days === 1 ? 'day' : 'days'} logged`, `${entries} ${entries === 1 ? 'entry' : 'entries'}`];
    if (files) bits.push(plural(files, 'attachment'));
    el.textContent = bits.join('  ·  ');
}
document.addEventListener('mouseover', (e) => {
    const cell = e.target.closest && e.target.closest('#viewMonth .day.current-month');
    renderStatusLine(cell ? Number(cell.dataset.day) : null);
});

/** Format a Date as a local "YYYY-MM-DD" ISO date string. */
function isoFromDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* One date style everywhere: "Tue 6 Oct 2026", built by hand so
 * it doesn't vary by browser locale (Chrome's en-GB says "Sept", adds commas). */
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function formatDate(d, { weekday = true, year = true } = {}) {
    return `${weekday ? WEEKDAY_ABBR[d.getDay()] + ' ' : ''}${d.getDate()} ${MONTH_ABBR[d.getMonth()]}${year ? ' ' + d.getFullYear() : ''}`;
}

/** A who / where / notes line in the logbook voice: a text mark (+ who,
 *  @ where, > notes) instead of an icon; CSS colours each kind. `html` must
 *  already be escaped. Shared by the day panel, the diary and search. */
const DETAIL_MARK = { who: '+', where: '@', notes: '>' };
function detailLine(kind, html, className) {
    return `<div class="${className} detail-${kind}"><span class="mark" aria-hidden="true">${DETAIL_MARK[kind]}</span>${html}</div>`;
}

/** Escape user-controlled strings for safe insertion into HTML template literals. */
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

document.addEventListener('DOMContentLoaded', () => {
    setupGlobalEventListeners();
    setupMonthGridListeners();
    setupSwipeNavigation();
    document.addEventListener('keydown', handleKeyPress);
    setupTmux();
    window.monthData = window.INITIAL_MONTH;
    renderStatusLine();
    document.getElementById('firstRunBtn')?.addEventListener('click', async () => {
        await goToToday();
        showSidebar(CURRENT_DAY);
    });
    const keysModal = document.getElementById('keysModal');
    keysModal.addEventListener('click', (e) => { if (e.target === keysModal) keysModal.hidden = true; });
    document.getElementById('keysBtn')?.addEventListener('click', () => { keysModal.hidden = false; });
    document.getElementById('paneClose').addEventListener('click', () => closePane());
    document.querySelectorAll('.pane-tab').forEach((t) => t.addEventListener('click', () => openPane(t.dataset.pane)));
    // ‹ 2026 › in the year tab's title steps the year (the month follows).
    document.getElementById('paneTitle').addEventListener('click', (e) => {
        const b = e.target.closest('[data-nav]');
        if (b) updateYear(b.dataset.nav);
    });
});

/** The bottom bar's year / diary toggles open the context pane beside the
 *  month. Switching views (calendar / stats / search) is shell.js's job. */
function setupTmux() {
    document.querySelectorAll('.tmux-win[data-pane]').forEach((b) => {
        b.addEventListener('click', () => {
            const fromElsewhere = !document.body.classList.contains('view-calendar');
            if (fromElsewhere) document.querySelector('.tmux-win[data-view="calendar"]').click();
            if (fromElsewhere) openPane(b.dataset.pane);
            else togglePane(b.dataset.pane);
        });
    });
    updateTmux();
}

/* ---- the context pane: closed, or showing the year or the diary ---- */

/** Which tab the pane shows ('year' / 'diary'), or '' when closed. */
const paneTab = () => document.getElementById('termWindow').dataset.pane || '';
const isPaneOpen = (tab) => paneTab() === tab;

function openPane(tab) {
    const win = document.getElementById('termWindow');
    win.dataset.pane = tab;
    win.classList.add('pane-open');
    document.querySelectorAll('.pane-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.pane === tab);
        t.setAttribute('aria-selected', String(t.dataset.pane === tab));
    });
    document.getElementById('yearView').hidden = tab !== 'year';
    document.getElementById('diaryView').hidden = tab !== 'diary';
    if (tab === 'year') {
        loadYearView(viewState.year);
        document.getElementById('yearView').scrollTop = 0;   // January first
    } else {
        loadMonthEvents();
    }
    updateTmux();
}

function closePane() {
    const win = document.getElementById('termWindow');
    delete win.dataset.pane;
    win.classList.remove('pane-open');
    updateTmux();
}

/** y / d: open that tab, switch to it, or close it if it's the one showing. */
function togglePane(tab) {
    if (isPaneOpen(tab)) closePane();
    else openPane(tab);
}

/** The pane's own title: ‹ 2026 › for the year, the month for the diary. */
function renderPaneTitle() {
    const title = document.getElementById('paneTitle');
    if (isPaneOpen('year')) {
        title.innerHTML = `<button type="button" class="drawer-step" data-nav="prev" aria-label="Previous year">‹</button><span class="pane-year">${viewState.year}</span><button type="button" class="drawer-step" data-nav="next" aria-label="Next year">›</button>`;
    } else if (isPaneOpen('diary')) {
        title.innerHTML = `<span class="pane-month">${MONTH_ABBR[viewState.month - 1]} ${viewState.year}</span>`;
    } else {
        title.textContent = '';
    }
}

/** Light up the bottom bar's year / diary toggles for the open tab. */
function updateTmux() {
    const calendar = document.body.classList.contains('view-calendar');
    document.querySelectorAll('.tmux-win[data-pane]').forEach((b) => {
        const on = calendar && isPaneOpen(b.dataset.pane);
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
}
window.updateTmux = updateTmux;

/** Jump every view back to today. */
async function goToToday() {
    viewState.year = CURRENT_YEAR;
    viewState.month = CURRENT_MONTH;
    await updateCalendarView();
}

/** Document-level and static-DOM listeners — call once. */
function setupGlobalEventListeners() {
    if (globalListenersAttached) return;
    globalListenersAttached = true;

    const colorPicker = document.getElementById('colorPicker');

    document.querySelectorAll('.color-option').forEach(option => {
        option.addEventListener('click', () => {
            if (!moodPickerSelectedDay) return;
            const day = Number(moodPickerSelectedDay.dataset.day);
            const key = option.dataset.mood === 'clear' ? null : option.dataset.mood;
            colorPicker.style.display = 'none';
            moodPickerMenuOpen = false;
            moodPickerSelectedDay = null;
            setDayMood(viewState.year, viewState.month, day, key);   // day.js
        });
    });

    document.addEventListener('click', (event) => {
        // A tap inside the panel that re-rendered it (mood chip, Cancel, …) has
        // a target that's no longer in the page; that's not a tap outside.
        if (!event.target.isConnected) return;
        const sidebar = document.getElementById('sidebar');
        const colorPickerEl = document.getElementById('colorPicker');

        const t = event.target;
        // The quick mood picker closes on any tap elsewhere.
        if (!t.closest('#colorPicker, .eye-icon')) {
            colorPickerEl.style.display = 'none';
            moodPickerMenuOpen = false;
            moodPickerSelectedDay = null;
        }
        // The day panel closes on a tap outside it, unless that tap opens a
        // day (a month cell), lands in the context drawer, or is on our own overlays.
        const keepsPanel = t.closest(
            '#sidebar, #contextPane, #colorPicker, .day, .eye-icon, .tmux-win[data-pane], #confirmModal, #toasts, #actionSheet, #viewer, #keysModal, #keysBtn'
        );
        // The Year / Diary drawer closes the same way, but stays while you open
        // days on the month or work in the day panel.
        const keepsPane = t.closest(
            // (clicks on the Stats / Search pages don't count: it's hidden there)
            '#contextPane, #sidebar, #colorPicker, .day, .eye-icon, .tmux, #statsView, #searchView, #confirmModal, #toasts, #actionSheet, #viewer, #keysModal'
        );
        if (!keepsPane && paneTab()) closePane();
        if (!keepsPanel && sidebar.classList.contains('active')) {
            sidebar.classList.remove('active');
            if (window.innerWidth <= 480) sidebar.style.height = '';
            // Any half-written entry is kept as a draft (see day.js) and comes
            // back when this day is opened again.
            closeEntryForm();
        }
    });

    // Signed out, the sign-in card *is* the page (it can't be dismissed).
    document.querySelector('.login-content').addEventListener('click', (e) => {
        e.stopPropagation();
    });

    if (window.innerWidth <= 480) {
        // Dismiss the bottom sheet by tapping the handle, or by pressing and
        // swiping down anywhere on the card. The swipe only counts when the
        // content is scrolled to the top, so it doesn't fight content scrolling.
        const sheet = document.getElementById('sidebar');
        const handle = document.querySelector('.sidebar-handle');
        handle.addEventListener('click', dismissSidebar);

        let startY = null, atTop = false;
        sheet.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
            atTop = sheet.scrollTop <= 0;
        }, { passive: true });
        sheet.addEventListener('touchend', (e) => {
            if (startY === null) return;
            const dy = e.changedTouches[0].clientY - startY;
            startY = null;
            if (atTop && dy > 60) {
                suppressClickUntil = e.timeStamp + 500;  // swallow the trailing tap
                dismissSidebar();
            }
        }, { passive: true });
    }
}

/** Slide the bottom-sheet day view back down (mobile). */
function dismissSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('active');
    sidebar.style.height = '';
}

/** Day cells are replaced when the month changes — reattach only these listeners. */
function setupMonthGridListeners() {
    const colorPicker = document.getElementById('colorPicker');

    document.querySelectorAll('.day.current-month').forEach(day => {
        const eyeIcon = document.createElement('i');
        eyeIcon.className = 'fas fa-eye eye-icon';
        day.appendChild(eyeIcon);

        eyeIcon.setAttribute('role', 'button');
        eyeIcon.setAttribute('aria-label', 'Set mood');
        eyeIcon.title = 'Set mood';
        eyeIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            // A quick picker next to the day (desktop). Clearing is a visible
            // option in the picker, not a second click on the icon.
            if (moodPickerMenuOpen && moodPickerSelectedDay === day) {
                colorPicker.style.display = 'none';
                moodPickerMenuOpen = false;
                moodPickerSelectedDay = null;
                return;
            }
            moodPickerSelectedDay = day;
            moodPickerMenuOpen = true;
            colorPicker.style.display = 'flex';
            const rect = day.getBoundingClientRect();
            colorPicker.style.left = `${rect.left - 44}px`;
            colorPicker.style.top = `${rect.top}px`;
        });
    });

    document.querySelectorAll('.day.current-month').forEach(day => {
        day.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            toggleDayMarker(viewState.year, viewState.month, Number(day.dataset.day));   // day.js
        });
    });
}

function handleKeyPress(event) {
    const tag = event.target.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target.isContentEditable;
    if (event.metaKey || event.ctrlKey || event.altKey) return;   // leave browser shortcuts alone
    const keysSheet = document.getElementById('keysModal');

    if (event.key === 'Escape') {
        if (!keysSheet.hidden) { keysSheet.hidden = true; event.preventDefault(); return; }
        // Close the entry form but keep what was typed (it's restored next time).
        if (entryForm) {
            closeEntryForm();
            toast('Draft kept');
        } else if (document.getElementById('sidebar').classList.contains('active')) {
            dismissSidebar();
        } else if (!inInput && paneTab()) {
            closePane();
        }
        event.preventDefault();
        return;
    }
    if (inInput) return;
    if (!document.getElementById('confirmModal').hidden || !document.getElementById('viewer').hidden) return;

    if (event.key === '?') { keysSheet.hidden = !keysSheet.hidden; event.preventDefault(); return; }
    if (event.key === '/') {
        event.preventDefault();
        document.querySelector('.tmux-win[data-view="search"]')?.click();
        document.getElementById('searchInput').focus();
        return;
    }
    if (event.key === 'm') {
        document.querySelector('.tmux-win[data-view="calendar"]')?.click();
        return;
    }
    if (!document.body.classList.contains('view-calendar')) return;

    const panelOpen = document.getElementById('sidebar').classList.contains('active') && currentOpenDay != null;
    const moods = window.MOODS || [];
    if (/^[1-9]$/.test(event.key) && Number(event.key) <= moods.length) {
        if (!panelOpen) return;
        setDayMood(viewState.year, viewState.month, currentOpenDay, moods[Number(event.key) - 1].key);
        return;
    }
    switch (event.key) {
        case 'h': case 'ArrowLeft': updateMonth('prev'); break;
        case 'l': case 'ArrowRight': updateMonth('next'); break;
        case 'k': updateYear('prev'); break;
        case 'j': updateYear('next'); break;
        case '[': if (panelOpen) stepDay(-1); break;
        case ']': if (panelOpen) stepDay(1); break;
        case 'y': togglePane('year'); break;
        case 'd': togglePane('diary'); break;
        case 't': goToToday(); break;
        case 'x': if (panelOpen) toggleDayMarker(viewState.year, viewState.month, currentOpenDay); break;
        case 'n':
            event.preventDefault();
            if (panelOpen) { openEntryForm('new'); break; }
            // No day open: write about today.
            goToToday().then(async () => {
                await showSidebar(CURRENT_DAY);
                if (!entryForm) openEntryForm('new');
            });
            break;
        default: return;
    }
}

/** Horizontal swipes on the month mirror the h/l keys: left = next, right =
 *  prev. A detected swipe suppresses the trailing click so it doesn't also
 *  open a day. Vertical-dominant gestures are left alone so page and panel
 *  scrolling still works. */
let suppressClickUntil = 0;
function setupSwipeNavigation() {
    const surface = document.getElementById('calendarContainer');
    if (!surface) return;

    let startX = 0, startY = 0, startT = 0, tracking = false;
    surface.addEventListener('touchstart', (e) => {
        tracking = e.touches.length === 1;
        if (!tracking) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startT = e.timeStamp;
    }, { passive: true });

    surface.addEventListener('touchend', (e) => {
        if (!tracking) return;
        tracking = false;
        const t = e.changedTouches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && e.timeStamp - startT < 600) {
            suppressClickUntil = e.timeStamp + 500;
            updateMonth(dx < 0 ? 'next' : 'prev');
        }
    }, { passive: true });

    // Swallow the synthetic click that follows the swipe, before it reaches a day.
    document.addEventListener('click', (e) => {
        if (e.timeStamp < suppressClickUntil) {
            suppressClickUntil = 0;
            e.stopPropagation();
            e.preventDefault();
        }
    }, true);
}

async function updateMonth(direction) {
    if (direction === 'next') {
        viewState.month++;
        if (viewState.month > 12) {
            viewState.month = 1;
            viewState.year++;
        }
    } else if (direction === 'prev') {
        viewState.month--;
        if (viewState.month < 1) {
            viewState.month = 12;
            viewState.year--;
        }
    }
    await updateCalendarView();
}

async function updateYear(direction) {
    viewState.year += direction === 'next' ? 1 : -1;
    await updateCalendarView();
}

async function updateCalendarView() {
    // Every navigation starts a load; only the newest one is drawn, so quick
    // key presses or swipes are never dropped. The grid dims if it's slow.
    const token = ++viewToken;
    const { year, month } = viewState;
    const container = document.getElementById('calendarContainer');
    const dim = setTimeout(() => container.classList.add('loading'), 150);

    try {
        const response = await fetch(appUrl(`/get_month?year=${year}&month=${month}`));
        if (!response.ok) throw new Error(`month ${response.status}`);
        const data = await response.json();
        if (token !== viewToken) return;
        
        // Update main header
        document.getElementById('calTitle').textContent = data.month_label;
        const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        
        // Generate the new month HTML
        const monthInner = `
            ${weekdays.map(day => `
                <div class="weekday">${day}</div>
            `).join('')}
            ${data.calendar_data.prev_days.map(day => `
                <div class="day prev-month" data-day="${day}"></div>
            `).join('')}
            ${data.calendar_data.current_days.map(day => `
                <div class="day current-month ${viewState.year === CURRENT_YEAR && viewState.month === CURRENT_MONTH && day === CURRENT_DAY ? 'today ' : ''}${(viewState.year < CURRENT_YEAR ||
                        (viewState.year === CURRENT_YEAR && viewState.month < CURRENT_MONTH) ||
                        (viewState.year === CURRENT_YEAR && viewState.month === CURRENT_MONTH && day < CURRENT_DAY))
                        ? 'past' : ''}"
                     data-day="${day}"
                     onclick="showSidebar(${day})"
                     ${data.mood_colors[day] ? `style="background-color: ${data.mood_colors[day]}"` : ''}>
                    ${foldMarkup(data, day)}
                    ${data.days_with_marker.includes(day) ? '<div class="marker-indicator"></div>' : ''}
                </div>
            `).join('')}
            ${data.calendar_data.next_days.map(day => `
                <div class="day next-month" data-day="${day}"></div>
            `).join('')}
        `;

        document.getElementById('viewMonth').innerHTML = monthInner;
        window.monthData = { year, month, ...data };
        renderStatusLine();
        setupMonthGridListeners();
        syncPane();

    } catch (error) {
        if (token !== viewToken) return;
        console.error('Error updating calendar:', error);
        toast(`Couldn't load ${new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}.`, {
            error: true, action: 'Retry', onAction: () => updateCalendarView(),
        });
    } finally {
        clearTimeout(dim);
        if (token === viewToken) container.classList.remove('loading');
    }
}

function showLoginError(message) {
    const el = document.getElementById('loginError');
    el.textContent = message;
    el.style.display = 'block';
}

async function handleLogin(event) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    
    try {
        const response = await fetch(appUrl('/auth/login'), {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            location.reload();
        } else {
            showLoginError(data.error);
        }
    } catch (error) {
        console.error('Login error:', error);
        showLoginError("Couldn't reach the calendar. Check your connection.");
    }
}


/** The Diary: one month to read back, day by day, with each day's mood,
 *  marker, entries (with their moments) and attachments. Days that only have
 *  a mood are listed too. */
async function loadMonthEvents() {
    const content = document.getElementById('diaryContent');
    const { year, month } = viewState;
    const monthLong = new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'long' });
    renderPaneTitle();
    content.innerHTML = '<div class="loading-indicator">Loading…</div>';
    let events, monthData, attachments;
    try {
        [events, monthData, attachments] = await Promise.all([
            api(`/events/month?year=${year}&month=${month}`),
            api(`/get_month?year=${year}&month=${month}`),
            api(`/attachments/month?year=${year}&month=${month}`),
        ]);
    } catch (error) {
        if (viewState.year !== year || viewState.month !== month) return;
        content.innerHTML = `<div class="error-message">Couldn't load ${escapeHtml(monthLong)}. ${escapeHtml(error.message)}<br>
            <button type="button" class="btn btn-secondary retry-btn" data-act="diary-retry">Try again</button></div>`;
        return;
    }
    if (viewState.year !== year || viewState.month !== month) return;   // moved on meanwhile

    const entriesByDay = {};
    events.events.forEach((event) => {
        const start = parseLocalDateTime(event.start_time);
        const end = parseLocalDateTime(event.end_time || event.start_time);
        for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= end; d.setDate(d.getDate() + 1)) {
            if (d.getFullYear() === year && d.getMonth() + 1 === month) {
                (entriesByDay[d.getDate()] ||= []).push(event);
            }
        }
    });
    const moodColors = monthData.mood_colors || {};
    const markers = new Set(monthData.days_with_marker || []);
    const files = attachments.attachments || {};
    const notes = events.notes || {};
    diaryFiles = files;
    const days = [...new Set([
        ...Object.keys(entriesByDay), ...Object.keys(moodColors), ...Object.keys(files), ...markers,
        ...Object.keys(notes),
    ].map(Number))].sort((a, b) => a - b);

    if (!days.length) {
        content.innerHTML = `<div class="no-events">No entries in ${escapeHtml(monthLong)}.</div>`;
        return;
    }
    const moodName = (color) => (window.MOODS || []).find((m) => m.color === color)?.name || '';
    const detail = (kind, text, extra = '') =>
        text ? detailLine(kind, escapeHtml(text), `diary-event-detail ${extra}`) : '';

    // A multi-day entry is written out in full the first time it appears; on
    // its later days it's one line (with that day's moments, if any).
    const shownInFull = new Set();
    content.innerHTML = days.map((day) => {
        const date = new Date(year, month - 1, day);
        const iso = isoFromDate(date);
        const color = moodColors[day];
        const entries = (entriesByDay[day] || []).map((event) => {
            const moments = (event.subevents || []).filter((s) => s.start_time.startsWith(iso)).map((s) => isTripDayNote(event, s) ? `
                <div class="diary-subevent trip-day-note">
                    ${detail('where', s.where)}
                    ${detail('notes', s.notes, 'diary-event-notes')}
                </div>` : `
                <div class="diary-subevent">
                    <div class="diary-subevent-title">${escapeHtml(s.name)}${s.where ? `<span class="diary-subevent-content"> · ${escapeHtml(s.where)}</span>` : ''}</div>
                    ${s.notes ? `<div class="diary-subevent-content">${escapeHtml(s.notes)}</div>` : ''}
                </div>`).join('');
            if (shownInFull.has(event.id)) {
                return `
                <div class="diary-event diary-continued" data-day="${day}" role="button" tabindex="0">
                    <div class="diary-event-time log-gutter" title="${escapeHtml(entryTimeLabel(event, iso))}">${gutterTime(event, iso)}</div>
                    <div class="diary-event-name">↳ ${escapeHtml(event.name)}</div>
                    ${moments}
                </div>`;
            }
            shownInFull.add(event.id);
            return `
                <div class="diary-event" data-day="${day}" role="button" tabindex="0">
                    <div class="diary-event-time log-gutter" title="${escapeHtml(entryTimeLabel(event, iso))}">${gutterTime(event, iso)}</div>
                    ${spanLine(event)}
                    <div class="diary-event-name">${escapeHtml(event.name)}</div>
                    ${detail('who', event.with_who)}
                    ${detail('where', event.where)}
                    ${detail('notes', event.notes, 'diary-event-notes')}
                    ${moments}
                </div>`;
        }).join('');
        const fileTiles = (files[day] || []).map((a, i) => {
            const name = escapeHtml(a.caption || a.filename);
            return a.is_image
                ? `<button type="button" class="diary-file diary-file-img" data-file-day="${day}" data-file-index="${i}" title="${name}"><img src="${appUrl(`/attachments/${a.id}/thumb`)}" alt="${name}" loading="lazy"></button>`
                : `<button type="button" class="diary-file" data-file-day="${day}" data-file-index="${i}" title="${name}"><i class="fas fa-file-pdf" aria-hidden="true"></i><span>${name}</span></button>`;
        }).join('');
        return `
            <section class="diary-day">
                <button type="button" class="diary-day-head" data-day="${day}" title="Open this day">
                    <span class="diary-date">${escapeHtml(formatDayShort(date))}</span>
                    <span class="diary-rule" aria-hidden="true"></span>
                    ${color ? `<span class="diary-mood" style="--mood: ${color}"><span class="mood-dot" aria-hidden="true"></span>${escapeHtml(moodName(color))}</span>` : ''}
                    ${markers.has(day) ? '<span class="diary-marker" aria-hidden="true"></span>' : ''}
                </button>
                ${notes[day] ? `<div class="diary-day-note">${detail('notes', notes[day], 'diary-event-notes')}</div>` : ''}
                ${entries ? `<div class="diary-events">${entries}</div>` : ''}
                ${fileTiles ? `<div class="diary-files">${fileTiles}</div>` : ''}
            </section>`;
    }).join('');
}

let diaryFiles = {};
document.getElementById('diaryContent').addEventListener('click', (e) => {
    const file = e.target.closest('[data-file-day]');
    if (file) {
        openViewer(diaryFiles[file.dataset.fileDay] || [], Number(file.dataset.fileIndex), { editable: false });
        return;
    }
    if (e.target.closest('[data-act="diary-retry"]')) { loadMonthEvents(); return; }
    const dayEl = e.target.closest('[data-day]');
    if (dayEl) showSidebar(Number(dayEl.dataset.day));
});

/** Year: twelve small month grids with moods, markers and entry dots, as a
 *  navigator beside the month: tapping a month (or a day in it) takes the
 *  calendar there. */
let yearShown = null;   // the year the pane last drew
async function loadYearView(year, { keepScroll = false } = {}) {
    const yearContent = document.getElementById('yearContent');
    renderPaneTitle();
    if (!keepScroll) {
        yearContent.innerHTML = '<div class="loading-indicator">Loading…</div>';
        document.getElementById('yearView').scrollTop = 0;   // a new year starts at January
    }
    let data;
    try {
        data = await api(`/get_year?year=${year}`);
    } catch (error) {
        yearContent.innerHTML = `<div class="error-message">Couldn't load ${year}. ${escapeHtml(error.message)}<br>
            <button type="button" class="btn btn-secondary retry-btn" data-act="year-retry">Try again</button></div>`;
        return;
    }
    if (year !== viewState.year) return;
    const weekdays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div class="year-weekday">${d}</div>`).join('');
    yearContent.innerHTML = data.months.map((m) => {
        const name = new Date(year, m.month - 1, 1).toLocaleDateString('en-GB', { month: 'long' });
        const blanks = m.calendar_data.prev_days.map(() => '<div class="year-day year-prev-month"></div>').join('');
        const days = m.calendar_data.current_days.map((day) => {
            const color = m.mood_colors[day];
            const isToday = year === CURRENT_YEAR && m.month === CURRENT_MONTH && day === CURRENT_DAY;
            return `<button type="button" class="year-day year-current-month${isToday ? ' today' : ''}"
                        data-month="${m.month}" data-day="${day}" aria-label="${escapeHtml(formatDayShort(new Date(year, m.month - 1, day)))}"
                        ${color ? `style="background-color: ${color}"` : ''}>
                        ${m.days_with_events.includes(day) ? '<span class="year-dot" aria-hidden="true"></span>' : ''}
                        ${m.days_with_marker.includes(day) ? '<span class="year-marker" aria-hidden="true"></span>' : ''}
                    </button>`;
        }).join('');
        return `
            <section class="year-month" id="year-month-${m.month}" data-month="${m.month}">
                <button type="button" class="year-month-title" data-month="${m.month}">${escapeHtml(name)}</button>
                <div class="year-month-grid">${weekdays}${blanks}${days}</div>
            </section>`;
    }).join('');
    yearShown = year;
}

/** After the month changes, bring the open pane along. */
function syncPane() {
    renderPaneTitle();
    if (isPaneOpen('diary')) loadMonthEvents();
    if (isPaneOpen('year') && yearShown !== viewState.year) loadYearView(viewState.year);
}

document.getElementById('yearContent').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="year-retry"]')) { loadYearView(viewState.year); return; }
    const target = e.target.closest('.year-day[data-day], .year-month-title');
    if (!target) return;
    // The calendar goes to that month; a day also opens in the day panel.
    viewState.month = Number(target.dataset.month);
    updateCalendarView();
    if (target.dataset.day) showSidebar(Number(target.dataset.day));
});
