"""Query-lane router for diary search (date / mood / who / where).

Classifies a typed query and pulls structured metadata out of it before retrieval
runs, so "dinner with Mom on 16 Jun" becomes date + who *filters* plus the content
query "dinner". Pure and dependency-free: no DB, no model, `today` injected for
deterministic tests. The caller passes the user's known `people`/`places` (a closed
set) so who/where matching needs no NER. It only pre-fills the params `search()`
already accepts — retrieval internals are untouched.
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
_NUMWORDS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
             "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}

_MOOD_ALIASES = {"ok": "okay"}
_MOOD_WORDS = list(MOOD_BY_KEY) + list(_MOOD_ALIASES)
_MOOD_ALT = "(" + "|".join(sorted(_MOOD_WORDS, key=len, reverse=True)) + ")"

_CONNECTORS = {"on", "in", "at", "during", "for", "from", "of", "the", "with"}
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
    who: str | None = None
    where: str | None = None
    labels: list[str] = field(default_factory=list)


# --- date primitives ------------------------------------------------------


def _make_date(year, month, day):
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _month_bounds(year, month):
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


def _month_num(name):
    return _MONTHS[name[:3].lower()]


def _day_label(d):
    return f"{d.day} {_MONTH_ABBR[d.month]} {d.year}"


def _month_label(year, month):
    return f"{_MONTH_ABBR[month]} {year}"


def _span(first, last):
    """Half-open datetime range [first 00:00, day-after-last 00:00)."""
    start = datetime(first.year, first.month, first.day)
    end = datetime(last.year, last.month, last.day) + timedelta(days=1)
    return start, end


def _at(d):
    return datetime(d.year, d.month, d.day)


def _infer_day_year(month, day, today):
    """Year-less day+month → most recent past occurrence."""
    cand = _make_date(today.year, month, day)
    if cand is None:
        return None
    return cand if cand <= today else _make_date(today.year - 1, month, day)


def _infer_month_year(month, today):
    """Year-less month → this year if not in the future, else last year."""
    return today.year if month <= today.month else today.year - 1


def _strip(text, match):
    return text[: match.start()] + " " + text[match.end():]


def _result(first, last, label, text):
    start, end = _span(first, last)
    return start, end, label, text


# --- date expression scanner ---------------------------------------------


def _scan_date(text, today, *, allow_bare_month):
    """Find the leftmost single date expression → (start, end, first, last, label).

    A day expression has first == last; a month expression spans the whole month.
    `allow_bare_month` enables uncued bare months ("May") — only safe inside a date
    context (ranges / before-after / cues), never standalone (collides with names).
    """
    cands = []

    m = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", text)
    if m:
        d = _make_date(int(m[1]), int(m[2]), int(m[3]))
        if d:
            cands.append((m.start(), m.end(), d, d, _day_label(d)))

    m = re.search(rf"\b{_DAY}\s+{_MONTH_ALT}(?:,?\s+(\d{{4}}))?\b", text, re.I)
    if m:
        d = _resolve_day_month(m[1], m[2], m[3], today)
        if d:
            cands.append((m.start(), m.end(), d, d, _day_label(d)))

    m = re.search(rf"\b{_MONTH_ALT}\s+{_DAY}(?:,?\s+(\d{{4}}))?\b", text, re.I)
    if m:
        d = _resolve_day_month(m[2], m[1], m[3], today)
        if d:
            cands.append((m.start(), m.end(), d, d, _day_label(d)))

    m = re.search(rf"\b{_MONTH_ALT}\s+(\d{{4}})\b", text, re.I)
    if m:
        mo, yr = _month_num(m[1]), int(m[2])
        first, last = _month_bounds(yr, mo)
        cands.append((m.start(), m.end(), first, last, _month_label(yr, mo)))

    if allow_bare_month:
        m = re.search(rf"\b{_MONTH_ALT}\b", text, re.I)
        if m:
            mo = _month_num(m[1])
            yr = _infer_month_year(mo, today)
            first, last = _month_bounds(yr, mo)
            cands.append((m.start(), m.end(), first, last, _month_label(yr, mo)))

    return min(cands, key=lambda c: c[0]) if cands else None


def _resolve_day_month(day, month_name, year, today):
    mo = _month_num(month_name)
    if year:
        return _make_date(int(year), mo, int(day))
    return _infer_day_year(mo, int(day), today)


# --- date lanes (tried in order; first match wins) ------------------------


def _extract_range(text, today):
    """A–B ranges: 'between A and B', 'from A to B', 'A to B', 'A - B'."""
    tok1 = _scan_date(text, today, allow_bare_month=True)
    if not tok1:
        return None
    s1, e1, f1, _l1, lab1 = tok1
    rest = text[e1:]
    conn = re.match(r"\s*(?:and|to|through|until|[-–])\s+", rest, re.I)
    if not conn:
        return None
    tok2 = _scan_date(rest[conn.end():], today, allow_bare_month=True)
    if not tok2 or rest[conn.end():][: tok2[0]].strip():
        return None
    _s2, e2, _f2, l2, lab2 = tok2

    strip_start = s1
    pre = re.search(r"\b(?:between|from)\s+$", text[:s1], re.I)
    if pre:
        strip_start = pre.start()
    strip_end = e1 + conn.end() + e2
    newtext = text[:strip_start] + " " + text[strip_end:]
    start, end = _span(f1, l2)
    return start, end, f"{lab1} – {lab2}", newtext


def _extract_open_ended(text, today):
    """Open-ended: before / until / after / since / from <date>."""
    m = re.search(r"\b(before|until|after|since|from)\s+", text, re.I)
    if not m:
        return None
    kw = m[1].lower()
    rest = text[m.end():]
    tok = _scan_date(rest, today, allow_bare_month=True)
    if not tok or rest[: tok[0]].strip():
        return None
    _s, e, first, last, label = tok
    newtext = text[: m.start()] + " " + text[m.end() + e:]
    if kw == "before":
        return None, _at(first), f"before {label}", newtext
    if kw == "until":
        return None, _at(last) + timedelta(days=1), f"until {label}", newtext
    if kw == "after":
        return _at(last) + timedelta(days=1), None, f"after {label}", newtext
    # since / from
    return _at(first), None, f"since {label}", newtext


def _extract_relative_ago(text, today):
    m = re.search(
        r"\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+"
        r"(day|week|month|year)s?\s+ago\b",
        text, re.I,
    )
    if not m:
        return None
    w = m[1].lower()
    n = int(w) if w.isdigit() else _NUMWORDS[w]
    unit = m[2].lower()
    plural = "s" if n > 1 else ""
    if unit == "day":
        d = today - timedelta(days=n)
        return _result(d, d, f"{n} day{plural} ago", _strip(text, m))
    if unit == "week":
        monday = today - timedelta(days=today.weekday()) - timedelta(weeks=n)
        return _result(monday, monday + timedelta(days=6), f"{n} week{plural} ago", _strip(text, m))
    if unit == "month":
        y, mo = today.year, today.month - n
        while mo <= 0:
            mo += 12
            y -= 1
        first, last = _month_bounds(y, mo)
        return _result(first, last, _month_label(y, mo), _strip(text, m))
    y = today.year - n
    return _result(date(y, 1, 1), date(y, 12, 31), str(y), _strip(text, m))


def _extract_weekend(text, today):
    m = re.search(r"\b(this|last|next)?\s*weekend\b", text, re.I)
    if not m:
        return None
    which = (m[1] or "this").lower()
    monday = today - timedelta(days=today.weekday())
    if which == "last":
        monday -= timedelta(days=7)
    elif which == "next":
        monday += timedelta(days=7)
    sat = monday + timedelta(days=5)
    return _result(sat, sat + timedelta(days=1), f"{which} weekend", _strip(text, m))


def _extract_single(text, today):
    # cued month: "in/during/for May [2026]"
    m = re.search(rf"\b(?:in|during|for)\s+{_MONTH_ALT}(?:\s+(\d{{4}}))?\b", text, re.I)
    if m:
        mo = _month_num(m[1])
        yr = int(m[2]) if m[2] else _infer_month_year(mo, today)
        first, last = _month_bounds(yr, mo)
        return _result(first, last, _month_label(yr, mo), _strip(text, m))
    tok = _scan_date(text, today, allow_bare_month=False)
    if tok:
        s, e, first, last, label = tok
        return _result(first, last, label, text[:s] + " " + text[e:])
    return None


def _extract_relative(text, today):
    m = re.search(r"\b(?:last|past)\s+(\d{1,3})\s+(day|week)s?\b", text, re.I)
    if m:
        n = int(m[1]) * (7 if m[2].lower() == "week" else 1)
        first = today - timedelta(days=n - 1)
        unit = "weeks" if m[2].lower() == "week" else "days"
        return _result(first, today, f"last {m[1]} {unit}", _strip(text, m))

    m = re.search(r"\b(today)\b", text, re.I)
    if m:
        return _result(today, today, "today", _strip(text, m))

    m = re.search(r"\b(yesterday)\b", text, re.I)
    if m:
        y = today - timedelta(days=1)
        return _result(y, y, "yesterday", _strip(text, m))

    m = re.search(r"\b(this|last)\s+(week|month|year)\b", text, re.I)
    if m:
        which, unit = m[1].lower(), m[2].lower()
        first, last = _relative_unit(which, unit, today)
        return _result(first, last, f"{which} {unit}", _strip(text, m))

    return None


def _relative_unit(which, unit, today):
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
        return _month_bounds(first.year, first.month)
    year = today.year if which == "this" else today.year - 1
    return date(year, 1, 1), date(year, 12, 31)


def _extract_date(text, today):
    for lane in (
        _extract_range,
        _extract_open_ended,
        _extract_relative_ago,
        _extract_weekend,
        _extract_single,
        _extract_relative,
    ):
        result = lane(text, today)
        if result:
            return result
    return None, None, None, text


# --- who / where (matched against the user's known values) ----------------


def _extract_who_where(text, people, places):
    who = where = who_label = where_label = None

    # Places require a cue (at/in/@) — bare "home"/"office" collide with content.
    # Longest first so multi-word places win; "The park" matches "at the park".
    for place in sorted(places, key=len, reverse=True):
        core = re.sub(r"^the\s+", "", place, flags=re.I)
        m = re.search(rf"\b(?:at|in|@)\s+(?:the\s+)?{re.escape(core)}\b", text, re.I)
        if m:
            where, where_label = place, f"at: {place}"
            text = _strip(text, m)
            break

    # People: "with <name>" or a bare known name (names are distinctive).
    for person in sorted(people, key=len, reverse=True):
        m = re.search(rf"\bwith\s+{re.escape(person)}\b", text, re.I) or re.search(
            rf"\b{re.escape(person)}\b", text, re.I
        )
        if m:
            who, who_label = person, f"with: {person}"
            text = _strip(text, m)
            break

    return who, where, who_label, where_label, text


# --- mood -----------------------------------------------------------------


def _extract_mood(text):
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
            return key, f"mood: {key}", _strip(text, m)
    return None, None, text


# --- cleanup + entry point ------------------------------------------------


def _cleanup(text):
    tokens = [t for t in text.split() if t]
    while tokens and tokens[0].lower() in _CONNECTORS:
        tokens.pop(0)
    while tokens and tokens[-1].lower() in _CONNECTORS:
        tokens.pop()
    return " ".join(tokens)


def route_query(q, *, today=None, people=(), places=()):
    today = today or date.today()
    text = q or ""

    date_from, date_to, date_label, text = _extract_date(text, today)
    who, where, who_label, where_label, text = _extract_who_where(text, people, places)
    mood, mood_label, text = _extract_mood(text)

    residual = _cleanup(text)
    if (date_from or date_to or mood or who or where) and residual:
        if all(tok in _STOPWORDS for tok in residual.lower().split()):
            residual = ""

    labels = [lbl for lbl in (date_label, who_label, where_label, mood_label) if lbl]
    return RoutedQuery(
        residual_q=residual,
        date_from=date_from,
        date_to=date_to,
        date_label=date_label,
        mood=mood,
        who=who,
        where=where,
        labels=labels,
    )
