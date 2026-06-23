"""Local hybrid search index over diary entries (events + folded subevents).

Retrieval-only, fully on-device — no external services, no API keys:
  * dense    — fastembed/ONNX sentence embeddings, brute-force cosine over the
               metadata-filtered candidate set (vectors stored in event_embedding)
  * sparse   — SQLite FTS5 / BM25 lexical match (event_fts)
  * metadata — date range / mood / who / where filters on the live tables
The dense and sparse rankings are fused with Reciprocal Rank Fusion so exact
terms (names, places) and paraphrase/concept queries both surface.

Brute-force numpy cosine is ample for a personal diary's scale; if the corpus
ever grows large, sqlite-vec is a drop-in replacement for the dense half.
"""

import hashlib
import os
import re
import threading

import numpy as np
from flask import current_app
from sqlalchemy import and_, func
from sqlalchemy.orm import selectinload

from models import DailyLog, Event, EventEmbedding, db

EMBED_MODEL = "BAAI/bge-small-en-v1.5"  # 384-dim, ONNX, ~tens of MB (no torch)
_RRF_K = 60  # Reciprocal Rank Fusion constant
# Cosine floor for the dense half: only entries at least this similar to the
# query count as semantic matches, so an unrelated query returns nothing rather
# than every entry ranked. Lexical (FTS) matches are always exact and unaffected.
# Tunable via env for the deployment's corpus/model.
DENSE_MIN_SCORE = float(os.environ.get("SEARCH_DENSE_MIN_SCORE", "0.6"))

_model = None
_model_lock = threading.Lock()


def _get_model():
    """Lazily load the embedding model as a process-wide singleton."""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from fastembed import TextEmbedding

                # FASTEMBED_CACHE_PATH points at the model baked into the image
                # at build time, so runtime needs no network (see Dockerfile).
                _model = TextEmbedding(
                    model_name=EMBED_MODEL,
                    cache_dir=os.environ.get("FASTEMBED_CACHE_PATH") or None,
                )
    return _model


def _normalize(raw):
    vec = np.asarray(raw, dtype=np.float32)
    norm = float(np.linalg.norm(vec))
    if norm > 0:
        vec = vec / norm
    return vec.astype(np.float32)


def embed_texts(texts):
    """Embed documents → list of L2-normalized float32 vectors (cosine == dot)."""
    return [_normalize(raw) for raw in _get_model().embed(list(texts))]


def embed_query(text):
    """Embed a search query with bge's retrieval instruction → normalized vector.

    query_embed applies the model's query-side prefix, which separates relevant
    from irrelevant far better than the passage encoder for short queries.
    """
    return _normalize(next(iter(_get_model().query_embed([text]))))


# --- indexing -------------------------------------------------------------


def _clean(*parts):
    return " ".join(p.strip() for p in parts if p and p.strip())


def build_document(event):
    """An event's searchable text, with its subevents folded in."""
    parts = [event.name, event.notes, event.with_who, event.where]
    for sub in event.subevents:
        parts.extend([sub.name, sub.notes, sub.with_who, sub.where])
    return _clean(*parts)


def _source_hash(document):
    return hashlib.sha256(f"{EMBED_MODEL}\x00{document}".encode()).hexdigest()


def ensure_fts_table():
    """Create the FTS5 table if absent (the test DB is built via create_all).

    `porter` stemming means a query token and the indexed text match on their
    common stem (runs/running → run, meetings → meeting). Existing DBs get the
    tokenizer via migration; this keeps fresh/test DBs consistent.
    """
    db.session.execute(
        db.text(
            "CREATE VIRTUAL TABLE IF NOT EXISTS event_fts "
            "USING fts5(event_id UNINDEXED, text, tokenize = 'porter unicode61')"
        )
    )


def index_event(event):
    """(Re)embed and (re)index a single event. Call after the event is committed."""
    ensure_fts_table()
    document = build_document(event)
    if not document:
        remove_event(event.id)
        return

    digest = _source_hash(document)
    row = db.session.get(EventEmbedding, event.id)
    if row is not None and row.source_hash == digest and row.model == EMBED_MODEL:
        return  # text unchanged since last index — nothing to do

    vector = embed_texts([document])[0]
    if row is None:
        row = EventEmbedding(event_id=event.id)
        db.session.add(row)
    row.embedding = vector.tobytes()
    row.model = EMBED_MODEL
    row.source_hash = digest

    db.session.execute(db.text("DELETE FROM event_fts WHERE event_id = :id"), {"id": event.id})
    db.session.execute(
        db.text("INSERT INTO event_fts (event_id, text) VALUES (:id, :text)"),
        {"id": event.id, "text": document},
    )
    db.session.commit()


def remove_event(event_id):
    """Drop an event from both indexes."""
    ensure_fts_table()
    row = db.session.get(EventEmbedding, event_id)
    if row is not None:
        db.session.delete(row)
    db.session.execute(db.text("DELETE FROM event_fts WHERE event_id = :id"), {"id": event_id})
    db.session.commit()


def index_event_safe(event):
    """Index hook for request paths — never let an index error break CRUD."""
    try:
        index_event(event)
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Failed to index event %s", getattr(event, "id", "?"))


def remove_event_safe(event_id):
    try:
        remove_event(event_id)
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Failed to de-index event %s", event_id)


def reindex_all():
    """Rebuild both indexes for every event. Returns the count indexed."""
    ensure_fts_table()
    db.session.execute(db.text("DELETE FROM event_fts"))
    db.session.query(EventEmbedding).delete()
    db.session.commit()
    events = Event.query.options(selectinload(Event.subevents)).all()
    for event in events:
        index_event(event)
    return len(events)


# --- querying -------------------------------------------------------------


def _candidate_events(user_id, *, date_from, date_to, mood, who, where):
    """Metadata-filtered, user-scoped events, newest first."""
    query = Event.query.filter(Event.user_id == user_id)  # excludes NULL user_id
    if date_from is not None:
        query = query.filter(Event.start_time >= date_from)
    if date_to is not None:
        query = query.filter(Event.start_time < date_to)
    if who:
        query = query.filter(Event.with_who.ilike(f"%{who}%"))
    if where:
        query = query.filter(Event.where.ilike(f"%{where}%"))
    if mood:
        query = query.join(
            DailyLog,
            and_(
                DailyLog.user_id == Event.user_id,
                DailyLog.date == func.date(Event.start_time),
            ),
        ).filter(DailyLog.mood_key == mood)
    return query.order_by(Event.start_time.desc()).all()


def _dense_rank(query_text, user_id, candidate_ids):
    """Event ids ranked by cosine similarity to the query (best first)."""
    rows = (
        db.session.query(EventEmbedding.event_id, EventEmbedding.embedding)
        .join(Event, Event.id == EventEmbedding.event_id)
        .filter(Event.user_id == user_id)
        .all()
    )
    rows = [r for r in rows if r[0] in candidate_ids]
    if not rows:
        return []
    ids = [r[0] for r in rows]
    matrix = np.stack([np.frombuffer(r[1], dtype=np.float32) for r in rows])
    scores = matrix @ embed_query(query_text)
    ranked = [(ids[i], float(scores[i])) for i in np.argsort(-scores)]
    return [eid for eid, score in ranked if score >= DENSE_MIN_SCORE]


def _fts_match(query_text):
    """Build a safe FTS5 MATCH expression (OR of quoted tokens)."""
    tokens = re.findall(r"\w+", query_text, flags=re.UNICODE)
    if not tokens:
        return None
    return " OR ".join(f'"{t}"' for t in tokens)


def _sparse_rank(query_text, candidate_ids):
    """Event ids ranked by BM25 lexical relevance (best first)."""
    match = _fts_match(query_text)
    if not match:
        return []
    rows = db.session.execute(
        db.text(
            "SELECT event_id, bm25(event_fts) AS rank "
            "FROM event_fts WHERE event_fts MATCH :q ORDER BY rank"
        ),
        {"q": match},
    ).all()
    return [r[0] for r in rows if r[0] in candidate_ids]


def _rrf(*ranked_lists):
    """Reciprocal Rank Fusion → [(event_id, score)] sorted best first."""
    scores = {}
    for ranked in ranked_lists:
        for rank, eid in enumerate(ranked):
            scores[eid] = scores.get(eid, 0.0) + 1.0 / (_RRF_K + rank + 1)
    return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)


def search(user_id, q=None, *, date_from=None, date_to=None, mood=None,
           who=None, where=None, limit=20):
    """Hybrid search. Returns [(Event, score|None)] best first.

    With no query text, returns the metadata-filtered candidates by recency
    (score None). With query text, fuses dense + sparse rankings over the
    candidate set via RRF.
    """
    ensure_fts_table()
    q = (q or "").strip()

    candidates = _candidate_events(
        user_id, date_from=date_from, date_to=date_to, mood=mood, who=who, where=where
    )
    if not candidates:
        return []
    by_id = {e.id: e for e in candidates}

    if not q:
        return [(e, None) for e in candidates[:limit]]

    candidate_ids = set(by_id)
    dense = _dense_rank(q, user_id, candidate_ids)
    sparse = _sparse_rank(q, candidate_ids)
    fused = _rrf(dense, sparse)[:limit]
    return [(by_id[eid], score) for eid, score in fused if eid in by_id]
