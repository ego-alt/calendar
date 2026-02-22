import calendar
from datetime import datetime, time, timedelta
from models import db, User, Mood, DailyLog, Event
from sqlalchemy.sql import func


def parse_event_datetime(date_str, time_str=None, is_end: bool = False):
    date = datetime.strptime(date_str, "%d-%m-%Y")
    time_obj = (
        datetime.strptime(time_str, "%H:%M").time()
        if time_str
        else time(23, 59)
        if is_end
        else time(0, 0)
    )
    return datetime.combine(date, time_obj)


def get_month_calendar(year, month):
    # Get the first day of the month and number of days
    first_day = datetime(year, month, 1)
    _, num_days = calendar.monthrange(year, month)

    # Get the previous month's trailing days
    if first_day.weekday() != 0:  # If month doesn't start on Monday
        prev_month = first_day - timedelta(days=1)
        _, prev_month_days = calendar.monthrange(prev_month.year, prev_month.month)
        prev_days = list(range(prev_month_days - first_day.weekday() + 1, prev_month_days + 1))
    else:
        prev_days = []

    # Current month's days
    current_days = list(range(1, num_days + 1))

    # Next month's leading days
    total_days = len(prev_days) + len(current_days)
    next_days = list(range(1, 43 - total_days))

    return {
        "prev_days": prev_days,
        "current_days": current_days,
        "next_days": next_days,
    }


def get_mood_logs(start_date, end_date, user_id: int):
    # Fetch mood data
    daily_logs = (
        DailyLog.query.filter(
            DailyLog.user_id == user_id,
            DailyLog.date >= start_date,
            DailyLog.date < end_date,
        )
        .join(Mood)
        .all()
    )
    return {log.date.day: log.mood.color for log in daily_logs}


def get_marked_days(start_date, end_date, user_id: int):
    daily_logs = DailyLog.query.filter(
        DailyLog.user_id == user_id,
        DailyLog.date >= start_date,
        DailyLog.date < end_date,
        DailyLog.has_marker == True,
    ).all()
    return [log.date.day for log in daily_logs]


def get_month_events(start_date, end_date, user_id: int):
    # Get events that overlap with the month
    days_with_events = set()
    events = Event.query.filter(
        Event.user_id == user_id,
        Event.start_time < end_date,
        Event.end_time >= start_date,
    ).all()

    # Generate all days that have events
    for event in events:
        # Get the date range bounds within the month
        event_start = max(event.start_time.date(), start_date)
        event_end = min(event.end_time.date(), end_date - timedelta(days=1))

        current_date = event_start
        while current_date <= event_end:
            days_with_events.add(current_date.day)
            current_date += timedelta(days=1)

    return sorted(list(days_with_events))


def get_month_data(year, month, user_id: int | None):
    """Helper function to get calendar, mood, and event data for a specific month."""
    calendar_data = get_month_calendar(year, month)
    if not user_id:
        return calendar_data, dict(), list(), list()

    start_date = datetime(year, month, 1).date()
    end_date = (datetime(year, month + 1, 1) if month < 12 else datetime(year + 1, 1, 1)).date()

    mood_colors = get_mood_logs(start_date, end_date, user_id)
    days_with_events = get_month_events(start_date, end_date, user_id)
    days_with_marker = get_marked_days(start_date, end_date, user_id)
    return calendar_data, mood_colors, days_with_events, days_with_marker
