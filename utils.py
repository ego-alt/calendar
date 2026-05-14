import calendar
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from sqlalchemy import func
from sqlalchemy.orm import joinedload

from models import DailyLog, Event


def parse_event_datetime(date_str, time_str=None, is_end: bool = False):
    date = datetime.strptime(date_str, "%d-%m-%Y")
    if time_str:
        time_obj = datetime.strptime(time_str, "%H:%M").time()
    else:
        time_obj = time(23, 59) if is_end else time(0, 0)
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


def get_daily_logs(start_date, end_date, user_id: int):
    # joinedload: outerjoin alone does not populate `log.mood` (avoids N+1 lazy loads).
    daily_info = (
        DailyLog.query.options(joinedload(DailyLog.mood))
        .filter(
            DailyLog.user_id == user_id,
            DailyLog.date >= start_date,
            DailyLog.date < end_date,
        )
        .all()
    )
    mood_logs = {log.date.day: log.mood.color for log in daily_info if log.mood}
    marked_days = [log.date.day for log in daily_info if log.has_marker]
    return mood_logs, marked_days


def collect_event_days_in_range(events, start_date, end_date):
    """Which calendar days (day-of-month) in [start_date, end_date) have any event."""
    days_with_events = set()
    for event in events:
        end_time = event.end_time or event.start_time
        event_start = max(event.start_time.date(), start_date)
        event_end = min(end_time.date(), end_date - timedelta(days=1))

        current_date = event_start
        while current_date <= event_end:
            days_with_events.add(current_date.day)
            current_date += timedelta(days=1)

    return sorted(days_with_events)


def get_month_events(start_date, end_date, user_id: int):
    # Treat null end_time as a single-day event ending at start_time.
    effective_end = func.coalesce(Event.end_time, Event.start_time)
    events = Event.query.filter(
        Event.user_id == user_id,
        Event.start_time < end_date,
        effective_end >= start_date,
    ).all()
    return collect_event_days_in_range(events, start_date, end_date)


def get_month_data(year, month, user_id: int | None):
    """Helper function to get calendar, mood, and event data for a specific month."""
    calendar_data = get_month_calendar(year, month)
    if not user_id:
        return calendar_data, dict(), list(), list()

    start_date = datetime(year, month, 1).date()
    end_date = (datetime(year, month + 1, 1) if month < 12 else datetime(year + 1, 1, 1)).date()

    mood_colors, days_with_marker = get_daily_logs(start_date, end_date, user_id)
    days_with_events = get_month_events(start_date, end_date, user_id)
    return calendar_data, mood_colors, days_with_events, days_with_marker


def get_week_data(year, month, day, user_id: int | None):
    """Return week metadata, events, mood, and markers for the Mon-Sun week of the anchor."""
    anchor = datetime(year, month, day).date()
    week_start = anchor - timedelta(days=anchor.weekday())
    week_end = week_start + timedelta(days=7)

    days = [
        {
            "date": (week_start + timedelta(days=i)).isoformat(),
            "year": (week_start + timedelta(days=i)).year,
            "month": (week_start + timedelta(days=i)).month,
            "day": (week_start + timedelta(days=i)).day,
            "weekday": (week_start + timedelta(days=i)).strftime("%a"),
        }
        for i in range(7)
    ]

    base = {
        "week_start": week_start.isoformat(),
        "week_end": (week_end - timedelta(days=1)).isoformat(),
        "days": days,
        "events": [],
        "mood_colors": {},
        "markers": [],
    }
    if not user_id:
        return base

    window_start = datetime.combine(week_start, time(0, 0))
    window_end = datetime.combine(week_end, time(0, 0))
    effective_end = func.coalesce(Event.end_time, Event.start_time)
    events = (
        Event.query.filter(
            Event.user_id == user_id,
            Event.start_time < window_end,
            effective_end >= window_start,
        )
        .order_by(Event.start_time)
        .all()
    )
    events_data = [
        {
            "id": e.id,
            "name": e.name,
            "start_time": e.start_time.strftime("%Y-%m-%d %H:%M"),
            "end_time": e.end_time.strftime("%Y-%m-%d %H:%M") if e.end_time else None,
            "notes": e.notes,
            "with_who": e.with_who,
            "where": e.where,
        }
        for e in events
    ]

    logs = (
        DailyLog.query.options(joinedload(DailyLog.mood))
        .filter(
            DailyLog.user_id == user_id,
            DailyLog.date >= week_start,
            DailyLog.date < week_end,
        )
        .all()
    )
    mood_colors = {log.date.isoformat(): log.mood.color for log in logs if log.mood}
    markers = [log.date.isoformat() for log in logs if log.has_marker]

    base["events"] = events_data
    base["mood_colors"] = mood_colors
    base["markers"] = markers
    return base


def get_year_data(year: int, user_id: int | None) -> list[dict]:
    """Twelve months of calendar metadata in one pass (avoids 12× DB round-trips)."""
    if not user_id:
        return [
            {
                "month": m,
                "calendar_data": get_month_calendar(year, m),
                "mood_colors": {},
                "days_with_events": [],
                "days_with_marker": [],
            }
            for m in range(1, 13)
        ]

    year_start = date(year, 1, 1)
    year_end = date(year + 1, 1, 1)

    daily_info = (
        DailyLog.query.options(joinedload(DailyLog.mood))
        .filter(
            DailyLog.user_id == user_id,
            DailyLog.date >= year_start,
            DailyLog.date < year_end,
        )
        .all()
    )
    mood_by_month: dict[int, dict[int, str]] = defaultdict(dict)
    markers_by_month: dict[int, list[int]] = defaultdict(list)
    for log in daily_info:
        m = log.date.month
        d = log.date.day
        if log.mood:
            mood_by_month[m][d] = log.mood.color
        if log.has_marker:
            markers_by_month[m].append(d)

    effective_end = func.coalesce(Event.end_time, Event.start_time)
    events = (
        Event.query.filter(
            Event.user_id == user_id,
            Event.start_time < year_end,
            effective_end >= year_start,
        )
        .all()
    )

    months_data = []
    for month in range(1, 13):
        m_start = date(year, month, 1)
        m_end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        months_data.append(
            {
                "month": month,
                "calendar_data": get_month_calendar(year, month),
                "mood_colors": dict(mood_by_month[month]),
                "days_with_events": collect_event_days_in_range(events, m_start, m_end),
                "days_with_marker": sorted(markers_by_month[month]),
            }
        )
    return months_data
