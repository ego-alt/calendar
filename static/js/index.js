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
                    
                    // Add debugging for response
                    console.log('Response status:', response.status);
                    console.log('Response headers:', response.headers);
                    
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
        
        const isInteractiveClick = event.target.closest('#sidebar, #colorPicker, .day, .eye-icon');
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
        return;
    }
    if (event.key === 'h') {
        updateMonth('prev');
    } else if (event.key === 'l') {
        updateMonth('next');
    }
}

async function updateMonth(direction) {
    if (isLoading) return;
    isLoading = true;

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

    } catch (error) {
        console.error('Error updating month:', error);
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
    
    try {
        const response = await fetch(`/events?year=${viewState.year}&month=${viewState.month}&day=${day}`);
        const data = await response.json();
        
        if (data.status === 'success') {
            const date = new Date(viewState.year, viewState.month - 1, day);
            const dateString = `${day} ${date.toLocaleDateString('en-US', { month: 'long' })}`;
            
            let html = `
                <div class="sidebar-header">${dateString}</div>
                <div class="event-list">
            `;
            
            if (data.events.length === 0) {
                html += `<div class="no-events">No events scheduled</div>`;
            } else {
                data.events.forEach(event => {
                    html += `
                        <div class="event-card" data-event-id="${event.id}">
                            <div class="event-actions">
                                <i class="fas fa-edit" onclick="editEvent(${event.id})"></i>
                                <i class="fas fa-trash" onclick="deleteEvent(${event.id})"></i>
                            </div>
                            <div class="event-time">
                                ${formatEventDisplay(event)}
                            </div>
                            <div class="event-name">${event.name}</div>
                            <div class="event-details">
                                ${event.with_who ? `<div class="event-detail-item"><i class="fas fa-user"></i> ${event.with_who}</div>` : ''}
                                ${event.where ? `<div class="event-detail-item"><i class="fas fa-map-marker-alt"></i> ${event.where}</div>` : ''}
                            </div>
                        </div>
                    `;
                });
            }
            
            html += `</div><button class="add-event-btn" onclick="toggleEventForm(true)">Add Event</button>`;
            sidebarContent.innerHTML = html;
        }
    } catch (error) {
        console.error('Error fetching events:', error);
        sidebarContent.innerHTML = '<div class="no-events">Error loading events</div>';
    }
}

function toggleEventForm(show) {
    const eventForm = document.getElementById('eventForm');
    const newEventForm = document.getElementById('newEventForm');
    eventForm.style.display = show ? 'block' : 'none';
    if (show) {
        newEventForm.reset();
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
    const eventForm = document.getElementById('eventForm');
    const form = document.getElementById('newEventForm');
    
    // Get current event data
    const response = await fetch(`/events?year=${viewState.year}&month=${viewState.month}&day=${currentOpenDay}`);
    const data = await response.json();
    const event = data.events.find(e => e.id === eventId);

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
    form.dataset.eventId = eventId;
    document.getElementById('eventName').value = event.name;
    document.getElementById('startDate').value = startDateTime.date;
    document.getElementById('startTime').value = startDateTime.time;
    document.getElementById('endDate').value = endDateTime.date || startDateTime.date;
    document.getElementById('endTime').value = endDateTime.time || '';
    document.getElementById('eventWith').value = event.with_who || '';
    document.getElementById('eventLocation').value = event.where || '';
    document.getElementById('eventNotes').value = event.notes || '';
    
    // Show form
    eventForm.style.display = 'block';
    eventForm.classList.add('editing');
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
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const startDate = formatDate(event.start_time);
    const endDate = event.end_time ? formatDate(event.end_time) : startDate;
    
    // Check if all-day event (both times at midnight)
    if (event.start_time.endsWith('00:00') && event.end_time.endsWith('00:00')) {
        return startDate;  // For all-day events, just show the date
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