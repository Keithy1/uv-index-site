"""Draw the favicon, once. Run: python tools/favicon.py

Committed rather than built, like the share image: neither CI nor the Worker
needs an image library. A sun in the High band's orange on the site's dark
ground -- the one shape that still reads at 16 pixels.
"""
from PIL import Image, ImageDraw

SIZES = (16, 32, 48)
BG, SUN = "#15171b", "#e07b00"


def draw(size: int) -> Image.Image:
    # Drawn large and scaled down, so the edges are antialiased at 16 px.
    big = size * 8
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big // 5, fill=BG)
    pad = big // 4
    d.ellipse([pad, pad, big - pad, big - pad], fill=SUN)
    return img.resize((size, size), Image.LANCZOS)


largest = draw(max(SIZES))
largest.save("tools/favicon.ico", sizes=[(s, s) for s in SIZES], append_images=[draw(s) for s in SIZES])
draw(180).convert("RGB").save("tools/apple-touch-icon.png", optimize=True)
print("tools/favicon.ico, tools/apple-touch-icon.png")
