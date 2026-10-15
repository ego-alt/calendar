# Calendar: product audit

A review of the calendar as a paid app before launch. Its job is a **retrospective life log**: mark how each day felt, write down what happened, attach the receipts and tickets that prove it (scanned with the phone app), then look back and spot patterns in Stats.

The look is intentional: the dark warm palette, hatched unlogged days, mood-tinted cells, the card style and the Stats page. Nothing here asks to make it more generic. The aim is for it to feel **finished and trustworthy**.

**How this was tested.** I read the whole codebase (Flask app, `index.js`, stats, search, CSS) and ran it against a throwaway database:
- 355 entries and about 300 logged moods over 13 months, plus monthly markers;
- a multi-day trip with sub-entries;
- a 200-character title, notes containing `<b>` and `a < b`, multi-line notes, emoji and accents;
- a day with 30 entries;
- a receipt image and a PDF ticket.

I walked through it in Chrome at 1280×800 with a mouse, and at 375×667 with touch emulation. I also checked failure cases (network cut, oversized upload, bad input) and ran date parsing in Safari's JavaScript engine. The project's 67 tests pass. Nothing in the repo was changed.

**Tags:** **[confirmed]** = seen in the running app. **[code]** = from reading the code, not reproduced.

---

## 1. Core purpose: features that don't serve it

**1.1 The app talks like a planner, but it's a diary** [confirmed]
- **What:** The day panel says *"No events scheduled"*. Writing about your day means clicking **Add Event**, filling a *New Event* form with start and end date and time, and adding *Subevents*. Week view is a 24-hour scheduling grid.
- **Where:** `static/js/index.js` `showSidebar`, `toggleEventForm`; `templates/index.html` `#eventForm`
- **Why:** You're recording what happened, not booking a meeting. Planner words make each entry feel like admin, and the required date/time fields slow down the one thing you do every day.
- **Fix:**
  - Use diary language: *entry* instead of *event*; *"Nothing written for this day yet"*; **Write about this day**.
  - Keep times optional and folded away ("Add a time").
  - Call sub-events *moments* or *details* (see 6).
- **Status:** Done. The app now speaks diary: *Write about this day*, *Nothing written for this day yet.*, *New entry / Edit entry / Add a moment*, *What happened? · Who was there? · Where?*, From/To with *Times are optional*, *All day* in week view, and *Days with entries* in Stats.

**1.2 Setting the mood, the core action, has no proper home** [confirmed]
- **What:** You set a mood through an eye icon that's invisible until you hover over a day in month view. You pick from five unlabelled colour dots, whose names exist only as tooltips. You can't set or even see the mood in the day panel, week view, year view or diary.
- **Where:** `index.js` `setupMonthGridListeners` (`.eye-icon`); `index.html` `#colorPicker`; `index.css` `.eye-icon { opacity: 0 }`
- **Why:** Mood feeds everything in Stats, yet it's the least discoverable control in the app. The eye means "view", not "how did today feel".
- **Fix:**
  - Put a mood row at the top of the day panel: five labelled swatches with the current one selected, one tap to change it.
  - Keep the month-grid shortcut, but make it visible (see 7.1).
  - Show the day's mood in the diary and search results.
- **Status:** Done (diary and search show it from #8 and #10). The day panel opens with a mood row: five labelled swatches, the current one highlighted, one tap to set, and *Clear mood* when one is set. The change shows on the grid at once, rolls back with a message if the save fails, and the toast offers Undo (the server returns the previous mood). The month-grid eye stays as a desktop hover shortcut, now labelled *Set mood*.

**1.3 The red marker is hidden and never explained** [confirmed]
- **What:** A double-click on a day toggles a red dot. Nothing in the app says this exists or what it means; the code calls it "period" (`Error toggling period`). It shows on the Stats trend line with no legend entry. On touch it doesn't work at all (7.3).
- **Where:** `index.js` dblclick handler; `routes/mood.py` `toggle_marker`; `stats.js` trend marks
- **Why:** It's a real tracking feature, and you use it to correlate with mood. Right now it's unreachable on the phone and unlabelled everywhere.
- **Fix:**
  - Add a visible toggle in the day panel with your own label (a setting, default "Marked").
  - Add a legend entry in Stats, e.g. "● Marked day".
- **Status:** Done (Stats legend in #10). A visible *Mark this day* / *Marked* toggle in the day panel (with a tooltip saying where the dot shows), working on touch; double-click on a day still works on desktop. Both go through one toggle with a toast.

**1.4 The "look back" views are cramped side panels** [confirmed]
- **What:**
  - **Diary** ("Month Overview") and **Year** ("Year Overview") open as 300px side panels over the calendar.
  - The diary shows entries but no moods or attachments, has no way to change month, and justifies its notes ("Hiked   the   Lost   Valley.").
  - Year view always starts at January, its days can't be tapped, and it shows no markers or entry dots.
- **Where:** `index.html` `#diaryView`, `#yearView`; `index.js` `loadMonthEvents`, `loadYearView`
- **Why:** Reading back is half the point of the app, and these are its reading views.
- **Fix:**
  - Make Diary a full view: mood colour beside each date, attachments inline, ‹ month › navigation.
  - Make Year a full view where every day opens.
  - **Merge** Year with the Stats "Mood calendar" heatmap, which already shows the same thing. Keep one year grid, tappable, with a year picker. Show it under Stats and drop the Year panel.
- **Status:** Done. Diary and Year are full views at every width (centred on desktop), each with a sticky ‹ › title bar.
  - **Diary** (*Diary · October 2026*): each day shows its mood swatch and name, its marker, its entries with times, people, places, notes and moments (escaped, left-aligned), and its attachments as thumbnails or file chips. Days with only a mood are listed too. *Nothing written in October.* when empty, and errors offer retry.
  - **Year** (*2026*): every day is a button that opens the day panel over the view, with marker and entry dots and today ringed. It opens scrolled to the current month, and mood changes repaint the cell in place.
  - On the merge: Year is the one tappable year grid. The Stats heatmap stays as a summary and becomes tappable too (#10), rather than keeping two separate year grids.

**1.5 Three different ways to switch calendar views** [confirmed]
- **What:**
  - Desktop: a Month/Week dropdown, plus separate icon buttons for Year and Diary, plus the d/y keys.
  - Phone: a clear four-way bottom bar (Month · Week · Year · Diary).
- **Where:** `index.html` `.shell-actions`, `#modeBar`
- **Why:** The phone already has the right model; desktop scatters it.
- **Fix:** Use the same four-way segmented control on desktop in place of the dropdown and two icons.
- **Status:** Done. Desktop has one **Month · Week · Year · Diary** segmented control, matching the phone's bottom bar; the dropdown and the two icon buttons are gone. Both reflect the active mode.

**1.6 Week view is a scheduling grid** [confirmed]
- **What:** A 00:00–24:00 time grid. Most diary entries are loosely timed. On a phone the entries shrink to unreadable stubs ("08:…", "10:…").
- **Where:** `index.js` `renderWeek`
- **Why:** For looking back, a week is better read as seven days than as hours.
- **Fix:** Show week as seven day cards (date, mood colour, entry titles), and put the time grid behind a toggle on desktop. On phones, use only the card list.
- **Status:** Done for phones (7.7). On desktop the time grid stays, since it reads well at that width and shows when things happened; entries there now use en-dash times. A day-card option on desktop is left for later.

**1.7 Receipts and tickets are stored but not really shown** [confirmed]
- **What:**
  - Attachments belong to the day, not an entry, and have no caption.
  - A receipt previews as a narrow white strip you can't read; a PDF shows a broken filename ("Concert t / icket - …").
  - Opening one shows the raw file in a new tab.
  - The section has no heading and sits below **Add Event**.
  - On desktop, the add-attachment **+** is hidden under the top bar (2.5).
  - iPhone photos uploaded as HEIC won't preview in Chrome [code].
- **Where:** `index.js` `renderAttachmentsSection`; `routes/attachments.py`
- **Why:** Scanning receipts and tickets is a headline feature, and it's where the phone app meets this one. It should look like a keepsake, not a file listing.
- **Fix:**
  - A "Receipts & tickets" strip with proper thumbnails (render the first page of PDFs).
  - A lightbox viewer with swipe.
  - An optional caption and an optional link to an entry.
  - Convert HEIC to JPEG on upload.
- **Status:** Done (PDF first-page previews left out; PDFs show a clear icon card).
  - **Display:** each day has a *Receipts & tickets* strip of uniform 3:4 thumbnails, made server-side with Pillow (480 px, turned the right way up; older uploads get one on first view). PDFs show as icon cards whose names wrap at spaces.
  - **Viewer:** tapping one opens an in-app viewer with ‹ › arrows, arrow keys and swipe, *Original*, *Delete* (with Undo), a caption, and a *Belongs to* menu that links it to one of the day's entries; linked ones then show in that entry's card.
  - **Upload:** iPhone HEIC photos are converted to JPEG on upload, and progress shows as *Uploading 2 of 3…*. The attach control says *photos or PDFs, up to 10 MB each*.
  - **Diary:** thumbnails open the viewer read-only.
  - **Tests:** cover HEIC, thumbnails, captions and links.

**1.8 Stats show *that* mood changed, never *why*** [confirmed]
- **What:**
  - Stats cover a fixed trailing 12 months, with no year picker or period comparison.
  - Nothing links mood to the people, places or entries you've logged, though all that data is there.
  - "Days with events" counts busyness, not how those days felt.
- **Where:** `utils.py` `get_stats_data`; `stats.js`
- **Why:** "Spot trends" is the reason Stats exists. The most useful trend in a life log is "I'm happier on days with Sam / at the climbing wall / after 8 hours' sleep".
- **Fix:**
  - Add a **"Mood with…"** card: average mood for each person and place logged at least N times, compared with your overall average.
  - Add a year/range picker.
  - Optionally add "this month vs last month".
- **Status:** Done.
  - **Mood with…:** a new Stats card lists the people and places seen on 3+ mood-logged days, each with its average mood against your overall average (*Leith +0.2 · 38 days*), as a centred bar. It counts entries and moments.
  - **Period:** a range picker switches between *Last 12 months* and any calendar year with logs; the page title, tiles, heatmap, trend, mix and entry counts all follow. For a past year the streak tile becomes *average mood (of 5)*.
  - **Tests:** cover both.

---

## 2. Missing states

**2.1 Today isn't marked in month view, and there's no way back to it** [confirmed]
- **What:** Today's cell has no special style (week view does highlight it). After browsing months, nothing takes you back to today.
- **Where:** `index.html` / `index.js` month grid (no `today` class)
- **Fix:** Ring today's cell the way week view does. Add a **Today** button and a `t` shortcut.
- **Status:** Done. Today's cell is ringed in Month and Year. A **Today** button appears beside the title whenever the view doesn't contain today (month, week or year) and brings every view back; `t` does the same.

**2.2 Signed out, it just looks empty** [confirmed]
- **What:** In standalone mode, a signed-out visitor sees an empty month and an empty day panel, with no prompt to sign in (only the door icon in the corner). `/`, `/get_month`, `/get_week` and `/get_year` don't require a login.
- **Where:** `routes/index.py`; `templates/index.html`
- **Fix:** Show the sign-in card in place of the calendar, and require login on those endpoints. Behind the dashboard proxy this doesn't arise.
- **Status:** Done. Signed out in standalone mode, the page is the sign-in card (*Your calendar, moods and diary are waiting.*) with the calendar, tabs and mode bar hidden; it can't be dismissed into an empty calendar. `/get_month`, `/get_week` and `/get_year` now require sign-in (401 with a plain message), and Stats isn't pre-loaded when signed out. Behind the dashboard nothing changes: it handles sign-in. Covered by tests.

**2.3 Failures happen silently** [confirmed]
- **What:** With the network cut:
  - picking a mood closed the picker, the colour didn't stick, and no message appeared;
  - saving a new entry made the form disappear with no message.
- **Status:** Done. Failures say so: entry saves keep the form with the reason (#1), mood and marker changes roll back with a message, deletes report errors, a failed month or week load shows *Couldn't load December 2026.* with **Retry**, and Stats shows an error with *Try again*. (Offline drafts: 2.10.)

  Delete, attachment delete and stats failures only log to the console. Elsewhere the app uses `alert()`.
- **Where:** `index.js` (most `catch` blocks are `console.error`); `shell.js` `loadStats`
- **Why:** You can't trust a diary that may not have saved.
- **Fix:**
  - Add one toast pattern for every save, delete and failure (*"Saved"*, *"Couldn't save — your text is still here"*).
  - Keep the form open with its text when a save fails.

**2.4 No loading states, and the day panel shows the wrong day while loading** [confirmed]
- **What:**
  - On a slow connection, opening 9 October showed 6 October's entries until the new ones arrived.
  - Changing month shows nothing until the new month renders, and key presses during a load are dropped (`isLoading`).
  - Stats has no loading or error state; the cards stay blank if it fails.
- **Where:** `index.js` `showSidebar`, `updateCalendarView`; `shell.js`
- **Fix:**
  - Clear the panel to the new date heading plus a skeleton immediately.
  - Dim the grid while a month loads.
  - Give Stats a skeleton and a retry message.
- **Status:** Done. The day panel shows the new date and *Loading…* at once (never the previous day). Month and week loads dim the grid after 150 ms, and every key press or swipe counts: only the newest load is drawn, so three quick `l` presses go exactly three months on. Stats shows *Loading your stats…* on its first load, and an error with retry.

**2.5 The desktop day panel's header sits under the top bar** [confirmed]
- **What:** The panel starts at the top of the window, so its header (the date and the add-attachment +) sits at y 20–44, entirely under the 47px top bar. You can't click the **+** on desktop. On phones the sheet is placed correctly.
- **Where:** `index.css` `.sidebar` (fixed, full height, from 0)
- **Fix:** Start the panel below the bar: `top: var(--shell-bar-h)` and `height: calc(100dvh - var(--shell-bar-h))`.
- **Status:** Done. On desktop the day panel starts below the top bar (as Diary and Year already did). The date heading and the attach button (now a paperclip) are visible and clickable (checked with a hit test). Phones keep the bottom sheet.

**2.6 Text that looks like HTML is rendered as HTML** [confirmed]
- **What:** A note reading `Check <b>bold</b>` displays in bold in the day panel and diary. A note containing `a<b` with nothing after it can swallow the rest of the text.
- **Where:** `index.js` `showSidebar` and `loadMonthEvents` insert `event.name`, `with_who`, `where` and `notes` unescaped. `escapeHtml` exists, and search uses its own escaping.
- **Why:** Diaries are full of `<3`, `->` and pasted text. This is also a stored-script hole, worth closing since attachments come from a second app.
- **Fix:** Escape every user field at render time with the existing `escapeHtml`.
- **Status:** Done. Every user field is escaped in the day panel and diary (search already was). `<b>bold</b>` and `a < b` now display as typed.

**2.7 Dates may break on iPhone** [confirmed in Safari's JS engine, iOS untested]
- **What:**
  - `formatTimeOfDay`, `formatEventDisplay` and the diary call `new Date("2026-10-06 09:00")`.
  - On this Mac's Safari engine (macOS 12) that parses as **Invalid Date**; the "T" form (`2026-10-06T09:00`) parses fine.
  - The helper `parseLocalDateTime` exists for exactly this but isn't used in those places.
- **Where:** `index.js`
- **Fix:**
  - Use `parseLocalDateTime` everywhere, or have the API return ISO `YYYY-MM-DDTHH:MM`.
  - Check the day panel on your iPhone.
- **Status:** Done. Every "YYYY-MM-DD HH:MM" string is parsed by `parseLocalDateTime` (time labels, diary grouping, diary times), never `new Date(string)`. Checked in Safari's JS engine on this Mac: the helper parses correctly where `new Date()` gave Invalid Date. Stats already used the safe `T` form.

**2.8 Weird and large data** [confirmed]
- Long titles, long place names, multi-line notes, emoji and accents all wrap and display well in the panel and diary. Line breaks in notes are kept.
- Week view clips entries to "08:00 - 1…"; on phones it's worse (1.6).
- A day with 30 entries makes a long panel, and the new-entry form opens at the very bottom, below all of them and the attachments.
- Search silently stops at 20 results. "hike" returned exactly 20, with no "showing 20 of N" and no way to load more.
- **Fix:** Open the entry form at the top of the panel. In search, show the count and a **More** button.
- **Status:** Done. Long titles, places and notes wrap in the panel, diary and week cards; the entry form opens at the top even on a 30-entry day; search says how many it shows and loads more; attachment names wrap at spaces. On the desktop week grid, very short entries still clip their time (*08:00–1…*) — the full entry is a tap away.

**2.9 First run** [code]
- **What:** A new user gets an empty month and Stats tiles reading "0 days logged of 365" and "0 day current streak", with empty charts. Only the trend chart explains itself ("Not enough data yet.").
- **Fix:**
  - Add a one-time card on the calendar: *"Tap a day to note how it felt and what happened."*
  - In Stats, replace the zero tiles with *"Stats appear after a week of logging."*
- **Status:** Done. With nothing logged yet, the calendar shows a *Start with today.* card explaining what a day holds, with a **Log today** button that opens today's panel; it disappears after the first mood or entry. Stats shows *Your stats fill in once you've logged a few days…* instead of zero tiles and empty charts (and *No moods logged in 2024.* for an empty year). Covered by a test and checked with a fresh account.

**2.10 Offline**
- **What:** Nothing works offline. There's no manifest or service worker, unlike library and tapes now. A lost connection mid-entry surfaces nothing (2.3).
- **Fix:**
  - At least keep unsent text in local storage and retry.
  - Ideally make it installable with an offline shell, as tapes now is.
- **Status:** Done (reading offline; writing still needs the connection).
  - **Installable:** the calendar has a manifest, a mood-grid icon and favicon, and a theme colour.
  - **Offline:** a service worker keeps the app and every month, day, diary and stats view you've opened readable offline (network-first), plus photo thumbnails. Writes are never cached.
  - **Notices:** going offline says *You're offline. You can read; saving waits until you're back.* A save made offline keeps the form and its text (and the draft), and the same Save works once you're back.
  - **Verified:** offline reload, a viewed day, an unvisited day (clear message with retry), and saving offline then online.

---

## 3. Inconsistency within the app

**3.1 Dates come in at least seven formats** [confirmed]
- **Status:** Done. One style everywhere: days *Tue 6 Oct 2026* (or *Tue 6 Oct* in context), weeks *12–18 Oct 2026* / *28 Sep – 4 Oct 2026*, ranges *16 Oct 2025 – 15 Oct 2026*, times *09:00–10:00* (en dash). Dates are built by hand rather than with browser locales, so Chrome's *Sept* and stray commas are gone, and it's the same on every device. The week label is fixed on the server (covered by a test). Entry fields use native date pickers, which follow the device's locale.

| Where | Shows |
|---|---|
| Day panel heading | 6 October |
| Entry cards | 6 Oct, 09:00 -- 10:00 |
| Diary headings | Thu 1 Oct |
| Week title | Oct 12 – 18, 2026 (US order, zero-padded: "Oct 05 – 11") |
| Search results | Thu, 10 Sept 2026 |
| Stats range | 16 Oct 2025 – 15 Oct 2026 (browser locale, may differ by device) |
| Entry form fields | 06-10-2026 (typed), while search's date filters are native dd/mm/yyyy pickers |

Time ranges are written with `--`, `-` and `–`.
- **Fix:**
  - Pick one style: day-month order (UK), e.g. "Tue 6 Oct" for days, "6–12 Oct 2026" for ranges, and "09:00–10:00" with an en dash for times.
  - Use one helper in JS and drop the Python-formatted week label.

**3.2 One thing, many names** [confirmed]
- **Entries:** Event / Subevent; *Add Event*, *New Event*, *Edit Event*, *Add Subevent*.
- **Field labels:** *Event name*, *Event Name*, *Subevent Name*; *Who* and *With Who*.
- **Views:** the Diary button opens "Month Overview"; the Year icon opens "Year Overview".
- **Fix:** Use one noun (*entry*), one verb per action, and sentence case. Name panels after their buttons.
- **Status:** Done (the Diary and Year titles change with those views in #8). One noun (*entry*, with *moments* inside), one verb per action, sentence case throughout. Search and server messages use the same words (*That entry no longer exists.*).

**3.3 Three forms for the same thing** [confirmed]
- **What:**
  - A new entry uses the form at the bottom of the panel (submit via `<form>`).
  - Editing an entry opens a different inline form inside the card (button handler, different IDs and labels).
  - Sub-entries use a third inline form.
- **Status:** Done. One entry form for new entry, edit entry, add moment and edit moment, always opening at the top of the day panel, with the same fields, validation and keyboard behaviour (Enter saves, Escape closes and keeps the draft).

  Validation, error handling and keyboard behaviour differ between them (e.g. Enter submits only the first).
- **Where:** `index.js` `toggleEventForm`, `editEvent`, `toggleSubEventForm`
- **Fix:** Use one entry-form component with *new* / *edit* / *sub-entry* modes, opened in one place (top of the panel, or a sheet on phones).

**3.4 Different fonts for typing and reading** [confirmed]
- **What:** Every input uses a monospace font; everything displayed uses Inter. It's applied everywhere, so it may be a deliberate typewriter touch. But you type in one face and read the entry back in another.
- **Fix:** If it's deliberate, keep it and say so in the CSS. Either way, apply it to the diary's note text too, so writing and reading share a voice.
- **Status:** Kept as it is. The monospace inputs are a documented, deliberate choice in `index.css` (*terminal flavour*), applied to every field, so typing is consistently distinct from reading. No change made.

**3.5 Mood colours** [confirmed]
- **What:**
  - Moods are 50%-transparent colours on a dark background. Great, Good and Okay are three greens/teals that are hard to tell apart in the grid and mix chart.
  - The Stats legend uses solid colours while the heatmap cells use the transparent ones, so the legend doesn't quite match.
- **Where:** `moods.py`; `utils.py` (`color[:7]` for the legend only)
- **Fix:** Keep the palette's character but space the hues further apart (e.g. move Great towards yellow-green and Okay towards a neutral sand). Use the same values in the legend and cells.
- **Status:** Done. Same green → violet character with the hues spaced apart: Great is yellow-green, Good green, Okay teal, Low blue, Rough violet (`moods.py`, 50% alpha kept). The legend, mix chart, picker and calendar now all use the exact same values; the picker no longer has its own hard-coded copy in CSS.

**3.6 Icons that mean something else** [confirmed]
- An eye sets the mood.
- Door-open and door-closed icons mean log in and log out.
- A bare **+** in the panel header adds an attachment, not an entry.
- **Fix:** Label them (*Mood*, *Sign out*, *Attach*), or swap in icons that match the action.
- **Status:** Done. Sign in/out show a text label (icon only on phones). The quick-mood eye is labelled *Set mood*. The attach control is a paperclip titled *Attach a photo or file*. The ⋯ and the picker options have accessible names.

**3.7 Feedback comes in three styles** [confirmed]
- `alert()` boxes for sub-entry and edit errors.
- Inline red text for login.
- Nothing at all for most actions.
- **Fix:** One toast style (see 2.3).
- **Status:** Done. `alert()` is gone. Saves, deletes and failures use one toast style, and discarding asks through an in-app confirm.

**3.8 The README describes an older app** [code]
- It lists "Monthly view" and "h/l keys" only: no moods by name, Stats, search, attachments, the phone app, markers or other shortcuts.
- **Status:** Done. The README now describes the app as it is: views, moods and markers, drafts and undo, Diary/Year, Stats with *Mood with…*, search, receipts and tickets, export, installing, and the keyboard shortcuts. It also notes the Intel-Mac `uv sync` issue and documents `purge-deleted` and the attachment API.

---

## 4. Fragility: data loss, no undo, unclear saves

**4.1 Tapping outside the panel throws away what you were writing** [confirmed]
- **What:** I typed a title and notes in the new-entry form, tapped outside the panel, then reopened the day. Both fields were empty. The same happens to a sub-entry form on any outside click or Escape, and to the edit form when the panel closes.
- **Where:** `index.js` global click handler (`toggleEventForm(false)`, `form.remove()`); `handleKeyPress` (Escape)
- **Why:** The worst way to lose a diary entry: the longer you wrote, the more you lose.
- **Fix:**
  - Never discard a form with text in it. Keep the draft per day in memory and local storage, and restore it when the day reopens.
  - Closing a form with changes asks *"Discard this entry?"*.
- **Status:** Done. Every keystroke in the entry form is kept per day and form (localStorage). Closing the panel, tapping outside, swiping it away or pressing Escape keeps the text, and the form comes back with *Restored your unsaved text* when that day is opened again. Only Cancel clears it, after asking *Discard this entry?* if anything changed; a successful save clears it too. A failed save keeps the form and its text open with the reason. Verified on desktop and at 375px touch.

**4.2 Deleting an entry is instant and permanent** [confirmed]
- **What:** One tap on the bin icon deletes the entry and all its sub-entries. No confirmation, no undo. The same goes for sub-entries.
- **Where:** `index.js` `deleteEvent`, `deleteSubEvent`; `routes/events.py`
- **Fix:** Delete with an **Undo** toast, backed by a soft delete (`deleted_at`) that's purged later. Library and tapes now work this way.
- **Status:** Done. Deleting an entry or a moment stamps `deleted_at` (new migration) instead of removing it. A global query rule hides deleted rows everywhere: calendar dots, day panel, diary, stats, search (the entry also leaves the search index). The toast offers **Undo**, which restores the entry with its moments and re-indexes it. Rows deleted over 30 days ago are purged on the next delete or by `flask purge-deleted`. Verified in the browser (deleted trip gone from day and search, back after Undo) and by tests.

**4.3 Deleting an attachment deletes the file immediately** [confirmed]
- **What:** One tap on the × removes the database row and unlinks the file from disk. That × is also invisible on touch (7.2), so a tap near a thumbnail's corner can hit it.
- **Where:** `routes/attachments.py` `delete_attachment`
- **Fix:** Undo toast plus a trash folder, as in 4.2.
- **Status:** Done. Deleting an attachment is a soft delete with Undo; the file stays on disk until it's purged after 30 days. A day record holding only deleted attachments is no longer auto-removed when its mood is cleared, so Undo always works. Covered by tests.

**4.4 Clearing a mood is a hidden gesture** [code]
- **What:** With the picker open, clicking the eye icon again clears that day's mood. It isn't shown anywhere and can't be undone.
- **Where:** `index.js` eye-icon handler
- **Fix:** Add a visible **Clear** swatch in the picker, with Undo.
- **Status:** Done. Clearing a mood is a visible option (*Clear mood* in the panel, an × in the quick picker), with Undo. The click-the-eye-again gesture is gone.

**4.5 Bad input is accepted, or silently erased** [confirmed]
- **What:**
  - An entry ending before it starts saves without complaint.
  - A date typed any other way (e.g. "5-10-2026") is wiped when you leave the field, with no message.
  - A request missing the name returns a bare 500.
  - Changing an entry's time can leave its sub-entries outside the new range; only sub-entries' own edits are checked [code].
- **Where:** `routes/events.py` `edit_event_data`, `create_event`; `index.js` `setupTimeInputs`
- **Fix:**
  - Validate on the server with plain messages (*"The end is before the start."*).
  - Use native date and time pickers (`type="date"`, `type="time"`), or keep the typed format but flag it instead of erasing it.
- **Status:** Done. The server checks every entry and answers with a plain message: *Give this entry a name.*, *The end is before the start.*, *That date or time doesn't look right.* An entry can't be edited so its moments fall outside it (it names the moment). The form uses native date and time pickers labelled From/To, so nothing typed is silently erased; the old DD-MM-YYYY format is still accepted. Covered by tests.

**4.6 After an edit, the calendar doesn't update** [code]
- **What:** Saving an edit refreshes only the day panel. If you moved the entry to another date, the month grid's dots and week view stay stale until you navigate.
- **Where:** `index.js` `editEvent` save handler (no `updateCalendarView`)
- **Fix:** Refresh the visible view after every save and delete.
- **Status:** Done. After any save, delete or undo, the panel and the visible month or week view are reloaded, so dots and colours are never stale.

**4.7 An oversized upload reports the wrong reason** [confirmed]
- **What:** An 11 MB file returns 500 instead of 413, because the generic error wrapper catches it. The app then says *"Upload failed"*, not *"File too large (max 10 MB)"*.
- **Where:** `routes/_helpers.py` `json_login_required`; `app.py` `MAX_CONTENT_LENGTH`
- **Fix:**
  - Let 413 through (or handle it as JSON).
  - Say the limit up front.
  - Downscale big photos client-side in the scanner app.
- **Status:** Done. Oversized uploads answer 413 with *That file is over 10 MB.*, shown as is (the error wrapper no longer turns HTTP errors into 500s). Covered by a test.

**4.8 Uploaded files are served as the app** [code]
- **What:** Attachments are served inline under their uploaded type, from the app's own origin. Any type is accepted, so an `.html` or `.svg` "receipt" would run as the calendar.
- **Where:** `routes/attachments.py` `download_attachment`
- **Fix:**
  - Accept images and PDFs only.
  - Serve anything else as a download.
  - Add `X-Content-Type-Options: nosniff` and a restrictive CSP on attachment responses.
- **Status:** Done. Only images and PDFs are accepted (*Only photos and PDFs can be attached.*), and images must actually decode. Every attachment response carries `X-Content-Type-Options: nosniff` and a sandboxing CSP, and any older non-image, non-PDF file is served as a download, never rendered. Covered by a test (an `.html` upload is refused).

**4.9 Stats show old numbers after you log** [confirmed]
- **What:** Stats load once per page visit and are fetched in the background on start. I logged today as "Great"; the tiles stayed at 285 days and a 0-day streak until a full reload.
- **Fix:** Refetch Stats on each open, or invalidate after any mood, marker or entry change.
- **Status:** Done. Stats re-fetch on open whenever a mood, marker or entry changed since they were drawn. Verified: clearing today's mood dropped *286 days logged* to 285 without a reload.

**4.10 The streak reads 0 every morning** [confirmed]
- **What:** "Current streak" counts back from today, so until today is logged it shows 0, even after 16 logged days in a row.
- **Why:** For a retrospective log you usually fill in the day in the evening. A 0 every morning is discouraging and wrong.
- **Fix:** If today isn't logged yet, count from yesterday ("16 days, log today to keep it going").
- **Status:** Done. If today isn't logged yet, the streak counts from yesterday and the tile reads *3 day streak · log today to keep it going*. Covered by a test.

**4.11 No export** [code]
- **What:** Years of diary live in one SQLite file, with no way to export them.
- **Fix:** Add an **Export** (JSON plus a Markdown diary, attachments zipped). Trust in a life log includes knowing you can take it with you.
- **Status:** Done. *Download your whole diary (.zip)* at the foot of Stats (`GET /export`). It holds `entries.json` (every day's mood and marker, every entry with its moments), `diary.md` (a readable diary, oldest first) and the original attachments in a folder per day (same-named files get *(2)*). Covered by a test; the throwaway diary (355 entries, 300+ days) exports in well under a second.

---

## 5. Friction: the most common tasks, step by step

### Most common task: log today, on the phone, in the evening

| # | Step | Friction |
|---|---|---|
| 1 | Open Calendar | No mark on today (2.1). |
| 2 | Tap today to set the mood | **The result depends on where you tap.** Tapping the centre of the cell opens the mood picker (the invisible eye icon catches it); the lower half opens the day (7.1). |
| 3 | Pick a mood | Five unlabelled colours, three of them similar greens (3.5). No confirmation; Stats won't show it until you reload (4.9). |
| 4 | Open the day | Tap the lower half of the cell. The mood you just picked isn't shown in the sheet (1.2). |
| 5 | Scroll to **Add Event** | It's below all existing entries and the attachments. |
| 6 | Fill the form | Opens at the bottom. Date is prefilled; times are typed as HH:MM on a full keyboard (7.4). |
| 7 | Type notes | The keyboard hides **Save**, and the bottom mode bar still takes space (7.4). |
| 8 | Tap outside to dismiss the keyboard | **The sheet closes and the draft is lost** (4.1). |
| 9 | Mark the day | Impossible on a phone (7.3). |
| 10 | Save | No confirmation. If it failed, no message (2.3). |

**Fixes:**
- Mood row at the top of the day sheet.
- Entry form at the top, as a full-height sheet.
- Drafts never discarded.
- Marker toggle in the sheet.
- One "Saved" toast.

That turns 10 steps with three traps into about 4 steps: tap today, tap a mood, write, done.

**Status: done.** Tapping today (anywhere on the cell) opens its sheet with the mood row and marker at the top; one tap sets the mood (with Undo). **Write about this day** opens a full-screen form with Save pinned above the keyboard. Nothing typed is lost by tapping away (drafts come back), and *Saved* confirms. Logging today is now: tap today → tap a mood → Write → Save.

### Second task: attach a scanned receipt to a day
- From the phone app, the upload lands on the day. Opening that day shows a narrow white strip, and the PDF's name broken mid-word (1.7).
- On desktop, the **+** to add one by hand is hidden under the top bar (2.5).
- Opening one shows the raw file in a new tab.
- **Fix:** Thumbnails, a lightbox, captions, and the + moved below the bar.

**Status: done.** Attachments show as real thumbnails in a *Receipts & tickets* strip, HEIC is converted, and they open in an in-app viewer with caption and entry link; the attach button sits below the bar (see 1.7, 2.5).

### Third task: look back on a month, or find something
- **Diary:** a side panel without moods, attachments or month navigation (1.4).
- **Year:** you can't open any day from it.
- **Search:** works well, about 0.4 s for meaning, words and filters. "with Sam last month" correctly became *last month · with: Sam*. But it caps at 20 results without saying so, doesn't show the day's mood, and doesn't highlight what matched.
- Clicking a result opens the right day.

**Status: done.** The Diary and Year are full views with moods, markers, attachments and navigation (1.4). Search shows mood, highlights and *Show more* (8.4). Stats can be opened for any year, and its heatmap days open the calendar (1.8, 7.6).

---

## 6. Copy

| Where | Now | Suggested |
|---|---|---|
| Empty day | No events scheduled | Nothing written for this day yet. |
| Add button | Add Event | Write about this day |
| Form headers | New Event / Edit Event / Add Subevent / Edit Subevent | New entry / Edit entry / Add a moment / Edit moment |
| Name placeholders | Event name / Event Name / Subevent Name | What happened? |
| Who placeholders | Who / With Who | Who was there? |
| Where placeholder | Where | Where? |
| Unlabelled date rows | DD-MM-YYYY · HH:MM (twice) | **From** … **To** labels; times marked *optional* |
| Sub-entry error | Subevent must occur within the parent event's timeframe | This moment falls outside its entry's time (10:00–15:00). |
| Required fields | `alert('Please fill in all required fields')` | Inline under the field: *Give this entry a name.* |
| Save failed | `alert('An error occurred while saving the subevent.')` | Couldn't save. Your text is still here. Try again. |
| Upload too large | Upload failed: IMG_4021.jpg | That photo is over 10 MB. Try a smaller one. |
| Diary panel title | Month Overview | Diary · October 2026 |
| Year panel title | Year Overview | 2026 |
| Diary empty | No events this month | Nothing written in October. |
| Diary/year errors | Failed to load events / Error loading year data | Couldn't load October. Retry |
| Search interpretation | Interpreted: last month · with: Sam | Showing: last month · with Sam (each one removable) |
| Search errors | Search failed / Search error | Couldn't search right now. Try again. |
| Search empty | No matching entries | Nothing matches "zzqx". Try fewer words or clear the filters. |
| Stats heading | Your year in moods | Keep it, and add the range picker (1.8). |
| Streak tile | 0 · day current streak | 16 days · log today to keep it going (4.10) |
| Trend legend | (red dots unexplained) | ● Marked day |
| Login | Login / Username / Password / door icon | Sign in · Sign out (with text) |
| Server JSON errors | Internal server error / unknown mood / Authentication required | Plain-language messages the UI can show as is |

**Status: done.** Every row is in the app, with two adjustments:
- Search labels read *Showing last month · with Sam* (plain phrases, not removable chips).
- The upload limit message is *That file is over 10 MB.*

The Diary and Year rows land with #8, and the trend legend with #10.

---

## 7. Mobile (375 px, touch)

The basic structure is good:
- a bottom mode bar (Month / Week / Year / Diary);
- the day as a bottom sheet with swipe-down to dismiss;
- swipe left/right to change month;
- safe-area padding on both bars.

The problems are mostly the hover-era controls inside it.

**7.1 The mood control is an invisible 16 × 14 px target overlapping the day** [confirmed]
- **What:** Each day cell is 43 px, and the eye icon sits in its top-left corner at opacity 0. Touch-target adjustment snaps taps to it:
  - tapping the **centre** of a cell opened the mood picker;
  - only the lower half opened the day.
- **Fix:**
  - Tapping a day always opens the day sheet, with the mood row at its top (1.2).
  - Optionally, long-press a day for a quick mood picker.
- **Status:** Done. On touch screens the eye icon isn't shown, so a tap anywhere on a day opens the day; mood is set in the sheet (64×52 px chips). Verified: a centre tap at 375px opens the sheet.

**7.2 Entry and attachment actions are hover-only** [confirmed]
- **What:** Edit, delete and add-moment are 16 px icons at opacity 0 on touch; the attachment × is 18 px at opacity 0. They're invisible, yet tappable by accident.
- **Where:** `index.css` `.event-actions`, `.subevent-actions`, `.attachment-delete` (no `hover: none` rules)
- **Fix:** On touch, show a single visible **⋯** button per entry (44 px) that opens a bottom sheet: Edit · Add moment · Delete (with Undo).
- **Status:** Done. On touch screens each entry and moment has a visible 44×44 **⋯** that opens a bottom action sheet (Edit entry · Add a moment · Delete entry, or Edit/Delete moment). The hover icons are hidden there, and on desktop they also show on keyboard focus. The attachment × is always visible on touch, at 28 px.

**7.3 The marker can't be set on a phone** [confirmed]
- **What:** A double-tap on a day did nothing. There's no other way to set it.
- **Fix:** A marker toggle in the day sheet (1.3).
- **Status:** Done. *Mark this day* is a button in the day sheet, so it works on touch (see 1.3).

**7.4 The keyboard and the entry form** [confirmed]
- **What:**
  - With the keyboard up (≈300 px), **Save** sat at y 489 in a 367 px visible area.
  - The bottom mode bar stays fixed above the keyboard and takes space.
  - Date and time fields use a full text keyboard (no `inputmode`).
- **Fix:**
  - Open the form as a full-height sheet with a sticky header holding **Cancel / Save**.
  - Hide the mode bar while typing.
  - Use `type="date"` and `type="time"` (native wheels on iOS), or `inputmode="numeric"`.
- **Status:** Done. On phones the entry form is a full-screen sheet with **Cancel · title · Save** pinned at the top, and the top and bottom bars hidden while you type. With a 300 px keyboard up, Save stayed at the top of the visible area. Date and time are native pickers (iOS wheels), and validation messages scroll into view. Cancel offers *Keep as draft* or *Discard*.

**7.5 The day sheet** [confirmed]
- **What:**
  - The heading "6 October" has no weekday or year, yet each card repeats "6 Oct, …".
  - No mood is shown.
  - The add-entry button sits below everything.
- **Fix:** Use a "Tue 6 Oct 2026" heading with the mood row under it; cards show only the time.
- **Status:** Done. The sheet is headed *Tue, 6 Oct 2026*, followed by the mood row and the marker, then **Write about this day**. Entry cards show only the time (09:00–10:00, *All day*, or the span for multi-day entries), not the date again.

**7.6 Stats don't fit a phone** [confirmed]
- **What:**
  - The trend chart is a fixed 900 px-wide drawing squeezed to 285 px, so its labels are about 3 px tall.
  - The heatmap scrolls sideways (874 px in a 285 px card) and opens on the **oldest** months, hiding recent weeks.
  - Every tooltip is hover-only: tapping a heatmap cell or a bar shows nothing.
- **Fix:**
  - Draw the trend at the card's real width (or show the last 3 months on phones).
  - Scroll the heatmap to the right end on load.
  - Make cells and bars tappable, showing a small caption under the chart; a heatmap cell should also open that day.
- **Status:** Done. The trend is drawn at the card's real width (labels 12 px on a phone, every other month when narrow) and redrawn on resize. The heatmap opens scrolled to the most recent weeks. Tapping a mix column or an entries bar writes its breakdown under the chart (hover still shows the tip), and tapping a heatmap day opens that day in the calendar. A legend explains the line and the red *Marked day* dots.

**7.7 Week view on a phone** [confirmed]
- **What:** Entries are cut to "08:…", "10:…" with names hidden.
- **Fix:** Use the seven day cards (1.6).
- **Status:** Done. On phones Week is seven day cards (*Mon 12 Oct · Okay ●*, a mood-coloured edge, the marker, and each entry with its time, or *Nothing written*). Today is outlined, and tapping a card opens the day.

**7.8 Search filters on a phone** [confirmed]
- **What:** Five filter fields wrap into a block above the results, and the two date pickers don't say which is From and which is To.
- **Fix:** Collapse them behind a **Filters** button (with a count badge); label From and To.
- **Status:** Done. On phones the five filters fold behind a **Filters** button with a count badge; the date filters are labelled **From** and **To** everywhere.

---

## 8. Speed and feel

**8.1 Missing instant feedback** [confirmed]
- **What:**
  - Picking a mood: the colour changes only after the server answers, with no confirmation.
  - Saving: the panel silently re-renders.
  - Deleting: instant, with no Undo.
  - Stats don't reflect the change (4.9).
- **Fix:**
  - Optimistic colour change, rolled back with a message on failure.
  - A "Saved" toast.
  - Undo for deletes.
- **Status:** Done. Mood and marker change on screen at once (rolled back on failure) with an Undo toast; saves show *Saved*, deletes *Deleted “…” · Undo*; Stats reflect changes.

**8.2 Loading** [confirmed]
- **What:**
  - Search is quick (about 0.4 s), and week, year and diary each show a "Loading…" line.
  - Month changes have no loading state and drop key presses meanwhile.
  - The day panel shows the previous day while loading (2.4).
- **Fix:** As 2.4. Also prefetch the next and previous month for instant swipes.
- **Status:** Done (see 2.4). The grid dims while a month or week loads, key presses are never dropped, the day panel shows the right date immediately, and Stats/Diary/Year show loading and retry states. Prefetching neighbouring months wasn't needed: measured on this Mac with a year of data, a month loads in ~12 ms, a week 15 ms, a day 18 ms, a year 35 ms and Stats 59 ms (the Pi will be several times slower, still well under the 150 ms dimming threshold for most views).

**8.3 Keyboard shortcuts** [code]
- **What:**
  - `h`/`l` change month, `k`/`j` change year, and `d`/`y` open the diary and year panels.
  - None of this is shown anywhere, and the README mentions only `h`/`l`.
  - Escape closes forms **and discards them** (4.1).
- **Fix:** Add:
  - `t` today;
  - `n` new entry for the open day;
  - `1`–`5` to set the open day's mood;
  - `m` toggle marker;
  - `/` search;
  - `←`/`→` alongside `h`/`l`;
  - `?` for a shortcut sheet.
- **Status:** Done. A full set, listed on a **?** sheet (also a keyboard button in the desktop bar): `←`/`→` or `h`/`l` month or week, `j`/`k` year, `t` today, `m` `w` `y` `d` views, `n` write about the open day (or today), `1`–`5` mood for the open day, `x` mark/unmark, `/` search, `Esc` close (drafts kept). Shortcuts ignore typing, open dialogs and Cmd/Ctrl/Alt combinations. All checked in the browser.

  Make Escape close without discarding a draft.

**8.4 Search** [confirmed]
- **What:** Quick and smart (meaning plus words plus parsed filters). But it caps at 20 results without saying so, doesn't show the day's mood on results, and doesn't highlight matches.
- **Fix:** Show "20 of 63 · More", a mood swatch on each result, and highlighted matched words.
- **Status:** Done. Results end with *20 entries · Show more* (20 more each time, up to 100; the server fetches one extra to know). Each result shows its day's mood, and the searched words are highlighted in titles, people, places and notes. The embedding model now loads in the background when the server starts (not in tests or CLI commands), so the first search no longer waits for it.

---

## Top 10, ranked by how much better the app will feel

| Rank | Fix | Section | Size | Status |
|---|---|---|---|---|
| 1 | **Never lose writing:** keep drafts when the panel closes or Escape is pressed; confirm before discarding; keep text when a save fails | 4.1, 2.3 | **Small** | Done |
| 2 | **Mood where you write:** a labelled mood row at the top of the day panel/sheet; tapping a day always opens it; hide the eye icon on touch | 1.2, 7.1, 5 | **Medium** | Done |
| 3 | **Touch-ready day sheet:** one visible ⋯ per entry (Edit · Add moment · Delete), a marker toggle, attachments with a visible ×, the entry form at the top as a full-height sheet with a sticky Save | 7.2, 7.3, 7.4, 7.5, 1.3 | **Medium** | Done |
| 4 | **Undo instead of loss:** Undo toasts for entry, moment, attachment and mood-clear; soft delete and a trash | 4.2, 4.3, 4.4 | **Medium** | Done |
| 5 | **Correctness fixes:** escape user text (2.6); move the desktop panel below the top bar so the attachment + works (2.5); use the local date parser everywhere for iPhone (2.7) | 2.5, 2.6, 2.7 | **Small** | Done |
| 6 | **Feedback and fresh numbers:** one toast style for saves and failures; refetch Stats after changes; streak counts from yesterday; refresh the grid after edits | 2.3, 4.9, 4.10, 4.6, 8.1 | **Small** | Done |
| 7 | **Diary language and one entry form:** entries, not events; "Nothing written for this day yet"; one form component; plain error copy; native date and time pickers | 1.1, 3.2, 3.3, 4.5, 6 | **Medium** | Done |
| 8 | **Look-back views as real views:** full-screen Diary with moods, attachments and month navigation; merge Year into one tappable year grid with a year picker; mark today, add a Today button | 1.4, 1.5, 2.1 | **Large** | Done |
| 9 | **Receipts and tickets that look like keepsakes:** thumbnails, a lightbox, captions or a link to an entry, HEIC conversion, safe serving, a correct size-limit message | 1.7, 4.7, 4.8 | **Medium** | Done |
| 10 | **Stats that explain:** a "Mood with…" card for people and places, a year/range picker, a marker legend, phone-sized charts with tap details, and one consistent date format across the app | 1.8, 7.6, 3.1, 3.5 | **Large** | Done |

**Close runners-up:**
- Week view as seven day cards on phones (1.6, 7.7, medium).
- The full shortcut set with a `?` sheet (8.3, small).
- Export (4.11, small).
- Offline drafts and an installable app (2.10, medium).
- Search filters behind a button, plus result counts (7.8, 8.4, small).
