"""Cut the site's brand images from the artwork in "Logo options/". Run once:

    python tools/brand.py

The source files are 400-900 KB illustrations; nothing here ships them as-is.
Each output is exported at the exact size it is used, and committed, so neither
CI nor the Worker needs an image library:

    og-image.jpg          1200x630  share card; fetched by social crawlers only
    logo.jpg              512x512   Organization logo in structured data
    apple-touch-icon.png  180x180   iOS home screen
    mark.webp             72x72     header mark, shown at 36 px (2x for sharp screens)

The favicon is deliberately not cut from this artwork: at 16 px the globe is a
blue blob, and tools/favicon.py's plain sun reads better.

Fonts are Windows ones because that is where it was run; any bold and regular
sans will do.
"""
from PIL import Image, ImageDraw, ImageFont

SRC = "Logo options/"
OUT = "tools/"
BG = (1, 2, 7)                      # the artwork's own near-black, sampled
FG, MUTED = (233, 236, 241), (154, 164, 178)

# The composite has a 482 px white strip to the right of the art; this is the
# art itself.
composite = Image.open(SRC + "logo with name.png").convert("RGB").crop((0, 0, 670, 576))
globe = Image.open(SRC + "layer-globe (1).png").convert("RGBA")


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)


def share_card() -> None:
    W, H = 1200, 630
    card = Image.new("RGB", (W, H), BG)
    art = composite.resize((round(670 * H / 576), H), Image.LANCZOS)  # 733 x 630
    # Fade the art's right edge into the background, so the sun flare does not
    # end in a hard vertical line where the art stops.
    fade = 140
    mask = Image.new("L", art.size, 255)
    for x in range(art.width - fade, art.width):
        alpha = round(255 * (art.width - x) / fade)
        ImageDraw.Draw(mask).line([(x, 0), (x, H)], fill=alpha)
    card.paste(art, (0, 0), mask)

    d = ImageDraw.Draw(card)
    x = 720
    d.text((x, 196), "Live UV index,", font=font("segoeuib.ttf", 54), fill=FG)
    d.text((x, 262), "city by city", font=font("segoeuib.ttf", 54), fill=FG)
    d.text((x, 350), "Australia and", font=font("segoeui.ttf", 34), fill=MUTED)
    d.text((x, 392), "the United States", font=font("segoeui.ttf", 34), fill=MUTED)
    card.save(OUT + "og-image.jpg", quality=86, optimize=True, progressive=True)


def square_logo() -> None:
    # Padded to square on its own background: Google wants a square-ish logo,
    # and cropping would cut either the globe or the wordmark.
    side = max(composite.size)
    sq = Image.new("RGB", (side, side), BG)
    sq.paste(composite, ((side - composite.width) // 2, (side - composite.height) // 2))
    # JPEG: as a PNG this photographic image was 314 KB.
    sq.resize((512, 512), Image.LANCZOS).save(OUT + "logo.jpg", quality=88, optimize=True)


def touch_icon() -> None:
    # The globe and the sun breaking over it, cropped from the composite. No
    # wordmark: at 180 px it would be unreadable, and iOS writes the site's
    # name under the icon anyway.
    # The wordmark's top edge is at y=465, so the crop stops at 455 and the
    # square is made up with background above -- a first cut at 480 clipped
    # the tops of the letters along the bottom of the icon.
    crop = composite.crop((90, 0, 570, 455))
    sq = Image.new("RGB", (480, 480), BG)
    sq.paste(crop, (0, 480 - 455))
    sq.resize((180, 180), Image.LANCZOS).save(OUT + "apple-touch-icon.png", optimize=True)


def header_mark() -> None:
    # Transparent, so the one file works on the light and the dark header.
    globe.resize((72, 72), Image.LANCZOS).save(OUT + "mark.webp", quality=90, method=6)


if __name__ == "__main__":
    share_card()
    square_logo()
    touch_icon()
    header_mark()
    print("og-image.jpg, logo.jpg, apple-touch-icon.png, mark.webp")
