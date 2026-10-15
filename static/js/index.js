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

/** Parse a "YYYY-MM-DD HH:MM" string into form-ready {date: "DD-MM-YYYY", time: "HH:MM"}. */
function parseDateTime(dateTimeStr) {
    if (!dateTimeStr) return { date: '', time: '' };
    const [datePart, timePart] = dateTimeStr.split(' ');
    const [year, month, day] = datePart.split('-');
    return { date: `${day}-${month}-${year}`, time: timePart };
}

/** Parse "YYYY-MM-DD HH:MM" as a local-time Date — explicit to dodge browser parsing differences. */
function parseLocalDateTime(str) {
    const [datePart, timePart] = str.split(' ');
    const [y, m, d] = datePart.split('-').map(Number);
    const [hh, mm] = (timePart || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm);
}

/** Format a Date as a local "YYYY-MM-DD" ISO date string. */
function isoFromDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    document.getElementById('diaryViewBtn').addEventListener('click', () => {
        toggleDiaryView();
    });
    document.getElementById('yearViewBtn').addEventListener('click', () => {
        toggleYearView();
    });
    document.getElementById('viewSelect').addEventListener('change', (e) => {
        toggleWeekView(e.target.value === 'week');
    });
    setupModeBar();
});

/** Bottom mode bar (mobile): Month / Week / Year / Diary as four peer modes. */
function setupModeBar() {
    const bar = document.getElementById('modeBar');
    if (!bar) return;
    bar.querySelectorAll('.mode-item').forEach((b) => {
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
    bar.querySelectorAll('.mode-item').forEach((b) => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
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
        const diaryView = document.getElementById('diaryView');
        const yearView = document.getElementById('yearView');

        const isInteractiveClick = event.target.closest(
            '#sidebar, #colorPicker, .day, .eye-icon, #diaryView, #diaryViewBtn, #yearView, #yearViewBtn, #viewSelect, .shell-menu, .week-grid, #confirmModal, #toasts, #actionSheet'
        );

        if (!isInteractiveClick) {
            colorPickerEl.style.display = 'none';
            moodPickerMenuOpen = false;
            moodPickerSelectedDay = null;

            sidebar.classList.remove('active');
            if (window.innerWidth <= 480) {
                sidebar.style.height = '';
            }

            diaryView.classList.remove('active');
            yearView.classList.remove('active');
            // Any half-written entry is kept as a draft (see day.js) and comes
            // back when this day is opened again.
            closeEntryForm();
        }
    });

    document.querySelector('.login-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeLoginDialog();
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
    const inInput = event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA';

    if (event.key === 'Escape') {
        // Close the entry form but keep what was typed (it's restored next time).
        if (entryForm) {
            closeEntryForm();
            toast('Draft kept');
        } else if (!inInput) {
            toggleDiaryView(false);
            toggleYearView(false);
        }
        event.preventDefault();
        return;
    }

    if (inInput) return;

    switch (event.key) {
        case 'h': updateMonth('prev'); break;
        case 'l': updateMonth('next'); break;
        case 'k': updateYear('prev'); break;
        case 'j': updateYear('next'); break;
        case 'd': toggleDiaryView(); break;
        case 'y': toggleYearView(); break;
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
        document.querySelector('h1').textContent = data.month_label;
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
                <div class="day current-month ${(viewState.year < CURRENT_YEAR ||
                        (viewState.year === CURRENT_YEAR && viewState.month < CURRENT_MONTH) ||
                        (viewState.year === CURRENT_YEAR && viewState.month === CURRENT_MONTH && day < CURRENT_DAY))
                        ? 'past' : ''}"
                     data-day="${day}"
                     onclick="showSidebar(${day})"
                     ${data.mood_colors[day] ? `style="background-color: ${data.mood_colors[day]}"` : ''}>
                    ${data.days_with_events.includes(day) ? '<div class="event-indicator"></div>' : ''}
                    ${data.days_with_marker.includes(day) ? '<div class="marker-indicator"></div>' : ''}
                </div>
            `).join('')}
            ${data.calendar_data.next_days.map(day => `
                <div class="day next-month" data-day="${day}"></div>
            `).join('')}
        `;

        document.getElementById('viewMonth').innerHTML = monthInner;
        setupMonthGridListeners();
        
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
    const select = document.getElementById('viewSelect');
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
        if (select) select.value = 'week';
        renderWeek();
    } else {
        viewState.mode = 'month';
        viewState.year = viewState.weekAnchor.year;
        viewState.month = viewState.weekAnchor.month;
        monthGrid.style.display = '';
        weekGrid.style.display = 'none';
        if (select) select.value = 'month';
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

        document.querySelector('h1').textContent = data.week_label;

        const weekRoot = document.getElementById('viewWeek');
        const isMobile = window.innerWidth <= 480;
        const STEP = isMobile ? 2 : 1;  // hours per time-axis block/label

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
                    ? `${formatTimeOfDay(e._start)} - ${formatTimeOfDay(e._end)}`
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
                    <div class="week-allday-label">all-day</div>
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

function openDayFromWeek(year, month, day) {
    viewState.year = year;
    viewState.month = month;
    viewState.weekAnchor = { year, month, day };
    showSidebar(day);
}

function showLoginDialog() {
    $('#loginOverlay').css('display', 'flex').fadeIn();
    $('#username').focus();
}

function closeLoginDialog() {
    $('#loginOverlay').fadeOut();
    $('#loginForm')[0].reset();
    $('#loginError').hide();
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
            $('#loginError').text(data.error).show();
        }
    } catch (error) {
        console.error('Login error:', error);
        $('#loginError').text('An error occurred. Please try again.').show();
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

async function loadMonthEvents() {
    const diaryContent = document.getElementById('diaryContent');
    diaryContent.innerHTML = '<div class="loading-indicator">Loading events...</div>';
    
    try {
        const response = await fetch(appUrl(`/events/month?year=${viewState.year}&month=${viewState.month}`));
        const data = await response.json();
        
        if (data.status === 'success') {
            if (data.events.length === 0) {
                diaryContent.innerHTML = '<div class="no-events">No events this month</div>';
                return;
            }

            const eventsByDay = {};
            data.events.forEach(event => {
                const startDate = parseLocalDateTime(event.start_time);
                const endDate = parseLocalDateTime(event.end_time || event.start_time);
                
                // Create a copy of start date to iterate through
                let currentDate = new Date(startDate);
                
                // Loop through all days of the event
                while (currentDate <= endDate) {
                    // Only include days in the current month view
                    if (currentDate.getMonth() + 1 === viewState.month && 
                        currentDate.getFullYear() === viewState.year) {
                        
                        const day = currentDate.getDate();
                        if (!eventsByDay[day]) {
                            eventsByDay[day] = [];
                        }
                        
                        // Only add the event once per day
                        if (!eventsByDay[day].some(e => e.id === event.id)) {
                            eventsByDay[day].push(event);
                        }
                    }
                    currentDate.setDate(currentDate.getDate() + 1);
                }
            });
            
            // Sort days and create HTML
            let html = '';
            Object.keys(eventsByDay)
                .sort((a, b) => parseInt(a) - parseInt(b))
                .forEach(day => {
                    const date = new Date(viewState.year, viewState.month - 1, day);
                    const dateString = date.toLocaleDateString('en-GB', { 
                        weekday: 'short', 
                        day: 'numeric', 
                        month: 'short' 
                    });
                    
                    html += `<div class="diary-day">
                        <div class="diary-date">${dateString}</div>
                        <div class="diary-events">`;
                    
                    eventsByDay[day].forEach(event => {
                        const daySubevents = (event.subevents || []).filter(s => {
                            const d = parseLocalDateTime(s.start_time);
                            return d.getDate() === parseInt(day) &&
                                   d.getMonth() + 1 === viewState.month &&
                                   d.getFullYear() === viewState.year;
                        });

                        html += `
                            <div class="diary-event" onclick="showSidebar(${day})">
                                <div class="diary-event-time">${formatEventTime(event, parseInt(day))}</div>
                                <div class="diary-event-name">${escapeHtml(event.name)}</div>
                                ${event.with_who ? `<div class="diary-event-detail"><i class="fas fa-user"></i> ${escapeHtml(event.with_who)}</div>` : ''}
                                ${event.where ? `<div class="diary-event-detail"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(event.where)}</div>` : ''}
                                ${event.notes ? `<div class="diary-event-detail diary-event-notes"><i class="fas fa-sticky-note"></i> ${escapeHtml(event.notes)}</div>` : ''}
                                ${daySubevents.map(s => `
                                    <div class="diary-subevent">
                                        <div class="diary-subevent-title">${escapeHtml(s.name)}${s.where ? `<span class="diary-subevent-content">&nbsp;&nbsp;(${escapeHtml(s.where)})</span>` : ''}</div>
                                        ${s.notes ? `<div class="diary-subevent-content">${escapeHtml(s.notes)}</div>` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        `;
                    });
                    
                    html += `</div></div>`;
                });
            
            diaryContent.innerHTML = html;
        } else {
            diaryContent.innerHTML = '<div class="error-message">Failed to load events</div>';
        }
    } catch (error) {
        console.error('Error loading month events:', error);
        diaryContent.innerHTML = '<div class="error-message">Error loading events</div>';
    }
}

function formatEventTime(event, displayDay) {
    if (isAllDayEvent(event)) return '';

    const eventStart = parseLocalDateTime(event.start_time);
    const eventEnd = parseLocalDateTime(event.end_time || event.start_time);
    const isMultiDay = eventStart.toDateString() !== eventEnd.toDateString();

    if (isMultiDay) {
        const startOfDay = '00:00';
        const endOfDay = '23:59';

        const isStartDay = eventStart.getDate() === displayDay
            && eventStart.getMonth() === viewState.month - 1
            && eventStart.getFullYear() === viewState.year;
        if (isStartDay) {
            if (eventStart.getHours() === 0 && eventStart.getMinutes() === 0) {
                return `${startOfDay} - ${endOfDay}`;
            }
            return `${formatTimeOfDay(eventStart)} - ${endOfDay}`;
        }

        const isEndDay = eventEnd.getDate() === displayDay
            && eventEnd.getMonth() === viewState.month - 1
            && eventEnd.getFullYear() === viewState.year;
        if (isEndDay) {
            if (eventEnd.getHours() === 23 && eventEnd.getMinutes() === 59) {
                return `${startOfDay} - ${endOfDay}`;
            }
            return `${startOfDay} - ${formatTimeOfDay(eventEnd)}`;
        }

        return '';
    }

    const startTime = formatTimeOfDay(eventStart);
    const endTime = event.end_time ? formatTimeOfDay(eventEnd) : '';
    return endTime ? `${startTime} - ${endTime}` : startTime;
}

// Add these year view functions
async function loadYearView(year) {
    const yearContent = document.getElementById('yearContent');
    yearContent.innerHTML = '<div class="loading-indicator">Loading year data...</div>';
    
    try {
        const response = await fetch(appUrl(`/get_year?year=${year}`));
        const data = await response.json();
        
        if (data.status === 'success') {
            let html = '';
            
            // Create each month grid
            data.months.forEach(month => {
                const monthName = new Date(year, month.month - 1, 1).toLocaleDateString('en-GB', { month: 'long' });
                
                html += `
                <div class="year-month">
                    <div class="year-month-title">${monthName}</div>
                    <div class="year-month-grid">
                `;
                
                // Weekday headers
                ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(day => {
                    html += `<div class="year-weekday">${day}</div>`;
                });
                
                // Previous month days
                month.calendar_data.prev_days.forEach(day => {
                    html += `<div class="year-day year-prev-month" data-day="${day}"></div>`;
                });
                
                // Current month days with mood colors
                month.calendar_data.current_days.forEach(day => {
                    const hasColor = month.mood_colors[day];
                    html += `
                        <div class="year-day year-current-month" 
                            data-day="${day}"
                            ${hasColor ? `style="background-color: ${month.mood_colors[day]}"` : ''}>
                        </div>
                    `;
                });
                
                // Next month days
                month.calendar_data.next_days.forEach(day => {
                    html += `<div class="year-day year-next-month" data-day="${day}"></div>`;
                });
                
                html += `</div></div>`;
            });
            
            yearContent.innerHTML = html;
        } else {
            yearContent.innerHTML = '<div class="error-message">Failed to load year data</div>';
        }
    } catch (error) {
        console.error('Error loading year data:', error);
        yearContent.innerHTML = '<div class="error-message">Error loading year data</div>';
    }
}
