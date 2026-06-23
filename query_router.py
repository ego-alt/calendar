"""Query-lane router for diary search.

Classifies a typed query and pulls structured metadata (date range, mood) out of
it before retrieval runs, so "what happened on the 16th Jun" becomes a date
*filter* rather than a content search for those words. Pure and dependency-free:
no DB, no model, `today` injected for deterministic tests. It only pre-fills the
params `search()` already accepts — retrieval internals are untouched.
"""

import calendar
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from moods import MOOD_BY_KEY

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_MONTH_ALT = (
    r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?"
    r"|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)
_DAY = r"(\d{1,2})(?:st|nd|rd|th)?"

# Mood words (canonical keys from moods.py) plus a couple of obvious aliases.
_MOOD_ALIASES = {"ok": "okay"}
_MOOD_WORDS = list(MOOD_BY_KEY) + list(_MOOD_ALIASES)
_MOOD_ALT = "(" + "|".join(sorted(_MOOD_WORDS, key=len, reverse=True)) + ")"

# Connector words left dangling after a date/mood span is removed.
_CONNECTORS = {"on", "in", "at", "during", "for", "from", "of", "the"}
# Generic question/filler words — if a date or mood lane fired and the residual is
# nothing but these, treat it as a pure metadata lookup (empty content query).
_STOPWORDS = _CONNECTORS | {
    "what", "whats", "happened", "happen", "happens", "show", "me", "my", "did",
    "do", "was", "were", "is", "are", "there", "anything", "everything", "all",
    "going", "events", "event", "entries", "entry", "stuff", "things", "thing",
    "tell", "about", "any", "that", "this", "day", "days", "when", "i",
}


@dataclass
class RoutedQuery:
    residual_q: str
    date_from: datetime | None = None
    date_to: datetime | None = None  # exclusive
    date_label: str | None = None
    mood: str | None = None
    labels: list[str] = field(default_factory=list)


def _span(first: date, last: date):
    """Half-open datetime range [first 00:00, day-after-last 00:00)."""
    start = datetime(first.year, first.month, first.day)
    end = datetime(last.year, last.month, last.day) + timedelta(days=1)
    return start, end


def _month_num(name: str) -> int:
    return _MONTHS[name[:3].lower()]


def _make_date(year: int, month: int, day: int):
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _infer_dated(month: int, day: int, today: date):
    """Resolve a year-less day+month to the most recent past occurrence."""
    cand = _make_date(today.year, month, day)
    if cand is None:
        return None
    if cand > today:
        cand = _make_date(today.year - 1, month, day)
    return cand


def _day_label(d: date) -> str:
    return f"{d.day} {_MONTH_ABBR[d.month]} {d.year}"


def _extract_date(text: str, today: date):
    """Return (date_from, date_to, label, remaining_text) or (None,…,text)."""
    # 1. ISO YYYY-MM-DD
    m = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", text)
    if m:
        d = _make_date(int(m[1]), int(m[2]), int(m[3]))
        if d:
            start, end = _span(d, d)
            return (start, end, _day_label(d), _strip(text, m))

    # 2. day + month (+ optional year), both orders
    m = re.search(rf"\b{_DAY}\s+{_MONTH_ALT}(?:,?\s+(\d{{4}}))?\b", text, re.I)
    if not m:
        m2 = re.search(rf"\b{_MONTH_ALT}\s+{_DAY}(?:,?\s+(\d{{4}}))?\b", text, re.I)
        if m2:
            day, month_name, year = m2[2], m2[1], m2[3]
            m = m2
        else:
            m = None
    else:
        day, month_name, year = m[1], m[2], m[3]
    if m:
        month = _month_num(month_name)
        if year:
            d = _make_date(int(year), month, int(day))
        else:
            d = _infer_dated(month, int(day), today)
        if d:
            start, end = _span(d, d)
            return (start, end, _day_label(d), _strip(text, m))

    # 3. relative phrases
    return _extract_relative(text, today)


def _extract_relative(text: str, today: date):
    # "last 7 days" / "past 2 weeks"
    m = re.search(r"\b(?:last|past)\s+(\d{1,3})\s+(day|week)s?\b", text, re.I)
    if m:
        n = int(m[1]) * (7 if m[2].lower() == "week" else 1)
        first = today - timedelta(days=n - 1)
        start, end = _span(first, today)
        unit = "weeks" if m[2].lower() == "week" else "days"
        return (start, end, f"last {m[1]} {unit}", _strip(text, m))

    m = re.search(r"\b(today)\b", text, re.I)
    if m:
        start, end = _span(today, today)
        return (start, end, "today", _strip(text, m))

    m = re.search(r"\b(yesterday)\b", text, re.I)
    if m:
        y = today - timedelta(days=1)
        start, end = _span(y, y)
        return (start, end, "yesterday", _strip(text, m))

    m = re.search(r"\b(this|last)\s+(week|month|year)\b", text, re.I)
    if m:
        which, unit = m[1].lower(), m[2].lower()
        first, last = _relative_unit(which, unit, today)
        start, end = _span(first, last)
        return (start, end, f"{which} {unit}", _strip(text, m))

    return (None, None, None, text)


def _relative_unit(which: str, unit: str, today: date):
    if unit == "week":
        monday = today - timedelta(days=today.weekday())
        if which == "last":
            monday -= timedelta(days=7)
        return monday, monday + timedelta(days=6)
    if unit == "month":
        if which == "this":
            first = today.replace(day=1)
        else:
            first = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
        last = first.replace(day=calendar.monthrange(first.year, first.month)[1])
        return first, last
    # year
    year = today.year if which == "this" else today.year - 1
    return date(year, 1, 1), date(year, 12, 31)


def _extract_mood(text: str):
    """Cue-gated mood detection → (mood_key, label, remaining_text)."""
    patterns = [
        rf"\b(?:feeling|felt|feel)\s+{_MOOD_ALT}\b",
        rf"\bin\s+a\s+{_MOOD_ALT}\s+mood\b",
        rf"\b{_MOOD_ALT}\s+mood\b",
        rf"\b{_MOOD_ALT}\s+days?\b",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            word = m[1].lower()
            key = _MOOD_ALIASES.get(word, word)
            return (key, f"mood: {key}", _strip(text, m))
    return (None, None, text)


def _strip(text: str, match: re.Match) -> str:
    return text[: match.start()] + " " + text[match.end():]


def _cleanup(text: str) -> str:
    tokens = [t for t in text.split() if t]
    while tokens and tokens[0].lower() in _CONNECTORS:
        tokens.pop(0)
    while tokens and tokens[-1].lower() in _CONNECTORS:
        tokens.pop()
    return " ".join(tokens)


def route_query(q: str, *, today: date | None = None) -> RoutedQuery:
    today = today or date.today()
    text = q or ""

    date_from, date_to, date_label, text = _extract_date(text, today)
    mood, mood_label, text = _extract_mood(text)

    residual = _cleanup(text)
    # If a lane fired and only filler/question words remain, it's a pure lookup.
    if (date_from or mood) and residual:
        if all(tok in _STOPWORDS for tok in residual.lower().split()):
            residual = ""

    labels = [label for label in (date_label, mood_label) if label]
    return RoutedQuery(
        residual_q=residual,
        date_from=date_from,
        date_to=date_to,
        date_label=date_label,
        mood=mood,
        labels=labels,
    )
