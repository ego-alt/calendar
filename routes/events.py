from datetime import datetime, timedelta
from flask import Blueprint, jsonify, request
from flask_login import current_user
from models import db, Event, SubEvent
from utils import parse_event_datetime


event_blueprint = Blueprint("events", __name__, url_prefix="/events")


@event_blueprint.route("/", methods=["GET", "POST"])
def events():
    if not current_user.is_authenticated:
        return jsonify({"status": "error", "message": "Authentication required"}), 401
    try:
        if request.method == "GET":
            year = int(request.args.get("year"))
            month = int(request.args.get("month"))
            day = int(request.args.get("day"))

            # Get start and end of the requested day
            start_date = datetime(year, month, day)
            end_date = start_date + timedelta(days=1)

            # Query events for the current user and day
            events = (
                Event.query.filter(
                    Event.user_id == current_user.id,
                    Event.start_time < end_date,
                    Event.end_time >= start_date,
                )
                .order_by(Event.start_time)
                .all()
            )

            # Format events for JSON response and include subevents
            events_data = []
            for event in events:
                # Get subevents for this event
                subevents = SubEvent.query.filter_by(event_id=event.id).order_by(SubEvent.start_time).all()
                
                # Format subevents
                subevents_data = [
                    {
                        "id": subevent.id,
                        "name": subevent.name,
                        "start_time": subevent.start_time.strftime("%Y-%m-%d %H:%M"),
                        "end_time": subevent.end_time.strftime("%Y-%m-%d %H:%M") if subevent.end_time else None,
                        "notes": subevent.notes,
                        "with_who": subevent.with_who,
                        "where": subevent.where,
                    }
                    for subevent in subevents
                ]
                
                # Add event with its subevents
                events_data.append({
                    "id": event.id,
                    "name": event.name,
                    "start_time": event.start_time.strftime("%Y-%m-%d %H:%M"),
                    "end_time": event.end_time.strftime("%Y-%m-%d %H:%M")
                    if event.end_time
                    else None,
                    "notes": event.notes,
                    "with_who": event.with_who,
                    "where": event.where,
                    "subevents": subevents_data
                })

            return jsonify({"status": "success", "events": events_data})

        else:  # POST method
            data = request.json
            start_datetime = parse_event_datetime(
                data["start_date"], data.get("start_time")
            )
            end_datetime = parse_event_datetime(data["end_date"], data.get("end_time"))

            event = Event(
                user_id=current_user.id,
                name=data["name"],
                start_time=start_datetime,
                end_time=end_datetime,
                notes=data.get("notes"),
                with_who=data.get("with_who"),
                where=data.get("where"),
            )

            db.session.add(event)
            db.session.commit()

            return jsonify(
                {"status": "success", "message": "Event created successfully"}
            )

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@event_blueprint.route("/<int:event_id>", methods=["PUT", "DELETE"])
def manage_event(event_id):
    if not current_user.is_authenticated:
        return jsonify({"status": "error", "message": "Authentication required"}), 401
    try:
        event = Event.query.filter_by(id=event_id, user_id=current_user.id).first()

        if not event:
            return jsonify({"status": "error", "message": "Event not found"}), 404

        if request.method == "DELETE":
            db.session.delete(event)
            db.session.commit()
            return jsonify({"status": "success", "message": "Event deleted"})

        # PUT method
        data = request.json
        start_datetime = parse_event_datetime(
            data["start_date"], data.get("start_time")
        )
        end_datetime = parse_event_datetime(data["end_date"], data.get("end_time"))

        event.name = data["name"]
        event.start_time = start_datetime
        event.end_time = end_datetime
        event.notes = data.get("notes")
        event.with_who = data.get("with_who")
        event.where = data.get("where")

        db.session.commit()
        return jsonify({"status": "success", "message": "Event updated"})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@event_blueprint.route("/<int:event_id>/subevents", methods=["POST"])
def subevents(event_id):
    if not current_user.is_authenticated:
        return jsonify({"status": "error", "message": "Authentication required"}), 401
    
    try:
        # First verify the parent event belongs to the current user
        event = Event.query.filter_by(id=event_id, user_id=current_user.id).first()
        if not event:
            return jsonify({"status": "error", "message": "Event not found"}), 404
        
        data = request.json
        start_datetime = parse_event_datetime(data["start_date"], data.get("start_time"))
        end_datetime = parse_event_datetime(data["end_date"], data.get("end_time"))
        
        # Validate that subevent time is within parent event time
        if start_datetime < event.start_time or (event.end_time and end_datetime > event.end_time):
            return jsonify({
                "status": "error", 
                "message": "Subevent must occur within the parent event's timeframe"
            }), 400
        
        subevent = SubEvent(
            event_id=event_id,
            name=data["name"],
            start_time=start_datetime,
            end_time=end_datetime,
            notes=data.get("notes"),
            with_who=data.get("with_who"),
            where=data.get("where"),
        )
        
        db.session.add(subevent)
        db.session.commit()
        
        return jsonify({"status": "success", "message": "Subevent created successfully"})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@event_blueprint.route("/subevents/<int:subevent_id>", methods=["PUT", "DELETE"])
def manage_subevent(subevent_id):
    if not current_user.is_authenticated:
        return jsonify({"status": "error", "message": "Authentication required"}), 401
    
    try:
        # Find the subevent and verify it belongs to the current user
        subevent = SubEvent.query.join(Event).filter(
            SubEvent.id == subevent_id,
            Event.user_id == current_user.id
        ).first()
        
        if not subevent:
            return jsonify({"status": "error", "message": "Subevent not found"}), 404
        
        if request.method == "DELETE":
            db.session.delete(subevent)
            db.session.commit()
            return jsonify({"status": "success", "message": "Subevent deleted"})
        
        # PUT method
        data = request.json
        start_datetime = parse_event_datetime(data["start_date"], data.get("start_time"))
        end_datetime = parse_event_datetime(data["end_date"], data.get("end_time"))
        
        # Validate that subevent time is within parent event time
        parent_event = Event.query.get(subevent.event_id)
        if start_datetime < parent_event.start_time or (parent_event.end_time and end_datetime > parent_event.end_time):
            return jsonify({
                "status": "error", 
                "message": "Subevent must occur within the parent event's timeframe"
            }), 400
        
        subevent.name = data["name"]
        subevent.start_time = start_datetime
        subevent.end_time = end_datetime
        subevent.notes = data.get("notes")
        subevent.with_who = data.get("with_who")
        subevent.where = data.get("where")
        
        db.session.commit()
        return jsonify({"status": "success", "message": "Subevent updated"})
    
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
