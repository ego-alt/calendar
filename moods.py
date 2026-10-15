from dataclasses import dataclass


@dataclass(frozen=True)
class Mood:
    key: str
    name: str
    color: str
    score: int


# Display order is the list order (best -> worst); score is the ordinal value.
# Same green → violet run as before, with the hues spaced further apart so
# Great, Good and Okay are easy to tell apart (AUDIT 3.5). The 50% alpha is
# part of the look; every chart, legend and cell uses these exact values.
MOODS = [
    Mood("great", "Great", "#8ccf4a80", score=5),
    Mood("good",  "Good",  "#2fae6e80", score=4),
    Mood("okay",  "Okay",  "#1f9a9a80", score=3),
    Mood("low",   "Low",   "#3a6fc080", score=2),
    Mood("rough", "Rough", "#6b55b880", score=1),
]
MOOD_BY_KEY: dict[str, Mood] = {m.key: m for m in MOODS}
