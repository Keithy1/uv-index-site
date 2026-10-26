"""Draw the Open Graph share image, once.

The output is committed, not built, so neither CI nor the Worker needs an image
library -- the picture is fixed branding and changes only when someone runs
this by hand. Run: python tools/og-image.py

Font paths are Windows ones because that is where it was run; any bold and
regular sans will do, and the layout does not depend on the exact metrics.
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG, FG, MUTED = "#15171b", "#e9ecf1", "#9aa4b2"
BANDS = [
    ("Low", "#3a7d2c", "#ffffff"),
    ("Moderate", "#f2d600", "#16181d"),
    ("High", "#e07b00", "#16181d"),
    ("Very High", "#d32010", "#ffffff"),
    ("Extreme", "#8b3fd1", "#ffffff"),
]

def font(name, size):
    for path in (f"C:/Windows/Fonts/{name}", f"/usr/share/fonts/truetype/dejavu/{name}"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

d.text((80, 96), "uvatlas", font=font("segoeuib.ttf", 112), fill=FG)
d.text((80, 232), "Live UV index, city by city", font=font("segoeui.ttf", 54), fill=FG)
d.text((80, 302), "Australia and the United States", font=font("segoeui.ttf", 54), fill=MUTED)

# The WHO bands, in order: the thing the whole site is about, and the one part
# of the picture that tells a stranger what they are looking at.
x, y, h = 80, 452, 76
pill = font("segoeuib.ttf", 30)
for label, bg, fg in BANDS:
    w = int(d.textlength(label, font=pill)) + 56
    d.rounded_rectangle([x, y, x + w, y + h], radius=12, fill=bg)
    box = d.textbbox((0, 0), label, font=pill)
    d.text((x + (w - (box[2] - box[0])) / 2, y + (h - (box[3] - box[1])) / 2 - box[1]),
           label, font=pill, fill=fg)
    x += w + 14

d.text((80, 566), "uvatlas.com", font=font("segoeui.ttf", 34), fill=MUTED)
img.save("tools/og-image.png", optimize=True)
print("tools/og-image.png", img.size)
