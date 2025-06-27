// Current date (fixed, doesn't change)
const TODAY = new Date();
const CURRENT_YEAR = TODAY.getFullYear();
const CURRENT_MONTH = TODAY.getMonth() + 1; // getMonth() returns 0-11
const CURRENT_DAY = TODAY.getDate();

// View state (changes as user navigates)
let viewState = {
    year: CURRENT_YEAR,
    month: CURRENT_MONTH
};

let isLoading = false;
let currentOpenDay = null;

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    document.addEventListener('keydown', handleKeyPress);
});

function setupEventListeners() {
    const colorPicker = document.getElementById('colorPicker');
    const sidebar = document.getElementById('sidebar');
    let selectedDay = null;
    let menuOpen = false;

    document.querySelectorAll('.day').forEach(day => {
        const eyeIcon = document.createElement('i');
        eyeIcon.className = 'fas fa-eye eye-icon';
        day.appendChild(eyeIcon);

        eyeIcon.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            if (menuOpen && selectedDay === day && day.style.backgroundColor) {
                // Clear the mood
                try {
                    const response = await fetch('/mood/update', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            year: viewState.year,
                            month: viewState.month,
                            day: day.dataset.day,
                            color: null
                        })
                    });
                    
                    const data = await response.json();
                    if (data.status === 'success') {
                        day.style.backgroundColor = '';
                        colorPicker.style.display = 'none';
                        menuOpen = false;
                        selectedDay = null;
                    } else {
                        console.error('Failed to clear mood:', data.message);
                    }
                } catch (error) {
                    console.error('Error clearing mood:', error);
                }
            } else {
                // Show color picker with position based on screen size
                selectedDay = day;
                menuOpen = true;
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

    document.querySelectorAll('.color-option').forEach(option => {
        option.addEventListener('click', async () => {
            if (selectedDay) {
                const color = window.getComputedStyle(option).backgroundColor;
                
                try {
                    const response = await fetch('/mood/update', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            year: viewState.year,
                            month: viewState.month,
                            day: selectedDay.dataset.day,
                            color: color
                        })
                    });

                    // Try to get the raw text first
                    const rawText = await response.text();
                    console.log('Raw response:', rawText);
                    
                    // Then parse it as JSON if it looks like JSON
                    let data;
                    try {
                        data = JSON.parse(rawText);
                    } catch (e) {
                        console.error('Failed to parse response as JSON:', e);
                        throw new Error('Invalid JSON response');
                    }
                    
                    if (data.status === 'success') {
                        selectedDay.style.backgroundColor = color;
                    } else {
                        console.error('Failed to update mood:', data.message);
                    }
                } catch (error) {
                    console.error('Error updating mood:', error);
                }
                
                colorPicker.style.display = 'none';
                menuOpen = false;
                selectedDay = null;
            }
        });
    });

    // Update the document click handler to also reset the menuOpen state
    document.addEventListener('click', (event) => {
        const sidebar = document.getElementById('sidebar');
        const colorPicker = document.getElementById('colorPicker');
        const diaryView = document.getElementById('diaryView');
        const yearView = document.getElementById('yearView');
        
        // Check if click is outside interactive elements
        const isInteractiveClick = event.target.closest(
            '#sidebar, #colorPicker, .day, .eye-icon, .subevent-form-container, .event-actions, #diaryView, #diaryViewBtn, #yearView, #yearViewBtn'
        );
        
        // Only close sidebar and color picker if clicking outside interactive elements
        if (!isInteractiveClick) {
            colorPicker.style.display = 'none';
            menuOpen = false;
            selectedDay = null;
            
            sidebar.classList.remove('active');
            if (window.innerWidth <= 480) {
                sidebar.classList.remove('expanded');
                sidebar.style.height = '20vh';
            }
            
            // Close diary view when clicking outside
            diaryView.classList.remove('active');
            yearView.classList.remove('active');
            
            // Close any open subevent forms
            const subEventForms = document.querySelectorAll('.subevent-form-container');
            subEventForms.forEach(form => form.remove());
            toggleEventForm(false);
        }
    });

    setupTimeInputs();

    if (window.innerWidth <= 480) {
        const sidebar = document.getElementById('sidebar');
        const handle = document.querySelector('.sidebar-handle');
        let isDragging = false;
        
        handle.addEventListener('touchstart', (e) => {
            isDragging = true;
            sidebar.style.transition = 'none';
            e.preventDefault(); // Prevent default to ensure proper touch handling
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            const vh = window.innerHeight / 100;
            const height = window.innerHeight - e.touches[0].clientY;
            sidebar.style.height = `${Math.min(Math.max(height, 15 * vh), 60 * vh)}px`;
        }, { passive: false });

        document.addEventListener('touchend', () => {
            if (!isDragging) return;
            isDragging = false;
            sidebar.style.transition = 'height 0.3s ease';
            const isExpanded = sidebar.offsetHeight > window.innerHeight * 0.45;
            sidebar.style.height = isExpanded ? '60vh' : '15vh';
            sidebar.classList.toggle('expanded', isExpanded);
        });
    }
}

function handleKeyPress(event) {
    // Ignore shortcuts if any input or textarea is focused
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        // But still handle Escape key for closing forms
        if (event.key === 'Escape') {
            toggleSubEventForm(false);
            event.preventDefault();
        }
        return;
    }
    
    switch (event.key) {
        case 'h':
            updateMonth('prev');
            break;
        case 'l':
            updateMonth('next');
            break;
        case 'k':
            updateYear('prev');
            break;
        case 'j':
            updateYear('next');
            break;
        case 'd':
            toggleDiaryView();
            break;
        case 'y':
            toggleYearView();
            break;
    }
    
    // Add ESC key handling
    if (event.key === 'Escape') {
        toggleSubEventForm(false);
        toggleDiaryView(false);
        toggleYearView(false);
        event.preventDefault();
    }
}

async function updateMonth(direction) {
    if (isLoading) return;
    
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
    await updateCalendarView();
}

async function updateCalendarView() {
    isLoading = true;

    try {
        const response = await fetch(`/get_month?year=${viewState.year}&month=${viewState.month}`);
        const data = await response.json();
        
        // Update main header
        document.querySelector('h1').textContent = data.month_label;
        const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        
        // Generate the new month HTML
        const monthHTML = `
            <div class="month-grid" id="viewMonth">
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
                    </div>
                `).join('')}
                ${data.calendar_data.next_days.map(day => `
                    <div class="day next-month" data-day="${day}"></div>
                `).join('')}
            </div>
        `;
        
        document.getElementById('calendarContainer').innerHTML = monthHTML;
        setupEventListeners();
        
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

async function showSidebar(day) {
    const sidebar = document.getElementById('sidebar');
    const sidebarContent = document.getElementById('sidebarContent');
    const eventForm = document.getElementById('eventForm');

    requestAnimationFrame(() => {sidebar.classList.add('active');});
    currentOpenDay = day;
    toggleEventForm(false);
    
    try {
        const response = await fetch(`/events?year=${viewState.year}&month=${viewState.month}&day=${day}`);
        const data = await response.json();
        
        if (data.status === 'success') {
            const date = new Date(viewState.year, viewState.month - 1, day);
            const dateString = `${day} ${date.toLocaleDateString('en-GB', { month: 'long' })}`;
            
            let html = `
                <div class="sidebar-header">${dateString}</div>
                <div class="event-list">
            `;
            
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
            
            html += `</div><button class="add-event-btn" onclick="toggleEventForm(true)">Add Event</button>`;
            sidebarContent.innerHTML = html;
        }
    } catch (error) {
        console.error('Error fetching events:', error);
        sidebarContent.innerHTML = '<div class="no-events">Error loading events</div>';
    }
    
    // Close any open subevent forms
    toggleSubEventForm(false);
}

function displaySubEvents(eventId, subevents) {
    const eventCard = document.querySelector(`.event-card[data-event-id="${eventId}"]`);
    if (!eventCard) return;
    
    // Remove any existing subevents container
    const existingContainer = document.getElementById(`subevents-${eventId}`);
    if (existingContainer) {
        existingContainer.remove();
    }
    
    if (subevents && subevents.length > 0) {
        // Only create container if there are subevents to display
        const container = document.createElement('div');
        container.className = 'subevents-container';
        container.id = `subevents-${eventId}`;
        
        let html = `<div class="subevents-list">`;
        subevents.forEach(subevent => {
            html += `
                <div class="subevent-card" data-subevent-id="${subevent.id}">
                    <div class="subevent-actions">
                        <i class="fas fa-edit" onclick="editSubEvent(${subevent.id}, ${eventId})"></i>
                        <i class="fas fa-trash" onclick="deleteSubEvent(${subevent.id}, ${eventId})"></i>
                    </div>
                    <div class="subevent-time">${formatSubEventTime(subevent)}</div>
                    <div class="subevent-name">${subevent.name}</div>
                    <div class="subevent-details">
                        ${subevent.with_who ? `<div class="subevent-detail-item"><i class="fas fa-user"></i> ${subevent.with_who}</div>` : ''}
                        ${subevent.where ? `<div class="subevent-detail-item"><i class="fas fa-map-marker-alt"></i> ${subevent.where}</div>` : ''}
                    </div>
                </div>
            `;
        });
        html += `</div>`;
        container.innerHTML = html;
        
        // Append the container to the event card
        eventCard.appendChild(container);
    }
}

function formatSubEventTime(subevent) {
    // For subevents, we only need to show the time, not the date
    const formatTime = dateStr => new Date(dateStr).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false 
    });

    const startTime = formatTime(subevent.start_time);
    const endTime = subevent.end_time ? formatTime(subevent.end_time) : '';

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
                <input type="text" id="subEventName" placeholder="Subevent Name" required>
                <div class="form-row">
                    <input type="text" id="subStartDate" class="date-input" placeholder="DD-MM-YYYY" required>
                    <input type="text" id="subStartTime" class="time-input" placeholder="HH:MM">
                </div>
                <div class="form-row">
                    <input type="text" id="subEndDate" class="date-input" placeholder="DD-MM-YYYY">
                    <input type="text" id="subEndTime" class="time-input" placeholder="HH:MM">
                </div>
                <input type="text" id="subEventLocation" placeholder="Where">
                <textarea id="subEventNotes" placeholder="Notes"></textarea>
                <div class="form-buttons">
                    <button type="button" class="cancel-btn" onclick="toggleSubEventForm(false)">Cancel</button>
                    <button type="button" class="save-btn" id="saveSubEventBtn">Save</button>
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
                with_who: null,
                notes: document.getElementById('subEventNotes').value || null
            };
            
            // Determine if this is an edit or a new subevent
            const method = subEventId ? 'PUT' : 'POST';
            const url = subEventId ? 
                `/events/subevents/${subEventId}` : 
                `/events/${eventId}/subevents`;
            
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
        console.log('Populating form for subevent:', subEventId, 'in event:', eventId);
        const response = await fetch(`/events/subevents/${subEventId}`);
        const data = await response.json();
        
        if (data.status === 'success') {
            const subevent = data.subevent;
            console.log('Found subevent data:', subevent);
            
            if (subevent) {
                // Make sure the form has the correct subevent ID
                const form = document.getElementById('newSubEventForm');
                form.dataset.subEventId = subEventId;
                console.log('Set form dataset.subEventId to:', form.dataset.subEventId);
                
                // Parse the datetime strings
                const parseDateTime = (dateTimeStr) => {
                    if (!dateTimeStr) return { date: '', time: '' };
                    
                    // Parse "YYYY-MM-DD HH:MM" format
                    const [datePart, timePart] = dateTimeStr.split(' ');
                    const [year, month, day] = datePart.split('-');
                    
                    return {
                        // Convert to DD-MM-YYYY format for the form
                        date: `${day}-${month}-${year}`,
                        time: timePart
                    };
                };

                const startDateTime = parseDateTime(subevent.start_time);
                const endDateTime = parseDateTime(subevent.end_time);
                
                // Populate form
                document.getElementById('subEventName').value = subevent.name;
                document.getElementById('subStartDate').value = startDateTime.date;
                document.getElementById('subStartTime').value = startDateTime.time;
                document.getElementById('subEndDate').value = endDateTime.date || startDateTime.date;
                document.getElementById('subEndTime').value = endDateTime.time || '';
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
        const url = eventId ? `/events/${eventId}` : '/events';
        
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
            updateMonth(viewState.year, viewState.month);
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
            <input type="text" id="inlineEventName" placeholder="Event Name" required>
            <div class="form-row">
                <input type="text" id="inlineStartDate" class="date-input" placeholder="DD-MM-YYYY" required>
                <input type="text" id="inlineStartTime" class="time-input" placeholder="HH:MM">
            </div>
            <div class="form-row">
                <input type="text" id="inlineEndDate" class="date-input" placeholder="DD-MM-YYYY">
                <input type="text" id="inlineEndTime" class="time-input" placeholder="HH:MM">
            </div>
            <input type="text" id="inlineEventWith" placeholder="With Who">
            <input type="text" id="inlineEventLocation" placeholder="Where">
            <textarea id="inlineEventNotes" placeholder="Notes"></textarea>
            <div class="form-buttons">
                <button type="button" class="cancel-btn" onclick="closeEventEditForm()">Cancel</button>
                <button type="button" class="save-btn" id="saveInlineEventBtn">Save</button>
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
    document.getElementById('saveInlineEventBtn').addEventListener('click', async function() {
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
            const response = await fetch(`/events/${eventId}`, {
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
    document.querySelector('.cancel-btn').addEventListener('click', function(e) {
        e.stopPropagation(); // Prevent the click from reaching the document
        closeEventEditForm();
    });
}

function closeEventEditForm() {
    const eventForms = document.querySelectorAll('.event-form-container');
    eventForms.forEach(form => form.remove());
}

async function populateEventEditForm(eventId) {
    try {
        const response = await fetch(`/events?year=${viewState.year}&month=${viewState.month}&day=${currentOpenDay}`);
        const data = await response.json();
        
        if (data.status === 'success') {
            const event = data.events.find(e => e.id === eventId);
            
            if (event) {
                // Parse the datetime strings
                const parseDateTime = (dateTimeStr) => {
                    if (!dateTimeStr) return { date: '', time: '' };
                    
                    // Parse "YYYY-MM-DD HH:MM" format
                    const [datePart, timePart] = dateTimeStr.split(' ');
                    const [year, month, day] = datePart.split('-');
                    
                    return {
                        // Convert to DD-MM-YYYY format for the form
                        date: `${day}-${month}-${year}`,
                        time: timePart
                    };
                };

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
        const response = await fetch(`/events/${eventId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            showSidebar(currentOpenDay);
            updateMonth(viewState.year, viewState.month);
        } else {
            console.error('Failed to delete event:', data.message);
        }
    } catch (error) {
        console.error('Error deleting event:', error);
    }
}

function setupTimeInputs() {
    document.querySelectorAll('.time-input').forEach(timeInput => {
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

    document.querySelectorAll('.date-input').forEach(dateInput => {
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
    const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    };

    const startDate = formatDate(event.start_time);
    const endDate = event.end_time ? formatDate(event.end_time) : startDate;
    
    // Check if all-day event (both times at midnight)
    if (event.start_time.endsWith('00:00') && event.end_time.endsWith('23:59')) {
        // For multi-day all-day events, show full range
        if (startDate !== endDate) {
            return `${startDate} -- ${endDate}`;
        }
        // For single-day all-day events, just show one date
        return startDate;
    }

    // For timed events
    const formatTime = dateStr => new Date(dateStr).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false 
    });

    const startTime = formatTime(event.start_time);
    const endTime = event.end_time ? formatTime(event.end_time) : '';

    return startDate === endDate ? 
        `${startDate}, ${startTime} -- ${endTime}` : 
        `${startDate}, ${startTime} -- ${endDate}, ${endTime}`;
}

function displayEvents(events) {
    const eventsList = document.getElementById('eventsList');
    eventsList.innerHTML = '';
    
    events.forEach(event => {
        const eventCard = document.createElement('div');
        eventCard.className = 'event-card';
        eventCard.dataset.eventId = event.id;
        
        eventCard.innerHTML = `
            <h3>${event.name}</h3>
            <p class="event-time">${formatEventDisplay(event)}</p>
            ${event.where ? `<p class="event-location">📍 ${event.where}</p>` : ''}
            ${event.with_who ? `<p class="event-with">👥 ${event.with_who}</p>` : ''}
            ${event.notes ? `<p class="event-notes">📝 ${event.notes}</p>` : ''}
            <div class="event-actions">
                <button onclick="editEvent(${event.id})">Edit</button>
                <button onclick="deleteEvent(${event.id})">Delete</button>
            </div>
        `;
        
        eventsList.appendChild(eventCard);
    });
}

// Add these login-related functions at the end of your script
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
        console.log('Attempting login...');
        const response = await fetch('/auth/login', {
            method: 'POST',
            body: formData
        });
        
        console.log('Response status:', response.status);
        const data = await response.json();
        console.log('Response data:', data);
        
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
        const response = await fetch('/auth/logout');
        if (response.ok) {
            location.reload();
        }
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// Add these event listeners when the document is ready
$(document).ready(function() {
    // Close dialog when clicking outside or on close button
    $('.login-overlay').on('click', function(e) {
        if (e.target === this) {
            closeLoginDialog();
        }
    });

    // Prevent closing when clicking inside the login content
    $('.login-content').on('click', function(e) {
        e.stopPropagation();
    });
});

async function editSubEvent(subEventId, eventId) {
    toggleSubEventForm(true, null, eventId, subEventId);
}

async function deleteSubEvent(subEventId, eventId) {
    try {
        const response = await fetch(`/events/subevents/${subEventId}`, {
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
        const response = await fetch(`/events/month?year=${viewState.year}&month=${viewState.month}`);
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
                        html += `
                            <div class="diary-event" onclick="showSidebar(${day})">
                                <div class="diary-event-time">${formatEventTime(event, parseInt(day))}</div>
                                <div class="diary-event-name">${event.name}</div>
                                ${event.with_who ? `<div class="diary-event-detail"><i class="fas fa-user"></i> ${event.with_who}</div>` : ''}
                                ${event.where ? `<div class="diary-event-detail"><i class="fas fa-map-marker-alt"></i> ${event.where}</div>` : ''}
                                ${event.notes ? `<div class="diary-event-detail diary-event-notes"><i class="fas fa-sticky-note"></i> ${event.notes}</div>` : ''}
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
    // Extract the current day's date at midnight
    const currentDayDate = new Date(viewState.year, viewState.month - 1, displayDay);
    
    // Parse event times
    const eventStart = new Date(event.start_time);
    const eventEnd = event.end_time ? new Date(event.end_time) : new Date(event.start_time);
    
    // Format time helper function
    const formatTime = date => date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false 
    });
    
    const isMultiDay = eventStart.toDateString() !== eventEnd.toDateString();
    const isTrueAllDayEvent = (event.start_time.endsWith('00:00') && event.end_time && event.end_time.endsWith('23:59'));
    if (isTrueAllDayEvent) {
        return '';
    }
    
    if (isMultiDay) {
        // Start of day and end of day times
        const startOfDay = '00:00';
        const endOfDay = '23:59';
        
        // Is this the first day of the event?
        if (eventStart.getDate() === displayDay && 
            eventStart.getMonth() === viewState.month - 1 && 
            eventStart.getFullYear() === viewState.year) {
            
            // If event starts at beginning of day (00:00), show no time
            if (eventStart.getHours() === 0 && eventStart.getMinutes() === 0) {
                return `${startOfDay} - ${endOfDay}`;
            }
            
            // Otherwise show the actual start time to end of day
            return `${formatTime(eventStart)} - ${endOfDay}`;
        }
        
        // Is this the last day of the event?
        if (eventEnd.getDate() === displayDay && 
            eventEnd.getMonth() === viewState.month - 1 && 
            eventEnd.getFullYear() === viewState.year) {
            
            // If event ends at end of day (23:59) or beginning of next day (00:00), show no time
            if (eventEnd.getHours() === 23 && eventEnd.getMinutes() === 59) {
                return `${startOfDay} - ${endOfDay}`;
            }
            
            // Otherwise show start of day to the actual end time
            return `${startOfDay} - ${formatTime(eventEnd)}`;
        }
        
        // This is a middle day of the event - spans full day
        return '';
    }
    
    // Single-day event with specified times
    const startTime = formatTime(eventStart);
    const endTime = event.end_time ? formatTime(eventEnd) : '';
    
    // If it's a same-day all-day event (starts at 00:00 and ends at 23:59)
    if (startTime === '00:00' && endTime === '23:59') {
        return '';
    }
    
    return endTime ? `${startTime} - ${endTime}` : startTime;
}

document.addEventListener('DOMContentLoaded', function() {
    // Setup diary view button click handler
    document.getElementById('diaryViewBtn').addEventListener('click', function() {
        toggleDiaryView();
    });
});

// Add these year view functions
async function loadYearView(year) {
    const yearContent = document.getElementById('yearContent');
    yearContent.innerHTML = '<div class="loading-indicator">Loading year data...</div>';
    
    try {
        const response = await fetch(`/get_year?year=${year}`);
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

// Add event listener for year view button
document.addEventListener('DOMContentLoaded', function() {
    // Setup year view button click handler
    document.getElementById('yearViewBtn').addEventListener('click', function() {
        toggleYearView();
    });
});