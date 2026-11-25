"""Generate a 60-page 5.5x8.5 STAND-IN booklet that mirrors the real layout.

Only for testing the build and viewer until the real PDF is dropped in.
Usage: python3 scripts/make-test-pdf.py source/booklet.pdf [year]
"""
import sys, datetime
from reportlab.lib.pagesizes import inch
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

out = sys.argv[1]
year = int(sys.argv[2]) if len(sys.argv) > 2 else 2026
W, H = 5.5 * inch, 8.5 * inch
SLATE, MUTED, ACTION, TINT, GOLD = (HexColor(c) for c in ("#293D49", "#536B79", "#386781", "#DFEBF2", "#C9973A"))
c = canvas.Canvas(out, pagesize=(W, H))
c.setTitle("Advent devotional (test stand-in)")

def spaced(text, x, y, size=9):
    t = c.beginText(x, y); t.setFont("Helvetica-Bold", size); t.setCharSpace(3)
    t.setFillColor(MUTED); t.textLine(text); c.drawText(t)

def para(lines, x, y, size=10, lead=14, color=SLATE, font="Times-Roman"):
    for ln in lines:
        t = c.beginText(x, y); t.setFont(font, size); t.setCharSpace(0)
        t.setFillColor(color); t.textLine(ln); c.drawText(t); y -= lead
    return y

def footer(n):
    c.setFont("Helvetica", 8); c.setFillColor(MUTED); c.drawCentredString(W / 2, 0.4 * inch, str(n))

def end(n):
    footer(n); c.showPage()

WEEKS = [("W E E K   O N E", "Remembered"), ("W E E K   T W O", "Lifted"),
         ("W E E K   T H R E E", "Covered"), ("W E E K   F O U R", "Carried"),
         ("C H R I S T M A S   D A Y", "Christmas")]
TITLES = ["The God who remembers", "A name on his palms", "Not forgotten", "Seed in winter ground",
          "The long memory of mercy", "Rachel weeping", "Remember me", "Lifted from the pit",
          "Every valley", "Eagles' wings", "The lifter of my head", "Mary's song", "Raised up",
          "The low places", "Under his wings", "A cloak of righteousness", "Shelter in the storm",
          "Overshadowed", "The cloud by day", "Clothed", "Shepherd's arms", "Carried from the womb",
          "On his shoulders", "All the way home", "Borne along", "Silent night, holy ground",
          "The Word became flesh"]

# p1 cover
c.setFillColor(TINT); c.rect(0, 0, W, H, stroke=0, fill=1)
c.setFillColor(GOLD); c.rect(W / 2 - 18, H - 1.6 * inch, 36, 3, stroke=0, fill=1)
c.setFillColor(SLATE); c.setFont("Times-Bold", 30); c.drawCentredString(W / 2, H / 2 + 30, "Held")
c.setFont("Times-Italic", 14); c.drawCentredString(W / 2, H / 2, "Advent devotions %d" % year)
c.setFont("Helvetica", 10); c.drawCentredString(W / 2, 1 * inch, "Timothy Lutheran Church · St. Louis")
c.showPage()
# p2
spaced("W E L C O M E", 0.6 * inch, H - 0.9 * inch)
para(["How to use this devotional"], 0.6 * inch, H - 1.3 * inch, 18, font="Times-Bold")
para(["Each day of Advent has a two-page spread. On the left you'll", "find a reading and reflection. On the right, a piece of art",
      "and a prayer. Read slowly. Pray honestly. Come back tomorrow.", "", "Families: read the reflection aloud at dinner and let each",
      "person add one name to the prayer."], 0.6 * inch, H - 1.8 * inch)
end(2)
# p3 midweek (deliberately contains date-like lines that must NOT be mistaken for devotions)
para(["Midweek Advent services"], 0.6 * inch, H - 1.1 * inch, 18, font="Times-Bold")
para(["Wednesday, December 2", "Wednesday, December 9", "Wednesday, December 16",
      "Soup supper at 5:30 pm, worship at 6:30 pm.", "Christmas Eve: Thursday, December 24, 4 and 10 pm."],
     0.6 * inch, H - 1.6 * inch, lead=20)
end(3)
# p4–p57 devotions
d = datetime.date(year, 11, 29); n = 4
for i in range(27):
    wk = 0 if i < 7 else 1 if i < 14 else 2 if i < 21 else 3 if i < 26 else 4
    spaced(WEEKS[wk][0], 0.6 * inch, H - 0.9 * inch)
    para([d.strftime("%A, %B ") + str(d.day)], 0.6 * inch, H - 1.25 * inch, 11, color=MUTED, font="Helvetica")
    para([TITLES[i]], 0.6 * inch, H - 1.65 * inch, 20, font="Times-Bold")
    para(["Read: Isaiah 49:14–16", "", "Zion said, “The Lord has forsaken me.” But the God who carved",
          "your name on his hands has not misplaced you. This is day %d of" % (i + 1),
          "the stand-in booklet; the real reflection will replace this text.", "",
          "Ask: Where do you feel forgotten this week? Where has God", "already been remembering you?"],
         0.6 * inch, H - 2.2 * inch)
    end(n); n += 1
    c.setFillColor(TINT); c.rect(0.6 * inch, H / 2 - 0.2 * inch, W - 1.2 * inch, H / 2 - 0.5 * inch, stroke=0, fill=1)
    c.setFillColor(ACTION); c.circle(W / 2, H * 0.72, 40 + i, stroke=0, fill=1)
    para(["Prayer"], 0.6 * inch, H / 2 - 0.6 * inch, 12, font="Helvetica-Bold", color=MUTED)
    para(["Lord Jesus, you came near when we could not climb to you.", "Hold us today as you held Mary and Joseph,",
          "and keep us in your mercy. Amen."], 0.6 * inch, H / 2 - 0.95 * inch, font="Times-Italic")
    end(n); n += 1
    d += datetime.timedelta(days=1)
# p58–p60
para(["Prayer list"], 0.6 * inch, H - 1.1 * inch, 18, font="Times-Bold")
y = H - 1.6 * inch
c.setStrokeColor(HexColor("#D7E2E9"))
while y > 1 * inch:
    c.line(0.6 * inch, y, W - 0.6 * inch, y); y -= 26
end(58)
para(["About the art"], 0.6 * inch, H - 1.1 * inch, 18, font="Times-Bold")
para(["The images in this booklet were made by members of Timothy.", "(Stand-in text.)"], 0.6 * inch, H - 1.6 * inch)
end(59)
c.setFillColor(TINT); c.rect(0, 0, W, H, stroke=0, fill=1)
c.setFillColor(SLATE); c.setFont("Helvetica", 10)
c.drawCentredString(W / 2, H / 2, "Timothy Lutheran Church"); c.drawCentredString(W / 2, H / 2 - 14, "timothystl.org")
c.showPage(); c.save()
print("wrote", out)
