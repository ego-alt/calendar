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

let isLoading = false;
let currentOpenDay = null;

/** Shared by color picker UI (eye icon, options, document dismiss). */
let moodPickerSelectedDay = null;
let moodPickerMenuOpen = false;

let globalListenersAttached = false;

/** Format a Date or "YYYY-MM-DD HH:MM" string as "HH:MM" (24h). */
function formatTimeOfDay(input) {
    const date = input instanceof Date ? input : new Date(input);
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
        option.addEventListener('click', async () => {
            if (moodPickerSelectedDay) {
                const moodKey = option.dataset.mood;
                const color = window.getComputedStyle(option).backgroundColor;

                try {
                    const response = await fetch(appUrl('/mood/update'), {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            year: viewState.year,
                            month: viewState.month,
                            day: moodPickerSelectedDay.dataset.day,
                            mood: moodKey
                        })
                    });

                    const data = await response.json();

                    if (data.status === 'success') {
                        moodPickerSelectedDay.style.backgroundColor = color;
                    } else {
                        console.error('Failed to update mood:', data.message);
                    }
                } catch (error) {
                    console.error('Error updating mood:', error);
                }

                colorPicker.style.display = 'none';
                moodPickerMenuOpen = false;
                moodPickerSelectedDay = null;
            }
        });
    });

    document.addEventListener('click', (event) => {
        const sidebar = document.getElementById('sidebar');
        const colorPickerEl = document.getElementById('colorPicker');
        const diaryView = document.getElementById('diaryView');
        const yearView = document.getElementById('yearView');

        const isInteractiveClick = event.target.closest(
            '#sidebar, #colorPicker, .day, .eye-icon, .subevent-form-container, .event-actions, #diaryView, #diaryViewBtn, #yearView, #yearViewBtn, #viewSelect, .shell-menu, .week-grid'
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

            const subEventForms = document.querySelectorAll('.subevent-form-container');
            subEventForms.forEach(form => form.remove());
            toggleEventForm(false);
        }
    });

    setupTimeInputs();

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

    document.querySelectorAll('.day').forEach(day => {
        const eyeIcon = document.createElement('i');
        eyeIcon.className = 'fas fa-eye eye-icon';
        day.appendChild(eyeIcon);

        eyeIcon.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            if (moodPickerMenuOpen && moodPickerSelectedDay === day && day.style.backgroundColor) {
                // Clear the mood
                try {
                    const response = await fetch(appUrl('/mood/update'), {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            year: viewState.year,
                            month: viewState.month,
                            day: day.dataset.day,
                            mood: null
                        })
                    });
                    
                    const data = await response.json();
                    if (data.status === 'success') {
                        day.style.backgroundColor = '';
                        colorPicker.style.display = 'none';
                        moodPickerMenuOpen = false;
                        moodPickerSelectedDay = null;
                    } else {
                        console.error('Failed to clear mood:', data.message);
                    }
                } catch (error) {
                    console.error('Error clearing mood:', error);
                }
            } else {
                // Show color picker with position based on screen size
                moodPickerSelectedDay = day;
                moodPickerMenuOpen = true;
                colorPicker.style.display = 'flex';
                
                // Position color picker based on screen width
                if (window.innerWidth > 480) {
                    // Desktop: Position next to clicked day
                    const rect = day.getBoundingClientRect();
                    colorPicker.style.left = `${rect.left - 44}px`;
                    colorPicker.style.top = `${rect.top}px`;
                } else {
                    // Mobile: Position at bottom
                    const calendar = document.getElementById('calendarContainer');
                    const calendarRect = calendar.getBoundingClientRect();
                    colorPicker.style.left = '50%';
                    colorPicker.style.top = `${calendarRect.bottom - 16}px`;
                }
            }
        });
    });

    document.querySelectorAll('.day.current-month').forEach(day => {
        day.addEventListener('dblclick', async (e) => {
            e.stopPropagation();

            try {
                const response = await fetch(appUrl('/mood/marker/toggle'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        year: viewState.year,
                        month: viewState.month,
                        day: day.dataset.day,
                    })
                });

                const data = await response.json();
                if (data.status === 'success') {
                    let indicator = day.querySelector('.marker-indicator');
                    if (data.has_marker) {
                        if (!indicator) {
                            indicator = document.createElement('div');
                            indicator.className = 'marker-indicator';
                            day.appendChild(indicator);
                        }
                    } else {
                        if (indicator) indicator.remove();
                    }
                }
            } catch (error) {
                console.error('Error toggling period:', error);
            }
        });
    });
}

function handleKeyPress(event) {
    const inInput = event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA';

    if (event.key === 'Escape') {
        toggleSubEventForm(false);
        if (!inInput) {
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
    if (isLoading) return;

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
    if (isLoading) return;
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
    isLoading = true;

    try {
        const response = await fetch(appUrl(`/get_month?year=${viewState.year}&month=${viewState.month}`));
        const data = await response.json();
        
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
        console.error('Error updating calendar:', error);
    } finally {
        isLoading = false;
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
    if (isLoading) return;
    isLoading = true;
    try {
        const a = viewState.weekAnchor;
        const response = await fetch(appUrl(`/get_week?year=${a.year}&month=${a.month}&day=${a.day}`));
        const data = await response.json();
        if (data.status !== 'success') {
            console.error('Failed to load week data');
            return;
        }

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
        console.error('Error loading week:', error);
    } finally {
        isLoading = false;
    }
}

function openDayFromWeek(year, month, day) {
    viewState.year = year;
    viewState.month = month;
    viewState.weekAnchor = { year, month, day };
    showSidebar(day);
}

async function showSidebar(day) {
    const sidebar = document.getElementById('sidebar');
    const sidebarContent = document.getElementById('sidebarContent');

    // Clear any leftover inline height so the drawer opens at its CSS default.
    if (window.innerWidth <= 480) {
        sidebar.style.height = '';
    }
    requestAnimationFrame(() => {sidebar.classList.add('active');});
    currentOpenDay = day;
    toggleEventForm(false);
    
    try {
        const dayQuery = `year=${viewState.year}&month=${viewState.month}&day=${day}`;
        const [eventsResponse, attachmentsResponse] = await Promise.all([
            fetch(appUrl(`/events?${dayQuery}`)),
            fetch(appUrl(`/attachments?${dayQuery}`)),
        ]);
        const data = await eventsResponse.json();
        const attachmentsData = await attachmentsResponse.json();

        if (data.status === 'success') {
            const date = new Date(viewState.year, viewState.month - 1, day);
            const dateString = `${day} ${date.toLocaleDateString('en-GB', { month: 'long' })}`;
            const attachments = attachmentsData.status === 'success' ? attachmentsData.attachments : [];

            let html = `
                <div class="sidebar-header">
                    <span>${dateString}</span>
                    <label class="attachment-upload-btn" title="Add attachment">
                        <input type="file" multiple style="display:none" onchange="handleAttachmentUpload(event)">
                        <i class="fas fa-plus"></i>
                    </label>
                </div>
                <div class="event-list">`;
            
            if (data.events.length === 0) {
                html += `<div class="no-events">No events scheduled</div>`;
            } else {
                data.events.forEach(event => {
                    // Start building the event card HTML
                    let eventHtml = `
                        <div class="event-card" data-event-id="${event.id}">
                            <div class="event-actions">
                                <i class="fas fa-edit" onclick="editEvent(${event.id})"></i>
                                <i class="fas fa-trash" onclick="deleteEvent(${event.id})"></i>
                                <i class="fas fa-plus-circle" onclick="toggleSubEventForm(true, '${date.toDateString()}', ${event.id})" title="Subevent"></i>
                            </div>
                            <div class="event-time">
                                ${formatEventDisplay(event)}
                            </div>
                            <div class="event-name">${event.name}</div>
                            <div class="event-details">
                                ${event.with_who ? `<div class="event-detail-item"><i class="fas fa-user"></i> ${event.with_who}</div>` : ''}
                                ${event.where ? `<div class="event-detail-item"><i class="fas fa-map-marker-alt"></i> ${event.where}</div>` : ''}
                                ${event.notes ? `<div class="event-detail-item"><i class="fas fa-sticky-note"></i> ${event.notes}</div>` : ''}
                            </div>
                    `;
                    
                    // Add subevents directly to the event card HTML if they exist
                    if (event.subevents && event.subevents.length > 0) {
                        eventHtml += `<div class="subevents-container" id="subevents-${event.id}">
                            <div class="subevents-list">`;
                        
                        event.subevents.forEach(subevent => {
                            eventHtml += `
                                <div class="subevent-card" data-subevent-id="${subevent.id}">
                                    <div class="subevent-actions">
                                        <i class="fas fa-edit" onclick="editSubEvent(${subevent.id}, ${event.id})"></i>
                                        <i class="fas fa-trash" onclick="deleteSubEvent(${subevent.id}, ${event.id})"></i>
                                    </div>
                                    <div class="subevent-time">${formatSubEventTime(subevent)}</div>
                                    <div class="subevent-name">${subevent.name}</div>
                                    <div class="subevent-details">
                                        ${subevent.with_who ? `<div class="subevent-detail-item"><i class="fas fa-user"></i> ${subevent.with_who}</div>` : ''}
                                        ${subevent.where ? `<div class="subevent-detail-item"><i class="fas fa-map-marker-alt"></i> ${subevent.where}</div>` : ''}
                                        ${subevent.notes ? `<div class="subevent-detail-item"><i class="fas fa-sticky-note"></i> ${subevent.notes}</div>` : ''}
                                    </div>
                                </div>
                            `;
                        });
                        
                        eventHtml += `</div></div>`;
                    }
                    
                    // Close the event card div
                    eventHtml += `</div>`;
                    
                    // Add the complete event card to the main HTML
                    html += eventHtml;
                });
            }
            
            html += `</div>`;
            html += `<button class="add-event-btn btn btn-primary" onclick="toggleEventForm(true)">Add Event</button>`;
            html += renderAttachmentsSection(attachments);
            sidebarContent.innerHTML = html;
        }
    } catch (error) {
        console.error('Error fetching events:', error);
        sidebarContent.innerHTML = '<div class="no-events">Error loading events</div>';
    }
    
    // Close any open subevent forms
    toggleSubEventForm(false);
}

function formatSubEventTime(subevent) {
    const startTime = formatTimeOfDay(subevent.start_time);
    const endTime = subevent.end_time ? formatTimeOfDay(subevent.end_time) : '';
    return endTime ? `${startTime} - ${endTime}` : startTime;
}

function toggleSubEventForm(show, parentDate = null, eventId = null, subEventId = null) {
    // Remove any existing subevent forms first
    const existingForms = document.querySelectorAll('.subevent-form-container');
    existingForms.forEach(form => form.remove());
    
    if (!show) return;
    
    if (show && eventId) {
        // Find the parent event card
        const eventCard = document.querySelector(`.event-card[data-event-id="${eventId}"]`);
        if (!eventCard) return;
        
        // Create the form container
        const formContainer = document.createElement('div');
        formContainer.className = 'subevent-form-container';
        
        const isEdit = subEventId !== null;
        const headerText = isEdit ? 'Edit Subevent' : 'Add Subevent';
        
        formContainer.innerHTML = `
            <div class="subevent-form-header">${headerText}</div>
            <form id="newSubEventForm" data-event-id="${eventId}" ${isEdit ? `data-subevent-id="${subEventId}"` : ''}>
                <input class="input" type="text" id="subEventName" placeholder="Subevent Name" required>
                <div class="form-row">
                    <input type="text" id="subStartDate" class="input date-input" placeholder="DD-MM-YYYY" required>
                    <input type="text" id="subStartTime" class="input time-input" placeholder="HH:MM">
                </div>
                <div class="form-row">
                    <input type="text" id="subEndDate" class="input date-input" placeholder="DD-MM-YYYY">
                    <input type="text" id="subEndTime" class="input time-input" placeholder="HH:MM">
                </div>
                <input class="input" type="text" id="subEventWith" placeholder="Who">
                <input class="input" type="text" id="subEventLocation" placeholder="Where">
                <textarea id="subEventNotes" placeholder="Notes"></textarea>
                <div class="form-buttons">
                    <button type="button" class="cancel-btn btn btn-secondary" onclick="toggleSubEventForm(false)">Cancel</button>
                    <button type="button" class="save-btn btn btn-primary" id="saveSubEventBtn">Save</button>
                </div>
            </form>
        `;
        
        // Find where to insert the form
        if (isEdit) {
            const subEventCard = eventCard.querySelector(`.subevent-card[data-subevent-id="${subEventId}"]`);
            if (subEventCard) {
                subEventCard.parentNode.insertBefore(formContainer, subEventCard.nextSibling);
            } else {
                insertFormIntoEventCard(eventCard, formContainer);
            }
            
            // Populate form with existing data if editing
            populateSubEventForm(eventId, subEventId);
        } else {
            insertFormIntoEventCard(eventCard, formContainer);
            if (parentDate) {
                parentDate = new Date(parentDate);
                const day = String(parentDate.getDate()).padStart(2, '0');
                const month = String(parentDate.getMonth() + 1).padStart(2, '0');
                const year = parentDate.getFullYear();
                
                const formattedDate = `${day}-${month}-${year}`;
                document.getElementById('subStartDate').value = formattedDate;
                document.getElementById('subEndDate').value = formattedDate;
            }
        }
        
        // Setup time/date inputs
        setupTimeInputs();
        
        // Focus on the first input field
        document.getElementById('subEventName').focus();
        
        // Add click handler to the save button instead of form submit
        document.getElementById('saveSubEventBtn').addEventListener('click', function() {
            const form = document.getElementById('newSubEventForm');
            const eventId = parseInt(form.dataset.eventId);
            const subEventId = form.dataset.subEventId ? parseInt(form.dataset.subEventId) : null;
            
            // Validate required fields
            if (!document.getElementById('subEventName').value || 
                !document.getElementById('subStartDate').value) {
                alert('Please fill in all required fields');
                return;
            }
            
            const formData = {
                name: document.getElementById('subEventName').value,
                start_date: document.getElementById('subStartDate').value,
                start_time: document.getElementById('subStartTime').value || null,
                end_date: document.getElementById('subEndDate').value,
                end_time: document.getElementById('subEndTime').value || null,
                where: document.getElementById('subEventLocation').value || null,
                with_who: document.getElementById('subEventWith').value || null,
                notes: document.getElementById('subEventNotes').value || null
            };
            
            // Determine if this is an edit or a new subevent
            const method = subEventId ? 'PUT' : 'POST';
            const url = subEventId ?
                appUrl(`/events/subevents/${subEventId}`) :
                appUrl(`/events/${eventId}/subevents`);

            fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            })
            .then(response => {
                return response.json();
            })
            .then(data => {
                if (data.status === 'success') {
                    toggleSubEventForm(false);
                    // Refresh the entire sidebar instead of just the subevents
                    showSidebar(currentOpenDay);
                } else {
                    console.error('Failed to save subevent:', data.message);
                    alert('Error: ' + data.message);
                }
            })
            .catch(error => {
                alert('An error occurred while saving the subevent.');
            });
        });
    }
}

function insertFormIntoEventCard(eventCard, formContainer) {
    const subeventsContainer = eventCard.querySelector('.subevents-container');
    if (subeventsContainer) {
        eventCard.insertBefore(formContainer, subeventsContainer);
    } else {
        eventCard.appendChild(formContainer);
    }
}

async function populateSubEventForm(eventId, subEventId) {
    try {
        const response = await fetch(appUrl(`/events/subevents/${subEventId}`));
        const data = await response.json();

        if (data.status === 'success') {
            const subevent = data.subevent;

            if (subevent) {
                const form = document.getElementById('newSubEventForm');
                form.dataset.subEventId = subEventId;

                const startDateTime = parseDateTime(subevent.start_time);
                const endDateTime = parseDateTime(subevent.end_time);
                
                // Populate form
                document.getElementById('subEventName').value = subevent.name;
                document.getElementById('subStartDate').value = startDateTime.date;
                document.getElementById('subStartTime').value = startDateTime.time;
                document.getElementById('subEndDate').value = endDateTime.date || startDateTime.date;
                document.getElementById('subEndTime').value = endDateTime.time || '';
                document.getElementById('subEventWith').value = subevent.with_who || '';
                document.getElementById('subEventLocation').value = subevent.where || '';
                document.getElementById('subEventNotes').value = subevent.notes || '';
            }
        }
    } catch (error) {
        console.error('Error fetching subevent details:', error);
        alert('Error loading subevent details. Please try again.');
    }
}

function toggleEventForm(show) {
    const eventForm = document.getElementById('eventForm');
    const form = document.getElementById('newEventForm');
    
    // Close any open subevent forms
    toggleSubEventForm(false);
    
    eventForm.style.display = show ? 'block' : 'none';
    if (show) {
        form.reset();
        // Set the date values based on the currently selected day
        const formattedDate = `${String(currentOpenDay).padStart(2, '0')}-${String(viewState.month).padStart(2, '0')}-${viewState.year}`;
        document.getElementById('startDate').value = formattedDate;
        document.getElementById('endDate').value = formattedDate;
    }
}

document.getElementById('newEventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const form = e.target;
    const formData = {
        name: document.getElementById('eventName').value,
        start_date: document.getElementById('startDate').value,
        start_time: document.getElementById('startTime').value || null,
        end_date: document.getElementById('endDate').value,
        end_time: document.getElementById('endTime').value || null,
        where: document.getElementById('eventLocation').value || null,
        with_who: document.getElementById('eventWith').value || null,
        notes: document.getElementById('eventNotes').value || null
    };
    
    try {
        const eventId = form.dataset.eventId;
        const method = eventId ? 'PUT' : 'POST';
        const url = eventId ? appUrl(`/events/${eventId}`) : appUrl('/events');

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            toggleEventForm(false);
            showSidebar(currentOpenDay);
            await updateCalendarView();
        } else {
            console.error('Failed to save event:', data.message);
        }
    } catch (error) {
        console.error('Error saving event:', error);
    }
});

async function editEvent(eventId) {
    // Remove any existing event edit forms first
    const existingForms = document.querySelectorAll('.event-form-container');
    existingForms.forEach(form => form.remove());
    
    // Close any open subevent forms
    toggleSubEventForm(false);
    
    // Find the parent event card
    const eventCard = document.querySelector(`.event-card[data-event-id="${eventId}"]`);
    if (!eventCard) return;
    
    // Create the form container
    const formContainer = document.createElement('div');
    formContainer.className = 'event-form-container';
    
    formContainer.innerHTML = `
        <div class="event-form-header">Edit Event</div>
        <form id="editEventForm" data-event-id="${eventId}">
            <input class="input" type="text" id="inlineEventName" placeholder="Event Name" required>
            <div class="form-row">
                <input type="text" id="inlineStartDate" class="input date-input" placeholder="DD-MM-YYYY" required>
                <input type="text" id="inlineStartTime" class="input time-input" placeholder="HH:MM">
            </div>
            <div class="form-row">
                <input type="text" id="inlineEndDate" class="input date-input" placeholder="DD-MM-YYYY">
                <input type="text" id="inlineEndTime" class="input time-input" placeholder="HH:MM">
            </div>
            <input class="input" type="text" id="inlineEventWith" placeholder="With Who">
            <input class="input" type="text" id="inlineEventLocation" placeholder="Where">
            <textarea id="inlineEventNotes" placeholder="Notes"></textarea>
            <div class="form-buttons">
                <button type="button" class="cancel-btn btn btn-secondary" onclick="closeEventEditForm()">Cancel</button>
                <button type="button" class="save-btn btn btn-primary" id="saveInlineEventBtn">Save</button>
            </div>
        </form>
    `;
    
    // Insert the form after the event card's content
    eventCard.appendChild(formContainer);
    
    // Populate form with existing data
    populateEventEditForm(eventId);
    
    // Setup time/date inputs
    setupTimeInputs();
    
    // Focus on the first input field
    document.getElementById('inlineEventName').focus();
    
    // Add click handler to the save button
    formContainer.querySelector('#saveInlineEventBtn').addEventListener('click', async function() {
        const form = document.getElementById('editEventForm');
        const eventId = parseInt(form.dataset.eventId);
        
        // Validate required fields
        if (!document.getElementById('inlineEventName').value || 
            !document.getElementById('inlineStartDate').value) {
            alert('Please fill in all required fields');
            return;
        }
        
        const formData = {
            name: document.getElementById('inlineEventName').value,
            start_date: document.getElementById('inlineStartDate').value,
            start_time: document.getElementById('inlineStartTime').value || null,
            end_date: document.getElementById('inlineEndDate').value,
            end_time: document.getElementById('inlineEndTime').value || null,
            where: document.getElementById('inlineEventLocation').value || null,
            with_who: document.getElementById('inlineEventWith').value || null,
            notes: document.getElementById('inlineEventNotes').value || null
        };
        
        try {
            const response = await fetch(appUrl(`/events/${eventId}`), {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            });
            
            const data = await response.json();
            if (data.status === 'success') {
                closeEventEditForm();
                showSidebar(currentOpenDay);
            } else {
                console.error('Failed to update event:', data.message);
                alert('Error: ' + data.message);
            }
        } catch (error) {
            console.error('Error updating event:', error);
            alert('An error occurred while updating the event.');
        }
    });
    const inlineCancel = formContainer.querySelector('.cancel-btn');
    if (inlineCancel) {
        inlineCancel.addEventListener('click', function(e) {
            e.stopPropagation();
            closeEventEditForm();
        });
    }
}

function closeEventEditForm() {
    const eventForms = document.querySelectorAll('.event-form-container');
    eventForms.forEach(form => form.remove());
}

async function populateEventEditForm(eventId) {
    try {
        const response = await fetch(appUrl(`/events?year=${viewState.year}&month=${viewState.month}&day=${currentOpenDay}`));
        const data = await response.json();
        
        if (data.status === 'success') {
            const event = data.events.find(e => e.id === eventId);
            
            if (event) {
                const startDateTime = parseDateTime(event.start_time);
                const endDateTime = parseDateTime(event.end_time);
                
                // Populate form
                document.getElementById('inlineEventName').value = event.name;
                document.getElementById('inlineStartDate').value = startDateTime.date;
                document.getElementById('inlineStartTime').value = startDateTime.time;
                document.getElementById('inlineEndDate').value = endDateTime.date || startDateTime.date;
                document.getElementById('inlineEndTime').value = endDateTime.time || '';
                document.getElementById('inlineEventWith').value = event.with_who || '';
                document.getElementById('inlineEventLocation').value = event.where || '';
                document.getElementById('inlineEventNotes').value = event.notes || '';
            }
        }
    } catch (error) {
        console.error('Error fetching event details:', error);
        alert('Error loading event details. Please try again.');
    }
}

async function deleteEvent(eventId) {
    try {
        const response = await fetch(appUrl(`/events/${eventId}`), {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            showSidebar(currentOpenDay);
            await updateCalendarView();
        } else {
            console.error('Failed to delete event:', data.message);
        }
    } catch (error) {
        console.error('Error deleting event:', error);
    }
}

function setupTimeInputs() {
    document.querySelectorAll('.time-input:not([data-format-bound])').forEach(timeInput => {
        timeInput.dataset.formatBound = '1';
        timeInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length >= 2) {
                const hours = parseInt(value.substring(0, 2));
                if (hours > 23) value = '23' + value.substring(2);
                value = value.substring(0, 2) + ':' + value.substring(2);
            }
            if (value.length > 5) value = value.substring(0, 5);
            if (value.length === 5) {
                const minutes = parseInt(value.substring(3, 5));
                if (minutes > 59) value = value.substring(0, 3) + '59';
            }
            e.target.value = value;
        });

        timeInput.addEventListener('blur', function(e) {
            const value = e.target.value;
            if (value && !value.match(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)) {
                e.target.value = '';
            }
        });
    });

    document.querySelectorAll('.date-input:not([data-format-bound])').forEach(dateInput => {
        dateInput.dataset.formatBound = '1';
        dateInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length >= 2) {
                value = value.substring(0, 2) + '-' + value.substring(2);
            }
            if (value.length >= 5) {
                value = value.substring(0, 5) + '-' + value.substring(5);
            }
            if (value.length > 10) value = value.substring(0, 10);
            e.target.value = value;
        });

        dateInput.addEventListener('blur', function(e) {
            const value = e.target.value;
            if (value && !value.match(/^(0[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2])-\d{4}$/)) {
                e.target.value = '';
            }
        });
    });
}

function formatEventDisplay(event) {
    const formatDate = (dateStr) => new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    const startDate = formatDate(event.start_time);
    const endDate = event.end_time ? formatDate(event.end_time) : startDate;

    if (isAllDayEvent(event)) {
        return startDate === endDate ? startDate : `${startDate} -- ${endDate}`;
    }

    const startTime = formatTimeOfDay(event.start_time);
    const endTime = event.end_time ? formatTimeOfDay(event.end_time) : '';

    return startDate === endDate
        ? `${startDate}, ${startTime} -- ${endTime}`
        : `${startDate}, ${startTime} -- ${endDate}, ${endTime}`;
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

async function editSubEvent(subEventId, eventId) {
    toggleSubEventForm(true, null, eventId, subEventId);
}

function renderAttachmentsSection(attachments) {
    if (attachments.length === 0) return '';

    const tiles = attachments.map(a => {
        const filename = escapeHtml(a.filename);
        const isImage = a.mime_type && a.mime_type.startsWith('image/');
        const preview = isImage
            ? `<img src="${appUrl(`/attachments/${a.id}`)}" alt="${filename}" loading="lazy">`
            : `<div class="attachment-icon"><i class="fas fa-file"></i><span>${filename}</span></div>`;
        return `
            <div class="attachment-tile" data-attachment-id="${a.id}">
                <a class="attachment-link" href="${appUrl(`/attachments/${a.id}`)}" target="_blank" title="${filename}">
                    ${preview}
                </a>
                <i class="fas fa-times attachment-delete" onclick="deleteAttachment(${a.id}, event)" title="Delete"></i>
            </div>
        `;
    }).join('');

    return `<div class="attachments-section"><div class="attachments-grid">${tiles}</div></div>`;
}

async function handleAttachmentUpload(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('year', viewState.year);
        formData.append('month', viewState.month);
        formData.append('day', currentOpenDay);

        try {
            const response = await fetch(appUrl('/attachments'), { method: 'POST', body: formData });
            if (!response.ok) {
                const message = response.status === 413
                    ? `File too large (max 10 MB): ${file.name}`
                    : `Upload failed: ${file.name}`;
                alert(message);
            }
        } catch (error) {
            console.error('Upload error:', error);
            alert(`Upload failed: ${file.name}`);
        }
    }

    event.target.value = '';
    showSidebar(currentOpenDay);
}

async function deleteAttachment(attachmentId, event) {
    event.stopPropagation();
    event.preventDefault();

    try {
        const response = await fetch(appUrl(`/attachments/${attachmentId}`), { method: 'DELETE' });
        if (response.ok) {
            showSidebar(currentOpenDay);
        } else {
            console.error('Failed to delete attachment');
        }
    } catch (error) {
        console.error('Delete error:', error);
    }
}

async function deleteSubEvent(subEventId, eventId) {
    try {
        const response = await fetch(appUrl(`/events/subevents/${subEventId}`), {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            // Refresh the entire sidebar instead of just the subevents
            showSidebar(currentOpenDay);
        } else {
            console.error('Failed to delete subevent:', data.message);
        }
    } catch (error) {
        console.error('Error deleting subevent:', error);
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
        
        // Show the sidebar
        requestAnimationFrame(() => {
            primarySidebar.classList.add('active');
        });
    } else {
        primarySidebar.classList.remove('active');
    }
    updateBottomBar();
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
                const startDate = new Date(event.start_time);
                const endDate = new Date(event.end_time || event.start_time);
                
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
                            const d = new Date(s.start_time);
                            return d.getDate() === parseInt(day) &&
                                   d.getMonth() + 1 === viewState.month &&
                                   d.getFullYear() === viewState.year;
                        });

                        html += `
                            <div class="diary-event" onclick="showSidebar(${day})">
                                <div class="diary-event-time">${formatEventTime(event, parseInt(day))}</div>
                                <div class="diary-event-name">${event.name}</div>
                                ${event.with_who ? `<div class="diary-event-detail"><i class="fas fa-user"></i> ${event.with_who}</div>` : ''}
                                ${event.where ? `<div class="diary-event-detail"><i class="fas fa-map-marker-alt"></i> ${event.where}</div>` : ''}
                                ${event.notes ? `<div class="diary-event-detail diary-event-notes"><i class="fas fa-sticky-note"></i> ${event.notes}</div>` : ''}
                                ${daySubevents.map(s => `
                                    <div class="diary-subevent">
                                        <div class="diary-subevent-title">${s.name}${s.where ? `<span class="diary-subevent-content">&nbsp;&nbsp;(${s.where})</span>` : ''}</div>
                                        ${s.notes ? `<div class="diary-subevent-content">${s.notes}</div>` : ''}
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

    const eventStart = new Date(event.start_time);
    const eventEnd = event.end_time ? new Date(event.end_time) : new Date(event.start_time);
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
