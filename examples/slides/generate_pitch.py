"""Generate examples/slides/pitch.pptx, the SwarmLoom slides sample.

Run from any directory with a Python that has python-pptx and Pillow:

    python examples/slides/generate_pitch.py

The deck is original content in the SwarmLoom palette. Output is reproducible:
core properties use a fixed date and the ZIP entries get a fixed timestamp.
It starts from python-pptx's default template and keeps some of its parts; SOURCES.md (next to
this script) lists them and holds python-pptx's MIT licence, which ships with the sample.
"""

from __future__ import annotations

import datetime as dt
import io
import re
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_THEME_COLOR
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.util import Emu, Pt

OUT = Path(__file__).resolve().parent / "pitch.pptx"

# SwarmLoom brand palette.
INDIGO = "5B5BF7"
CORAL = "FF6B5B"
TEAL = "14B8A6"
AMBER = "F5A524"
ORCHID = "D946EF"
SKY = "3BA7F5"
INK = "0B0B12"
PAPER = "FAFAFC"
ROSE = "FF4F7B"
MUTED = "5C5F73"

SLIDE_W = 12192000  # 13.333 in, 16:9
SLIDE_H = 6858000
OLD_W = 9144000  # default template width (4:3)
OLD_H = 6858000

FIXED_ZIP_TIME = (2026, 1, 1, 0, 0, 0)


def rgb(hex_value: str) -> RGBColor:
    return RGBColor.from_string(hex_value)


def rebrand_theme(prs: Presentation) -> None:
    """Replace the template colour scheme with the SwarmLoom palette (accent1 = indigo, ...)."""
    theme = prs.slide_master.part.part_related_by(RT.THEME)
    xml = theme.blob.decode("utf-8")
    scheme = {
        "dk2": "1E1F2E",
        "lt2": "EEF0F8",
        "accent1": INDIGO,
        "accent2": CORAL,
        "accent3": TEAL,
        "accent4": AMBER,
        "accent5": ORCHID,
        "accent6": SKY,
        "hlink": INDIGO,
        "folHlink": "9B5CF6",
    }
    for name, value in scheme.items():
        xml, count = re.subn(
            rf"<a:{name}>.*?</a:{name}>",
            f'<a:{name}><a:srgbClr val="{value}"/></a:{name}>',
            xml,
            count=1,
            flags=re.S,
        )
        assert count == 1, name
    xml = xml.replace('name="Office Theme"', 'name="SwarmLoom"', 1)
    theme._blob = xml.encode("utf-8")


def widen_layouts(prs: Presentation) -> None:
    """Stretch master and layout placeholders from 4:3 to 16:9 so slides inherit sensible positions."""
    ratio = SLIDE_W / OLD_W
    owners = [prs.slide_master, *prs.slide_layouts]
    for owner in owners:
        for shape in owner.shapes:
            # Only shapes with their own xfrm: layout placeholders without one inherit the
            # (already widened) master position, and setting left/width would create a
            # degenerate xfrm with zero top and height.
            if not shape._element.xpath("./p:spPr/a:xfrm"):
                continue
            shape.left = Emu(round(shape.left * ratio))
            shape.width = Emu(round(shape.width * ratio))


def woven_picture() -> bytes:
    """An original woven-threads illustration in the brand palette, as PNG bytes."""
    width, height = 960, 540
    img = Image.new("RGB", (width, height), "#" + PAPER)
    draw = ImageDraw.Draw(img)
    colours = [INDIGO, CORAL, TEAL, AMBER, ORCHID, SKY]
    step = 60
    # Warp threads (vertical), then weft threads (horizontal) that alternate over and under.
    for i, x in enumerate(range(30, width, step)):
        draw.rectangle([x, 0, x + 26, height], fill="#" + colours[i % len(colours)])
    for j, y in enumerate(range(30, height, step)):
        colour = "#" + colours[(j + 3) % len(colours)]
        for i, x in enumerate(range(0, width, step)):
            if (i + j) % 2 == 0:
                draw.rectangle([x, y, x + step, y + 26], fill=colour)
            else:
                draw.rectangle([x, y, x + 30, y + 26], fill=colour)
    # A few cursor-like triangles on top.
    for cx, cy, colour in [(210, 160, INK), (520, 300, INK), (760, 120, INK)]:
        draw.polygon([(cx, cy), (cx, cy + 46), (cx + 13, cy + 34), (cx + 32, cy + 34)], fill="#" + colour)
    buf = io.BytesIO()
    img.quantize(colors=16).save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def style_runs(paragraph, size: int | None = None, colour: str | None = None, bold: bool | None = None) -> None:
    for run in paragraph.runs:
        if size is not None:
            run.font.size = Pt(size)
        if colour is not None:
            run.font.color.rgb = rgb(colour)
        if bold is not None:
            run.font.bold = bold


def add_text(slide, left, top, width, height, text, size, colour=INK, bold=False, align=PP_ALIGN.LEFT):
    box = slide.shapes.add_textbox(Emu(left), Emu(top), Emu(width), Emu(height))
    frame = box.text_frame
    frame.word_wrap = True
    frame.text = text
    para = frame.paragraphs[0]
    para.alignment = align
    style_runs(para, size, colour, bold)
    return box


def title_slide(prs: Presentation) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    fill = slide.background.fill
    fill.gradient()
    fill.gradient_angle = 135
    stops = fill.gradient_stops
    stops[0].color.rgb = rgb(INK)
    stops[0].position = 0.0
    stops[1].color.rgb = rgb("23237A")
    stops[1].position = 1.0

    title, subtitle = slide.placeholders[0], slide.placeholders[1]
    title.text = "SwarmLoom"
    style_runs(title.text_frame.paragraphs[0], 66, PAPER, True)
    subtitle.text = "Watch a swarm of cursors weave it into being."
    style_runs(subtitle.text_frame.paragraphs[0], 26, "C9CBF9")

    bar = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Emu(5196000), Emu(4420000), Emu(1800000), Emu(90000))
    bar.fill.solid()
    bar.fill.fore_color.rgb = rgb(ROSE)
    bar.line.fill.background()

    # Swarm dots (one per palette colour).
    for i, colour in enumerate([INDIGO, CORAL, TEAL, AMBER, ORCHID, SKY]):
        dot = slide.shapes.add_shape(MSO_SHAPE.OVAL, Emu(4900000 + i * 420000), Emu(5000000), Emu(260000), Emu(260000))
        dot.fill.solid()
        dot.fill.fore_color.rgb = rgb(colour)
        dot.line.fill.background()


def bullets_slide(prs: Presentation) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = "Why SwarmLoom"
    style_runs(slide.shapes.title.text_frame.paragraphs[0], 40, INK, True)
    body = slide.placeholders[1].text_frame
    items = [
        (0, "Rebuilds pages, documents, slides, sheets, code and 3D models live"),
        (0, "Deterministic: same seed and environment, same raw frames and PCM"),
        (1, "Seeded randomness and a virtual clock for exports"),
        (0, "Exports MP4/WebM with synced audio, plus silent GIF/WebP"),
        (0, "Studio PWA, browser extensions and a CLI"),
    ]
    body.text = items[0][1]
    for level, text in items[1:]:
        para = body.add_paragraph()
        para.text = text
        para.level = level
    for para in body.paragraphs:
        style_runs(para, 24 if para.level == 0 else 20, INK if para.level == 0 else MUTED)
    accent = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Emu(0), Emu(0), Emu(160000), Emu(SLIDE_H))
    accent.fill.solid()
    accent.fill.fore_color.theme_color = MSO_THEME_COLOR.ACCENT_1
    accent.line.fill.background()


def image_slide(prs: Presentation) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[5])
    slide.shapes.title.text = "Made of layers"
    style_runs(slide.shapes.title.text_frame.paragraphs[0], 40, INK, True)
    picture = slide.shapes.add_picture(io.BytesIO(woven_picture()), Emu(609600), Emu(1600200), Emu(6400800), Emu(3600450))
    picture.line.color.rgb = rgb("D8DAE5")
    picture.line.width = Pt(1)
    caption = add_text(
        slide,
        7315200,
        1600200,
        4267200,
        3600450,
        "Every format becomes boxes, text, paths and images.",
        24,
        INK,
        True,
    )
    frame = caption.text_frame
    frame.vertical_anchor = MSO_ANCHOR.MIDDLE
    para = frame.add_paragraph()
    para.text = "The swarm then draws, types and paints each layer in reading order."
    style_runs(para, 18, MUTED)


def chart_slide(prs: Presentation) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[5])
    slide.shapes.title.text = "Formats per release"
    style_runs(slide.shapes.title.text_frame.paragraphs[0], 40, INK, True)

    base_y, left, bar_w, gap, unit = 5600000, 1500000, 1100000, 500000, 260000
    data = [("v0.1", 4, INDIGO), ("v0.2", 7, TEAL), ("v0.3", 10, AMBER), ("v0.4", 13, CORAL), ("v1.0", 16, ORCHID)]
    axis = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Emu(left - 300000), Emu(base_y), Emu(10300000), Emu(base_y))
    axis.line.color.rgb = rgb(MUTED)
    axis.line.width = Pt(1.5)
    for i, (label, value, colour) in enumerate(data):
        x = left + i * (bar_w + gap)
        height = value * unit
        bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Emu(x), Emu(base_y - height), Emu(bar_w), Emu(height))
        bar.fill.solid()
        bar.fill.fore_color.rgb = rgb(colour)
        bar.line.fill.background()
        add_text(slide, x, base_y - height - 420000, bar_w, 380000, str(value), 18, INK, True, PP_ALIGN.CENTER)
        add_text(slide, x, base_y + 80000, bar_w, 380000, label, 16, MUTED, False, PP_ALIGN.CENTER)

    note = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Emu(9000000), Emu(1700000), Emu(2600000), Emu(900000))
    note.fill.solid()
    note.fill.fore_color.rgb = rgb("EEF0FF")
    note.line.color.rgb = rgb(INDIGO)
    note.line.width = Pt(1.25)
    frame = note.text_frame
    frame.text = "Adapters load lazily"
    style_runs(frame.paragraphs[0], 16, INDIGO, True)


def closing_slide(prs: Presentation) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = rgb(PAPER)
    add_text(slide, 609600, 700000, 10972800, 1000000, "Thank you", 54, INK, True, PP_ALIGN.CENTER)
    add_text(slide, 609600, 1650000, 10972800, 500000, "github.com/Boulea7/swarmloom · MIT licence", 20, MUTED, False, PP_ALIGN.CENTER)

    rows = [("Platform", "Start with"), ("Browser extension", "Alt+Shift+W on any page"), ("Studio (PWA)", "Drop a file"), ("CLI", "swarmloom render (in development)")]
    table = slide.shapes.add_table(len(rows), 2, Emu(2438400), Emu(2700000), Emu(7315200), Emu(1900000)).table
    table.columns[0].width = Emu(2900000)
    table.columns[1].width = Emu(4415200)
    for r, (left_text, right_text) in enumerate(rows):
        for c, text in enumerate((left_text, right_text)):
            cell = table.cell(r, c)
            cell.text = text
            style_runs(cell.text_frame.paragraphs[0], 16, None, True if r == 0 else None)

    for i, colour in enumerate([INDIGO, CORAL, TEAL]):
        ring = slide.shapes.add_shape(MSO_SHAPE.OVAL, Emu(5546000 + i * 400000), Emu(5300000), Emu(300000), Emu(300000))
        ring.fill.background()
        ring.line.color.rgb = rgb(colour)
        ring.line.width = Pt(3)


def reproducible_zip(data: bytes) -> bytes:
    """Rewrite the package with fixed entry timestamps so reruns produce identical bytes."""
    src = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            entry = zipfile.ZipInfo(info.filename, FIXED_ZIP_TIME)
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o644 << 16
            dst.writestr(entry, src.read(info.filename), compresslevel=9)
    return out.getvalue()


def main() -> None:
    prs = Presentation()
    prs.slide_width = Emu(SLIDE_W)
    prs.slide_height = Emu(SLIDE_H)
    rebrand_theme(prs)
    widen_layouts(prs)
    fixed = dt.datetime(2026, 1, 1)
    props = prs.core_properties
    props.title = "SwarmLoom pitch"
    props.author = "SwarmLoom contributors"
    props.last_modified_by = "SwarmLoom contributors"
    props.created = fixed
    props.modified = fixed
    props.revision = 1

    title_slide(prs)
    bullets_slide(prs)
    image_slide(prs)
    chart_slide(prs)
    closing_slide(prs)

    buf = io.BytesIO()
    prs.save(buf)
    OUT.write_bytes(reproducible_zip(buf.getvalue()))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
