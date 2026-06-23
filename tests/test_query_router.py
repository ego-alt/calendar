from datetime import date, datetime

import pytest

from query_router import route_query

TODAY = date(2026, 6, 23)  # a Tuesday


def _r(q):
    return route_query(q, today=TODAY)


def test_iso_date():
    r = _r("2026-06-16")
    assert (r.date_from, r.date_to) == (datetime(2026, 6, 16), datetime(2026, 6, 17))
    assert r.residual_q == ""
    assert r.date_label == "16 Jun 2026"


@pytest.mark.parametrize("q", ["16 Jun", "16th June", "Jun 16", "June 16th"])
def test_day_month_infers_recent_year(q):
    # 16 Jun 2026 is in the past relative to 23 Jun 2026 → keep this year.
    r = _r(q)
    assert (r.date_from, r.date_to) == (datetime(2026, 6, 16), datetime(2026, 6, 17))


def test_day_month_future_rolls_back_a_year():
    # 25 Dec hasn't happened yet in 2026 → last year.
    r = _r("25 Dec")
    assert (r.date_from, r.date_to) == (datetime(2025, 12, 25), datetime(2025, 12, 26))


def test_explicit_year_kept():
    r = _r("16 June 2024")
    assert (r.date_from, r.date_to) == (datetime(2024, 6, 16), datetime(2024, 6, 17))


def test_yesterday():
    r = _r("yesterday")
    assert (r.date_from, r.date_to) == (datetime(2026, 6, 22), datetime(2026, 6, 23))


def test_this_week_is_monday_to_sunday():
    # Week containing Tue 23 Jun 2026 → Mon 22 .. Sun 28 (exclusive 29).
    r = _r("this week")
    assert (r.date_from, r.date_to) == (datetime(2026, 6, 22), datetime(2026, 6, 29))


def test_last_month():
    r = _r("last month")
    assert (r.date_from, r.date_to) == (datetime(2026, 5, 1), datetime(2026, 6, 1))


def test_last_n_days_trailing_window():
    r = _r("last 7 days")  # 17..23 inclusive
    assert (r.date_from, r.date_to) == (datetime(2026, 6, 17), datetime(2026, 6, 24))


def test_residual_content_with_date():
    r = _r("dinner on 16 jun")
    assert r.date_from == datetime(2026, 6, 16)
    assert r.residual_q == "dinner"


def test_filler_only_residual_becomes_empty_lookup():
    r = _r("what happened on 16 Jun 2026")
    assert r.date_from == datetime(2026, 6, 16)
    assert r.residual_q == ""  # pure metadata lookup


def test_mood_cue_gated():
    r = _r("feeling rough")
    assert r.mood == "rough"
    assert r.residual_q == ""


def test_mood_day_phrase_and_residual():
    r = _r("rough days at work")
    assert r.mood == "rough"
    assert r.residual_q == "work"


def test_bare_mood_word_is_not_a_filter():
    r = _r("good news")  # no cue → "good" stays content, not a mood filter
    assert r.mood is None
    assert r.residual_q == "good news"


def test_combined_date_and_mood():
    r = _r("feeling low last week")
    assert r.mood == "low"
    assert (r.date_from, r.date_to) == (datetime(2026, 6, 15), datetime(2026, 6, 22))
    assert r.labels == ["last week", "mood: low"]


def test_plain_query_untouched():
    r = _r("coffee with the team")
    assert r.date_from is None and r.mood is None
    assert r.residual_q == "coffee with the team"


def test_bare_month_is_not_a_date():
    # "June" alone collides with names → deliberately not a date lane.
    r = _r("June")
    assert r.date_from is None
    assert r.residual_q == "June"
