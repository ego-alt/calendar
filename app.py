from flask import Flask, render_template, jsonify, request, session
from datetime import datetime, timedelta
import calendar
import logging
from models import db, User, Mood, DailyLog

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///events.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = 'your-secret-key-here'  # Required for sessions

logger = logging.getLogger(__name__)

db.init_app(app)

# Store mood data (in a real app, you'd use a database)
mood_data = {}

def get_month_calendar(year, month):
    # Get the first day of the month and number of days
    first_day = datetime(year, month, 1)
    _, num_days = calendar.monthrange(year, month)
    
    # Get the previous month's trailing days
    if first_day.weekday() != 0:  # If month doesn't start on Monday
        prev_month = first_day - timedelta(days=1)
        _, prev_month_days = calendar.monthrange(prev_month.year, prev_month.month)
        prev_days = list(range(
            prev_month_days - first_day.weekday() + 1,
            prev_month_days + 1
        ))
    else:
        prev_days = []
    
    # Current month's days
    current_days = list(range(1, num_days + 1))
    
    # Next month's leading days
    total_days = len(prev_days) + len(current_days)
    next_days = list(range(1, 43 - total_days))
    
    return {
        'prev_days': prev_days,
        'current_days': current_days,
        'next_days': next_days
    }

def initialize_user():
    with app.app_context():
        # Create default user if it doesn't exist
        user = User.query.first()
        if not user:
            user = User(username='default')
            db.session.add(user)
            db.session.commit()
        return user

# Update the user fetching in routes
def get_current_user():
    return User.query.get(session['user_id'])

@app.route('/')
def index():
    today = datetime.now()
    calendar_data = get_month_calendar(today.year, today.month)
    
    # Get user (in a real app, you'd get this from the session)
    user = User.query.first()
    
    # Fetch mood data for current month
    start_date = datetime(today.year, today.month, 1).date()
    end_date = (datetime(today.year, today.month + 1, 1) if today.month < 12 
               else datetime(today.year + 1, 1, 1)).date()
    
    daily_logs = DailyLog.query.filter(
        DailyLog.user_id == user.id,
        DailyLog.date >= start_date,
        DailyLog.date < end_date
    ).join(Mood).all()
    
    # Create a dictionary of day -> mood color
    mood_colors = {
        log.date.day: log.mood.color
        for log in daily_logs
    }
    
    return render_template(
        'index.html',
        calendar_data=calendar_data,
        date_label=today.strftime('%B %Y'),
        current_year=today.year,
        current_month=today.month,
        current_day=today.day,
        mood_colors=mood_colors
    )

@app.route('/get_month', methods=['GET'])
def get_month():
    year = int(request.args.get('year'))
    month = int(request.args.get('month'))
    
    # Handle year transition
    if month == 13:
        month = 1
        year += 1
    
    # Get the calendar data
    calendar_data = get_month_calendar(year, month)
    
    # Get user (in a real app, you'd get this from the session)
    user = User.query.first()
    
    # Fetch all mood data for the month
    start_date = datetime(year, month, 1).date()
    end_date = (datetime(year, month + 1, 1) if month < 12 else datetime(year + 1, 1, 1)).date()
    
    daily_logs = DailyLog.query.filter(
        DailyLog.user_id == user.id,
        DailyLog.date >= start_date,
        DailyLog.date < end_date
    ).join(Mood).all()
    
    # Create a dictionary of day -> mood color
    mood_colors = {
        log.date.day: log.mood.color
        for log in daily_logs
    }
    
    return jsonify({
        'calendar_data': calendar_data,
        'month_label': datetime(year, month, 1).strftime('%B %Y'),
        'mood_colors': mood_colors
    })

@app.route('/update_mood', methods=['POST'])
def update_mood():
    data = request.json
    logger.info(f"Received mood update request with data: {data}")
    
    try:
        # Get user from session
        user = get_current_user()
        if not user:
            logger.debug("Creating default user")
            user = User(username='default')
            db.session.add(user)
            db.session.flush()
        
        date = datetime(int(data['year']), int(data['month']), int(data['day'])).date()
        logger.debug(f"Looking up daily log for date: {date}")
        daily_log = DailyLog.query.filter_by(
            user_id=user.id,
            date=date
        ).first()
        
        if data['color'] is None:
            # If color is null, delete the daily log if it exists
            if daily_log:
                db.session.delete(daily_log)
        else:
            # Handle normal mood setting
            mood = Mood.query.filter_by(color=data['color']).first()
            if not mood:
                logger.debug(f"Creating new mood with color: {data['color']}")
                mood = Mood(color=data['color'], name='Custom')
                db.session.add(mood)
                db.session.flush()
            
            if daily_log:
                logger.info(f"Updating existing daily log for date: {date}")
                daily_log.mood_id = mood.id
            else:
                logger.info(f"Creating new daily log for date: {date}")
                daily_log = DailyLog(
                    user_id=user.id,
                    date=date,
                    mood_id=mood.id
                )
                db.session.add(daily_log)
        
        db.session.commit()
        logger.info("Successfully updated mood")
        return jsonify({'status': 'success'})
        
    except Exception as e:
        logger.error(f"Error updating mood: {str(e)}", exc_info=True)
        db.session.rollback()
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/get_events', methods=['GET'])
def get_events():
    year = request.args.get('year')
    month = request.args.get('month')
    day = request.args.get('day')
    date_key = f"{year}-{month}-{day}"
    
    # Fetch events for the given date
    events = mood_data.get(date_key, [])
    
    return jsonify({'events': events})

if __name__ == '__main__':
    app.run(debug=True)