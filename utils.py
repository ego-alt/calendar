import calendar
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from sqlalchemy import func

from models import DailyLog, Event
from moods import MOOD_BY_KEY, MOODS


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
    daily_info = (
        DailyLog.query.filter(
            DailyLog.user_id == user_id,
            DailyLog.date >= start_date,
            DailyLog.date < end_date,
        )
        .all()
    )
    mood_logs = {
        log.date.day: MOOD_BY_KEY[log.mood_key].color
        for log in daily_info
        if log.mood_key
    }
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
        DailyLog.query.filter(
            DailyLog.user_id == user_id,
            DailyLog.date >= week_start,
            DailyLog.date < week_end,
        )
        .all()
    )
    mood_colors = {
        log.date.isoformat(): MOOD_BY_KEY[log.mood_key].color
        for log in logs
        if log.mood_key
    }
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
        DailyLog.query.filter(
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
        if log.mood_key:
            mood_by_month[m][d] = MOOD_BY_KEY[log.mood_key].color
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


def _trailing_months(today: date, n: int = 12):
    """The last `n` (year, month) slots ending with today's month, oldest first."""
    slots = []
    for i in range(n - 1, -1, -1):
        y, m = today.year, today.month - i
        while m <= 0:
            m += 12
            y -= 1
        slots.append((y, m))
    return slots


def compute_trend(user_id: int, start: date, end: date) -> list[dict]:
    """Raw daily mood score for every day in [start, end] (None where unlogged).

    Rolling-window smoothing (7/28-day) is applied client-side so the toggle is
    instant; serving the raw series keeps day-to-day variation visible, which is
    what reveals weekly/monthly cycles that a rolling average would erase.
    """
    logs = DailyLog.query.filter(
        DailyLog.user_id == user_id,
        DailyLog.date >= start,
        DailyLog.date <= end,
        DailyLog.mood_key.isnot(None),
    ).all()
    score_by_date = {log.date: MOOD_BY_KEY[log.mood_key].score for log in logs}
    trend = []
    d = start
    while d <= end:
        trend.append({"d": d.isoformat(), "v": score_by_date.get(d)})
        d += timedelta(days=1)
    return trend


def get_stats_data(user_id: int) -> dict:
    """Aggregate a user's last-12-months mood + event activity for the stats page.

    Mood stats are count-based (no ordinal mood scale exists), so we report a
    monthly mood *mix* rather than an average. All computed server-side; the
    template embeds this as JSON and stats.js renders it.
    """
    today = date.today()
    end = today
    start = end - timedelta(days=364)
    grid_start = start - timedelta(days=start.weekday())  # back to Monday for the grid

    logs = (
        DailyLog.query.filter(
            DailyLog.user_id == user_id,
            DailyLog.date >= grid_start,
            DailyLog.date <= end,
        )
        .all()
    )
    mood_by_date = {
        log.date: MOOD_BY_KEY[log.mood_key] for log in logs if log.mood_key
    }

    # Heatmap cells: every day grid_start..end, coloured if logged.
    days = []
    d = grid_start
    while d <= end:
        m = mood_by_date.get(d)
        days.append({"d": d.isoformat(), "c": m.color if m else None, "n": m.name if m else None})
        d += timedelta(days=1)

    # Stats window is the trailing 365 days (exclude the pre-Monday grid padding).
    window = {dt: m for dt, m in mood_by_date.items() if dt >= start}
    logged_dates = set(window)

    def _mix(sample):  # [{color, name, count, share}] in palette order
        n = len(sample)
        if not n:
            return []
        by_name = defaultdict(int)
        for m in sample:
            by_name[m.name] += 1
        return [
            {
                "color": m.color,
                "name": m.name,
                "count": by_name[m.name],
                "share": round(by_name[m.name] / n * 100, 1),
            }
            for m in MOODS
            if by_name.get(m.name)
        ]

    # Distribution stays in palette order (Great -> Rough); top mood is the
    # most common, picked separately rather than by reordering the legend.
    counts = defaultdict(int)
    for m in window.values():
        counts[m.name] += 1
    distribution = [
        {
            "name": m.name,
            "color": m.color[:7],  # solid hex — no alpha on chart bars/legend
            "count": counts[m.name],
            "pct": round(counts[m.name] / len(window) * 100) if window else 0,
        }
        for m in MOODS
        if counts.get(m.name)
    ]
    top = max(distribution, key=lambda x: x["count"]) if distribution else None
    top_mood = {"name": top["name"], "color": top["color"]} if top else None

    # Streaks (consecutive logged days).
    current = 0
    dd = end
    while dd in logged_dates:
        current += 1
        dd -= timedelta(days=1)
    longest = run = 0
    dd = start
    while dd <= end:
        run = run + 1 if dd in logged_dates else 0
        longest = max(longest, run)
        dd += timedelta(days=1)

    weekday = [_mix([m for dt, m in window.items() if dt.weekday() == wd]) for wd in range(7)]

    slots = _trailing_months(today)
    slot_index = {s: i for i, s in enumerate(slots)}
    month_mix = [
        {
            "label": date(y, m, 1).strftime("%b"),
            "segments": _mix([mo for dt, mo in window.items() if (dt.year, dt.month) == (y, m)]),
        }
        for (y, m) in slots
    ]

    # Events.
    events = (
        Event.query.filter(
            Event.user_id == user_id,
            Event.start_time >= datetime.combine(start, time.min),
        ).all()
    )
    # Count days with at least one event per month, not raw event totals — a
    # busy single day shouldn't read the same as events spread across the month.
    ev_days = [set() for _ in slots]
    for e in events:
        idx = slot_index.get((e.start_time.year, e.start_time.month))
        if idx is not None:
            ev_days[idx].add(e.start_time.date())
    events_per_month = [
        {"label": date(y, m, 1).strftime("%b"), "count": len(ev_days[i])}
        for i, (y, m) in enumerate(slots)
    ]

    trend = compute_trend(user_id, start, end)

    return {
        "range_start": start.isoformat(),
        "range_end": end.isoformat(),
        "days": days,
        "tiles": {
            "logged": len(window),
            "total": (end - start).days + 1,
            "current_streak": current,
            "longest_streak": longest,
            "top_mood": top_mood,
        },
        "distribution": distribution,
        "weekday": weekday,
        "month_mix": month_mix,
        "events_per_month": events_per_month,
        "trend": trend,
        "score_labels": [
            {"score": m.score, "name": m.name}
            for m in sorted(MOODS, key=lambda x: -x.score)
        ],
    }
