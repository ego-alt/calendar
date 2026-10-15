// Current date (fixed, doesn't change)
const TODAY = new Date();
const CURRENT_YEAR = TODAY.getFullYear();
const CURRENT_MONTH = TODAY.getMonth() + 1; // getMonth() returns 0-11
const CURRENT_DAY = TODAY.getDate();

// View state (changes as user navigates)
let viewState = {
    year: CURRENT_YEAR,
    month: CURRENT_MONTH,
    mode: 'month',
    weekAnchor: { year: CURRENT_YEAR, month: CURRENT_MONTH, day: CURRENT_DAY },
};

let viewToken = 0;   // latest month/week load; older responses are ignored
let currentOpenDay = null;

/** Shared by color picker UI (eye icon, options, document dismiss). */
let moodPickerSelectedDay = null;
let moodPickerMenuOpen = false;

let globalListenersAttached = false;

/** Format a Date or "YYYY-MM-DD HH:MM" string as "HH:MM" (24h). */
function formatTimeOfDay(input) {
    // Parse "YYYY-MM-DD HH:MM" by hand: Safari can't parse it (Invalid Date).
    const date = input instanceof Date ? input : parseLocalDateTime(input);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** True when start ends at 00:00 and end ends at 23:59 (legacy all-day encoding). */
function isAllDayEvent(event) {
    return Boolean(
        event.start_time && event.start_time.endsWith('00:00')
        && event.end_time && event.end_time.endsWith('23:59')
    );
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

/* One date style everywhere (AUDIT 3.1): "Tue 6 Oct 2026", built by hand so
 * it doesn't vary by browser locale (Chrome's en-GB says "Sept", adds commas). */
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function formatDate(d, { weekday = true, year = true } = {}) {
    return `${weekday ? WEEKDAY_ABBR[d.getDay()] + ' ' : ''}${d.getDate()} ${MONTH_ABBR[d.getMonth()]}${year ? ' ' + d.getFullYear() : ''}`;
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
    setupModeBar();
    window.monthData = window.INITIAL_MONTH;
    renderStatusLine();
    document.getElementById('firstRunBtn')?.addEventListener('click', async () => {
        await goToToday();
        showSidebar(CURRENT_DAY);
    });
    const keysModal = document.getElementById('keysModal');
    keysModal.addEventListener('click', (e) => { if (e.target === keysModal) keysModal.hidden = true; });
    document.getElementById('keysBtn')?.addEventListener('click', () => { keysModal.hidden = false; });
    document.querySelector('#diaryView .view-nav').addEventListener('click', (e) => {
        const b = e.target.closest('[data-nav]');
        if (b) updateMonth(b.dataset.nav);
    });
    document.querySelector('#yearView .view-nav').addEventListener('click', (e) => {
        const b = e.target.closest('[data-nav]');
        if (b) updateYear(b.dataset.nav);
    });
});

/** Bottom mode bar (mobile): Month / Week / Year / Diary as four peer modes. */
function setupModeBar() {
    const bar = document.getElementById('modeBar');
    if (!bar) return;
    document.querySelectorAll('.mode-item, .mode-seg-btn').forEach((b) => {
        b.addEventListener('click', () => setCalendarMode(b.dataset.mode));
    });
    updateBottomBar();
}

/** Switch the calendar's content mode (month/week grid or year/diary view). */
function setCalendarMode(mode) {
    if (mode === 'year') {
        toggleYearView(true);
    } else if (mode === 'diary') {
        toggleDiaryView(true);
    } else {
        toggleYearView(false);
        toggleDiaryView(false);
        toggleWeekView(mode === 'week');
    }
    updateBottomBar();
}

/** Reflect the active mode in the bottom bar (year/diary panel, else month/week). */
function updateBottomBar() {
    const bar = document.getElementById('modeBar');
    if (!bar) return;
    let mode;
    if (document.getElementById('yearView').classList.contains('active')) mode = 'year';
    else if (document.getElementById('diaryView').classList.contains('active')) mode = 'diary';
    else mode = viewState.mode;
    document.querySelectorAll('.mode-item, .mode-seg-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.mode === mode);
        b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    });
}

/** Jump every view back to today. */
async function goToToday() {
    viewState.year = CURRENT_YEAR;
    viewState.month = CURRENT_MONTH;
    viewState.weekAnchor = { year: CURRENT_YEAR, month: CURRENT_MONTH, day: CURRENT_DAY };
    await updateCalendarView();
    if (document.getElementById('yearView').classList.contains('active')) loadYearView(CURRENT_YEAR);
    updateBottomBar();
}
window.updateBottomBar = updateBottomBar;

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
        // day (month/week/year cells, diary entries) or is on our own overlays.
        // Diary and Year are full views now: they close by switching mode.
        const keepsPanel = t.closest(
            '#sidebar, #colorPicker, .day, .eye-icon, .week-grid, .year-day, .diary-day-head, .diary-event, #confirmModal, #toasts, #actionSheet, #viewer, #keysModal, #keysBtn'
        );
        if (!keepsPanel && sidebar.classList.contains('active')) {
            sidebar.classList.remove('active');
            if (window.innerWidth <= 480) sidebar.style.height = '';
            // Any half-written entry is kept as a draft (see day.js) and comes
            // back when this day is opened again.
            closeEntryForm();
        }
    });

    document.querySelector('.login-overlay').addEventListener('click', (e) => {
        // Signed out, the sign-in card *is* the page: it can't be dismissed.
        if (e.target === e.currentTarget && window.SIGNED_IN) closeLoginDialog();
    });
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
        } else if (!inInput) {
            toggleDiaryView(false);
            toggleYearView(false);
        }
        event.preventDefault();
        return;
    }
    if (inInput) return;
    if (!document.getElementById('confirmModal').hidden || !document.getElementById('viewer').hidden) return;

    if (event.key === '?') { keysSheet.hidden = !keysSheet.hidden; event.preventDefault(); return; }
    if (event.key === '/') {
        event.preventDefault();
        document.querySelector('.shell-tab[data-view="search"]')?.click();
        document.getElementById('searchInput').focus();
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
        case 'm': setCalendarMode('month'); break;
        case 'w': setCalendarMode('week'); break;
        case 'd': setCalendarMode('diary'); break;
        case 'y': setCalendarMode('year'); break;
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

/** Horizontal swipes on the calendar mirror the h/l keys: left = next, right
 *  = prev (works in both month and week mode, since updateMonth routes by
 *  view). A detected swipe suppresses the trailing click so it doesn't also
 *  open a day. Vertical-dominant gestures are left alone so week-grid/sidebar
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

    if (viewState.mode === 'week') {
        await shiftWeek(direction);
        return;
    }

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
    if (viewState.mode === 'week') {
        const a = viewState.weekAnchor;
        viewState.weekAnchor = { year: a.year + (direction === 'next' ? 1 : -1), month: a.month, day: a.day };
    }
    await updateCalendarView();
    if (document.getElementById('yearView').classList.contains('active')) loadYearView(viewState.year);
    updateBottomBar();
}

async function shiftWeek(direction) {
    const a = viewState.weekAnchor;
    const d = new Date(a.year, a.month - 1, a.day);
    d.setDate(d.getDate() + (direction === 'next' ? 7 : -7));
    viewState.weekAnchor = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
    viewState.year = viewState.weekAnchor.year;
    viewState.month = viewState.weekAnchor.month;
    await renderWeek();
}

async function updateCalendarView() {
    if (viewState.mode === 'week') {
        await renderWeek();
        return;
    }
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
        
        // Generate the new month HTML (inside #viewMonth so the sibling #viewWeek survives)
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
        updateBottomBar();
        
        // Refresh diary view if it's open
        if (document.getElementById('diaryView').classList.contains('active')) {
            loadMonthEvents();
        }

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

function toggleWeekView(show) {
    const monthGrid = document.getElementById('viewMonth');
    const weekGrid = document.getElementById('viewWeek');

    if (show === undefined) show = viewState.mode !== 'week';

    if (show) {
        if (viewState.mode !== 'week') {
            const inDisplayedMonth =
                viewState.year === CURRENT_YEAR && viewState.month === CURRENT_MONTH;
            viewState.weekAnchor = {
                year: viewState.year,
                month: viewState.month,
                day: inDisplayedMonth ? CURRENT_DAY : 1,
            };
        }
        viewState.mode = 'week';
        monthGrid.style.display = 'none';
        weekGrid.style.display = '';
        renderWeek();
    } else {
        viewState.mode = 'month';
        viewState.year = viewState.weekAnchor.year;
        viewState.month = viewState.weekAnchor.month;
        monthGrid.style.display = '';
        weekGrid.style.display = 'none';
        updateCalendarView();
    }
    updateBottomBar();
}

async function renderWeek() {
    const token = ++viewToken;
    const container = document.getElementById('calendarContainer');
    const dim = setTimeout(() => container.classList.add('loading'), 150);
    try {
        const a = viewState.weekAnchor;
        const response = await fetch(appUrl(`/get_week?year=${a.year}&month=${a.month}&day=${a.day}`));
        const data = await response.json();
        if (token !== viewToken) return;
        if (data.status !== 'success') throw new Error('week');

        document.getElementById('calTitle').textContent = data.week_label;
        updateBottomBar();

        const weekRoot = document.getElementById('viewWeek');
        const isMobile = window.innerWidth <= 480;
        const STEP = isMobile ? 2 : 1;  // hours per time-axis block/label
        const todayIsoForCards = isoFromDate(TODAY);
        if (isMobile) {   // phones: seven readable day cards instead of a time grid
            weekRoot.classList.add('week-cards');
            weekRoot.innerHTML = renderWeekCards(data, todayIsoForCards);
            return;
        }
        weekRoot.classList.remove('week-cards');

        const todayISO = `${CURRENT_YEAR}-${String(CURRENT_MONTH).padStart(2, '0')}-${String(CURRENT_DAY).padStart(2, '0')}`;
        const isoByIndex = data.days.map(d => d.date);

        const dayHeaders = data.days.map(d => `
            <div class="week-day-header ${d.date === todayISO ? 'today' : ''}"
                 onclick="openDayFromWeek(${d.year}, ${d.month}, ${d.day})">
                <div class="week-day-weekday">${d.weekday}</div>
                <div class="week-day-date">${d.day}</div>
            </div>
        `).join('');

        const allDayEvents = [];
        const timedEventsByISO = {};
        data.events.forEach(e => {
            const start = parseLocalDateTime(e.start_time);
            const end = e.end_time ? parseLocalDateTime(e.end_time) : new Date(start);
            const startISO = isoFromDate(start);
            const endISO = isoFromDate(end);
            const isAllDay = isAllDayEvent(e);
            const isMultiDay = startISO !== endISO;
            const enriched = { ...e, _start: start, _end: end, _startISO: startISO, _endISO: endISO };
            if (isAllDay || isMultiDay) {
                allDayEvents.push(enriched);
            } else {
                (timedEventsByISO[startISO] ||= []).push(enriched);
            }
        });

        const allDayBars = allDayEvents.map(e => {
            const startIdxRaw = isoByIndex.indexOf(e._startISO);
            const endIdxRaw = isoByIndex.indexOf(e._endISO);
            const startIdx = startIdxRaw === -1 ? 0 : startIdxRaw;
            const endIdx = endIdxRaw === -1 ? 6 : endIdxRaw;
            const colStart = startIdx + 2;
            const span = Math.max(1, endIdx - startIdx + 1);
            const anchorDay = data.days[startIdx];
            return `
                <div class="week-allday-block"
                     style="grid-column: ${colStart} / span ${span};"
                     onclick="openDayFromWeek(${anchorDay.year}, ${anchorDay.month}, ${anchorDay.day})"
                     title="${escapeHtml(e.name)}">
                    ${escapeHtml(e.name)}
                </div>
            `;
        }).join('');

        // Hour height: desktop uses the CSS token; mobile shrinks it so the
        // whole 24h day fits the (vertically-centered) viewport in one fixed
        // view, drawn in 2h blocks. Clamped to stay legible — below the floor
        // it falls back to scrolling. `reserved` is the title + day-header +
        // margins plus top/bottom breathing room that clears the fixed header.
        let HOUR_H;
        if (isMobile) {
            const reserved = 210 + (allDayEvents.length ? 34 : 0);
            HOUR_H = Math.max(13, Math.min(30, (window.innerHeight - reserved) / 24));
            weekRoot.style.setProperty('--hour-h', `${HOUR_H}px`);
            weekRoot.style.setProperty('--block-h', `${HOUR_H * STEP}px`);
        } else {
            weekRoot.style.removeProperty('--hour-h');
            weekRoot.style.removeProperty('--block-h');
            HOUR_H = parseFloat(getComputedStyle(weekRoot).getPropertyValue('--hour-h')) || 40;
        }

        const dayColumns = data.days.map(d => {
            const iso = d.date;
            const events = timedEventsByISO[iso] || [];
            const moodColor = data.mood_colors[iso];
            const hasMarker = data.markers.includes(iso);
            const isToday = iso === todayISO;
            const blocks = events.map(e => {
                const startMins = e._start.getHours() * 60 + e._start.getMinutes();
                const endMins = e.end_time
                    ? (e._end.getHours() * 60 + e._end.getMinutes())
                    : startMins + 30;
                const durMins = Math.max(20, endMins - startMins);
                const top = (startMins / 60) * HOUR_H;
                const height = (durMins / 60) * HOUR_H;
                const timeLabel = e.end_time
                    ? `${formatTimeOfDay(e._start)}–${formatTimeOfDay(e._end)}`
                    : formatTimeOfDay(e._start);
                return `
                    <div class="week-event-block" style="top: ${top}px; height: ${height}px;"
                         onclick="event.stopPropagation(); openDayFromWeek(${d.year}, ${d.month}, ${d.day})"
                         title="${escapeHtml(e.name)}">
                        <div class="week-event-time">${timeLabel}</div>
                        <div class="week-event-name">${escapeHtml(e.name)}</div>
                    </div>
                `;
            }).join('');
            return `
                <div class="week-day-column ${isToday ? 'today' : ''}"
                     data-iso="${iso}"
                     ${moodColor ? `style="background-color: ${moodColor};"` : ''}
                     onclick="openDayFromWeek(${d.year}, ${d.month}, ${d.day})">
                    ${blocks}
                    ${hasMarker ? '<div class="marker-indicator week-marker"></div>' : ''}
                </div>
            `;
        }).join('');

        const hourLabels = Array.from({ length: Math.ceil(24 / STEP) }, (_, i) =>
            `<div class="week-hour-label">${String(i * STEP).padStart(2, '0')}:00</div>`
        ).join('');

        weekRoot.innerHTML = `
            <div class="week-grid-header">
                <div class="week-corner"></div>
                ${dayHeaders}
            </div>
            ${allDayEvents.length > 0 ? `
                <div class="week-allday-row">
                    <div class="week-allday-label">All day</div>
                    ${allDayBars}
                </div>
            ` : ''}
            <div class="week-grid-body">
                <div class="week-time-gutter">${hourLabels}</div>
                ${dayColumns}
            </div>
        `;

        const body = weekRoot.querySelector('.week-grid-body');
        if (body) body.scrollTop = 7 * HOUR_H;
    } catch (error) {
        if (token !== viewToken) return;
        console.error('Error loading week:', error);
        toast("Couldn't load that week.", { error: true, action: 'Retry', onAction: () => renderWeek() });
    } finally {
        clearTimeout(dim);
        if (token === viewToken) container.classList.remove('loading');
    }
}

/** Week on a phone: one card per day with its mood, marker and entries. */
function renderWeekCards(data, todayIso) {
    return data.days.map((d) => {
        const date = new Date(d.year, d.month - 1, d.day);
        const color = data.mood_colors[d.date];
        const moodName = color ? ((window.MOODS || []).find((m) => m.color === color)?.name || '') : '';
        const entries = data.events.filter((e) => {
            const start = e.start_time.slice(0, 10);
            const end = (e.end_time || e.start_time).slice(0, 10);
            return start <= d.date && d.date <= end;
        });
        const list = entries.map((e) => `
            <li><span class="wc-time">${escapeHtml(entryTimeLabel(e, d.date))}</span>
                <span class="wc-name">${escapeHtml(e.name)}</span></li>`).join('');
        return `
            <button type="button" class="week-card${d.date === todayIso ? ' today' : ''}"
                    onclick="openDayFromWeek(${d.year}, ${d.month}, ${d.day})"
                    ${color ? `style="--mood: ${color}"` : ''}>
                <span class="wc-head">
                    <span class="wc-date">${escapeHtml(formatDate(date, { year: false }))}</span>
                    ${moodName ? `<span class="wc-mood"><span class="mood-dot" aria-hidden="true"></span>${escapeHtml(moodName)}</span>` : ''}
                    ${data.markers.includes(d.date) ? '<span class="diary-marker" aria-hidden="true"></span>' : ''}
                </span>
                ${list ? `<ul class="wc-entries">${list}</ul>` : '<span class="wc-empty">No entries</span>'}
            </button>`;
    }).join('');
}

function openDayFromWeek(year, month, day) {
    viewState.year = year;
    viewState.month = month;
    viewState.weekAnchor = { year, month, day };
    showSidebar(day);
}

function showLoginDialog() {
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('username').focus();
}

function closeLoginDialog() {
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('loginForm').reset();
    document.getElementById('loginError').style.display = 'none';
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

async function handleLogout() {
    try {
        if (window.PROXY_MODE) {
            // Behind the dashboard proxy there's no local session — log out of
            // the shared dashboard session, which deauths every app at once.
            await fetch('/logout', { method: 'POST', credentials: 'same-origin' });
            window.location.href = '/login';
            return;
        }
        const response = await fetch(appUrl('/auth/logout'));
        if (response.ok) {
            location.reload();
        }
    } catch (error) {
        console.error('Logout error:', error);
    }
}

function toggleSidebar(sidebarType, show) {
    const diaryView = document.getElementById('diaryView');
    const yearView = document.getElementById('yearView');
    
    // Determine which sidebar is primary and which is secondary based on type
    const primarySidebar = sidebarType === 'diary' ? diaryView : yearView;
    const secondarySidebar = sidebarType === 'diary' ? yearView : diaryView;
    
    // Determine whether to show or hide if not specified
    if (show === undefined) {
        show = !primarySidebar.classList.contains('active');
    }
    
    // Always close the secondary sidebar
    secondarySidebar.classList.remove('active');
    
    if (show) {
        // Load appropriate data based on sidebar type
        if (sidebarType === 'diary') {
            loadMonthEvents();
        } else {
            loadYearView(viewState.year);
        }

        // Show the sidebar. The `active` class lands next frame (so the slide-in
        // transition plays), so sync the bottom bar there too — otherwise it reads
        // the not-yet-active panel and the Year/Diary icon never highlights.
        requestAnimationFrame(() => {
            primarySidebar.classList.add('active');
            updateBottomBar();
        });
    } else {
        primarySidebar.classList.remove('active');
        updateBottomBar();
    }
}

function toggleDiaryView(show) {
    toggleSidebar('diary', show);
}

function toggleYearView(show) {
    toggleSidebar('year', show);
}

/** The Diary: one month to read back, day by day, with each day's mood,
 *  marker, entries (with their moments) and attachments. Days that only have
 *  a mood are listed too. */
async function loadMonthEvents() {
    const content = document.getElementById('diaryContent');
    const { year, month } = viewState;
    const monthLong = new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'long' });
    document.getElementById('diaryTitle').textContent =
        `Diary · ${new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`;
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
    diaryFiles = files;
    const days = [...new Set([
        ...Object.keys(entriesByDay), ...Object.keys(moodColors), ...Object.keys(files), ...markers,
    ].map(Number))].sort((a, b) => a - b);

    if (!days.length) {
        content.innerHTML = `<div class="no-events">No entries in ${escapeHtml(monthLong)}.</div>`;
        return;
    }
    const moodName = (color) => (window.MOODS || []).find((m) => m.color === color)?.name || '';
    const detail = (icon, text, extra = '') =>
        text ? `<div class="diary-event-detail ${extra}"><i class="fas ${icon}" aria-hidden="true"></i> ${escapeHtml(text)}</div>` : '';

    content.innerHTML = days.map((day) => {
        const date = new Date(year, month - 1, day);
        const iso = isoFromDate(date);
        const color = moodColors[day];
        const entries = (entriesByDay[day] || []).map((event) => {
            const moments = (event.subevents || []).filter((s) => s.start_time.startsWith(iso)).map((s) => `
                <div class="diary-subevent">
                    <div class="diary-subevent-title">${escapeHtml(s.name)}${s.where ? `<span class="diary-subevent-content"> · ${escapeHtml(s.where)}</span>` : ''}</div>
                    ${s.notes ? `<div class="diary-subevent-content">${escapeHtml(s.notes)}</div>` : ''}
                </div>`).join('');
            return `
                <div class="diary-event" data-day="${day}" role="button" tabindex="0">
                    <div class="diary-event-time log-gutter" title="${escapeHtml(entryTimeLabel(event, iso))}">${gutterTime(event, iso)}</div>
                    ${spanLine(event)}
                    <div class="diary-event-name">${escapeHtml(event.name)}</div>
                    ${detail('fa-user', event.with_who)}
                    ${detail('fa-map-marker-alt', event.where)}
                    ${detail('fa-sticky-note', event.notes, 'diary-event-notes')}
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
                    ${color ? `<span class="diary-mood" style="--mood: ${color}"><span class="mood-dot" aria-hidden="true"></span>${escapeHtml(moodName(color))}</span>` : ''}
                    ${markers.has(day) ? '<span class="diary-marker" aria-hidden="true"></span>' : ''}
                </button>
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

/** Year: twelve tappable month grids with moods, markers and entry dots. */
async function loadYearView(year, { keepScroll = false } = {}) {
    const yearContent = document.getElementById('yearContent');
    document.getElementById('yearTitle').textContent = String(year);
    if (!keepScroll) yearContent.innerHTML = '<div class="loading-indicator">Loading…</div>';
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
            <section class="year-month" id="year-month-${m.month}">
                <div class="year-month-title">${escapeHtml(name)}</div>
                <div class="year-month-grid">${weekdays}${blanks}${days}</div>
            </section>`;
    }).join('');
    if (year === CURRENT_YEAR && !keepScroll) {
        document.getElementById(`year-month-${CURRENT_MONTH}`)?.scrollIntoView({ block: 'start' });
    }
}

document.getElementById('yearContent').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="year-retry"]')) { loadYearView(viewState.year); return; }
    const cell = e.target.closest('.year-day[data-day]');
    if (!cell) return;
    // Open that day over the year view; the month view underneath follows.
    viewState.month = Number(cell.dataset.month);
    viewState.weekAnchor = { year: viewState.year, month: viewState.month, day: Number(cell.dataset.day) };
    updateCalendarView();
    showSidebar(Number(cell.dataset.day));
});
