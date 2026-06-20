from dataclasses import dataclass


@dataclass(frozen=True)
class Mood:
    key: str
    name: str
    color: str
    score: int


# Display order is the list order (best -> worst); score is the ordinal value.
MOODS = [
    Mood("great", "Great", "#2ecc7180", score=5),
    Mood("good",  "Good",  "#16a58580", score=4),
    Mood("okay",  "Okay",  "#00959580", score=3),
    Mood("low",   "Low",   "#3674b580", score=2),
    Mood("rough", "Rough", "#5b5bb580", score=1),
]
MOOD_BY_KEY: dict[str, Mood] = {m.key: m for m in MOODS}
