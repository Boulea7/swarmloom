"""Generate examples/docx/report.docx, the DOCX sample of SwarmLoom.

The sample exercises what the DOCX adapter has to rebuild: a title, three heading levels, mixed
Chinese and Latin text with bold/italic/coloured runs, a hyperlink, bullet and numbered lists
(nested), a styled table, a picture drawn here with the SwarmLoom palette, a footnote, a header and
footer with a page number, an explicit page break and a second (landscape) section.

Usage (from the repository root, with python-docx 1.2.0 and Pillow installed):

    python examples/docx/generate.py

The output is byte-for-byte reproducible: core properties and ZIP timestamps are fixed.
"""

from __future__ import annotations

import copy
import io
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT, WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.opc.constants import CONTENT_TYPE as CT
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Cm, Pt, RGBColor
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent / "report.docx"

# SwarmLoom palette (contracts/brand.md), cycled in this order.
PALETTE = ["#5B5BF7", "#FF6B5B", "#14B8A6", "#F5A524", "#D946EF", "#3BA7F5", "#84CC16", "#9B5CF6"]
INK = "#0B0B12"
PAPER = "#FAFAFC"
INDIGO = RGBColor(0x5B, 0x5B, 0xF7)
CORAL = RGBColor(0xFF, 0x6B, 0x5B)
TEAL = RGBColor(0x14, 0xB8, 0xA6)

LATIN_FONT = "Calibri"
CJK_FONT = "Microsoft YaHei"
FIXED_ZIP_TIME = (2026, 11, 10, 0, 0, 0)


def rgb(hex_colour: str) -> tuple[int, int, int]:
    value = hex_colour.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def draw_weave(width: int = 960, height: int = 300) -> bytes:
    """An original woven-threads motif in the SwarmLoom palette, as an indexed PNG."""
    image = Image.new("RGB", (width, height), rgb(PAPER))
    draw = ImageDraw.Draw(image)
    band = 30
    rows = height // band
    cols = width // band
    # Plain weave: weft threads (horizontal) run across the warp (vertical); the warp passes over
    # the weft on every other crossing, alternating row by row.
    def warp(c: int, y0: int, y1: int) -> None:
        x = c * band + band // 2
        draw.rectangle([x - 10, y0, x + 10, y1], fill=rgb(PALETTE[c % len(PALETTE)]))

    for c in range(cols):
        warp(c, 0, height)
    for r in range(rows):
        y = r * band + band // 2
        draw.rectangle([0, y - 10, width, y + 10], fill=rgb(PALETTE[(r * 3 + 2) % len(PALETTE)]))
        for c in range(cols):
            if (r + c) % 2 == 1:
                warp(c, y - 12, y + 12)
    # A small arrow cursor drawing the last thread, outlined in paper white.
    tip = (width - 210, height - 96)
    arrow = [tip, (tip[0], tip[1] + 64), (tip[0] + 16, tip[1] + 50), (tip[0] + 28, tip[1] + 76),
             (tip[0] + 40, tip[1] + 70), (tip[0] + 28, tip[1] + 45), (tip[0] + 48, tip[1] + 45)]
    draw.polygon(arrow, fill=rgb(INK), outline=rgb(PAPER), width=4)
    indexed = image.quantize(colors=16, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    out = io.BytesIO()
    indexed.save(out, format="PNG", optimize=True)
    return out.getvalue()


def set_fonts(style_or_run, latin: str, east_asian: str) -> None:
    """Sets the Latin and East Asian fonts of a style or run (python-docx only sets the Latin one)."""
    style_or_run.font.name = latin
    r_pr = style_or_run.element.get_or_add_rPr()
    fonts = r_pr.find(qn("w:rFonts"))
    if fonts is None:
        fonts = parse_xml(f"<w:rFonts {nsdecls('w')}/>")
        r_pr.insert(0, fonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs"):
        fonts.set(qn(attr), latin)
    fonts.set(qn("w:eastAsia"), east_asian)


def add_hyperlink(paragraph, text: str, url: str) -> None:
    part = paragraph.part
    rel_id = part.relate_to(url, RT.HYPERLINK, is_external=True)
    link = parse_xml(
        f'<w:hyperlink {nsdecls("w", "r")} r:id="{rel_id}">'
        f'<w:r><w:rPr><w:color w:val="5B5BF7"/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>'
        "</w:hyperlink>"
    )
    paragraph._p.append(link)


def add_footnotes_part(document) -> Part:
    """Adds word/footnotes.xml with the two separator notes Word expects."""
    xml = (
        f'<w:footnotes {nsdecls("w")}>'
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
        "</w:footnotes>"
    )
    part = Part(PackURI("/word/footnotes.xml"), CT.WML_FOOTNOTES, xml.encode("utf-8"), document.part.package)
    document.part.relate_to(part, RT.FOOTNOTES)
    return part


def add_footnote(paragraph, footnotes: Part, note_id: int, text: str) -> None:
    """Appends a footnote reference to `paragraph` and its text to the footnotes part."""
    paragraph._p.append(
        parse_xml(
            f'<w:r {nsdecls("w")}><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>'
            f'<w:footnoteReference w:id="{note_id}"/></w:r>'
        )
    )
    body = footnotes.blob.decode("utf-8").replace(
        "</w:footnotes>",
        f'<w:footnote w:id="{note_id}"><w:p><w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:pPr>'
        '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>'
        f'<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> {text}</w:t></w:r></w:p></w:footnote>'
        "</w:footnotes>",
    )
    footnotes._blob = body.encode("utf-8")


def add_page_field(paragraph) -> None:
    """Appends a PAGE field (cached result "1")."""
    for xml in (
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
        '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>',
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
        "<w:r><w:t>1</w:t></w:r>",
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
    ):
        paragraph._p.append(parse_xml(xml.replace("<w:r>", f'<w:r {nsdecls("w")}>', 1)))


def shade(cell, hex_fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_pr.append(parse_xml(f'<w:shd {nsdecls("w")} w:val="clear" w:color="auto" w:fill="{hex_fill}"/>'))


def configure_styles(document) -> None:
    styles = document.styles
    normal = styles["Normal"]
    set_fonts(normal, LATIN_FONT, CJK_FONT)
    normal.font.size = Pt(10.5)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.2
    for name, size, colour in (("Title", 26, INDIGO), ("Heading 1", 16, INDIGO), ("Heading 2", 13, CORAL), ("Heading 3", 11, TEAL)):
        style = styles[name]
        set_fonts(style, LATIN_FONT, CJK_FONT)
        style.font.size = Pt(size)
        style.font.color.rgb = colour
        style.font.bold = True


def first_page(document, footnotes: Part) -> None:
    document.add_paragraph("群织季度报告 · SwarmLoom Weave Report", style="Title")
    intro = document.add_paragraph()
    intro.add_run("2026 年第四季度 · Q4 2026 · ").italic = True
    intro.add_run("内部样例，内容虚构").bold = True

    document.add_heading("1. 概览 Overview", level=1)
    p = document.add_paragraph()
    p.add_run("群织（SwarmLoom）让一群光标当着你的面，把网页、文档和模型一笔一画地“织”出来。")
    p.add_run("A swarm of cursors ")
    p.add_run("rebuilds").bold = True
    p.add_run(" every page ")
    p.add_run("live").italic = True
    p.add_run(", paragraph by paragraph and cell by cell.")
    add_footnote(p, footnotes, 1, "所有数字均为演示用途。All figures are for demonstration only.")

    p = document.add_paragraph("项目主页：")
    add_hyperlink(p, "github.com/Boulea7/swarmloom", "https://github.com/Boulea7/swarmloom")

    document.add_heading("1.1 本季亮点 Highlights", level=2)
    for text in ("文档适配器：DOCX 与 DOC 都能分页重建", "Deterministic video export with synced sound"):
        document.add_paragraph(text, style="List Bullet")
    document.add_paragraph("页框先落下，再逐段打字 · sheets drop in first", style="List Bullet 2")
    document.add_paragraph("Eight interface languages", style="List Bullet")

    document.add_heading("1.2 下一步 Next steps", level=2)
    for text in ("收集格式请求 Collect format requests", "优化长文档节奏 Tune pacing for long documents", "发布 v1"):
        document.add_paragraph(text, style="List Number")

    document.add_heading("2. 指标 Metrics", level=1)
    rows = [
        ("格式 Format", "图层 Layers", "光标 Cursors", "时长 Time"),
        ("DOCX", "412", "24", "38 s"),
        ("PDF", "655", "32", "44 s"),
        ("Markdown", "208", "16", "21 s"),
    ]
    table = document.add_table(rows=len(rows), cols=len(rows[0]))
    table.style = document.styles["Table Grid"]
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for r, values in enumerate(rows):
        for c, value in enumerate(values):
            cell = table.cell(r, c)
            cell.text = value
            run = cell.paragraphs[0].runs[0]
            if r == 0:
                run.bold = True
                run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
                shade(cell, "5B5BF7")
            elif c > 0:
                cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
    document.add_paragraph("表 1：各格式的样例规模 · Table 1: sample sizes per format.").runs[0].italic = True


def second_page(document) -> None:
    document.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    document.add_heading("3. 织物 The weave", level=1)
    document.add_paragraph("下面的图片由样例脚本用群织的调色板绘制。The picture below is drawn by the sample script with the SwarmLoom palette.")
    document.add_picture(io.BytesIO(draw_weave()), width=Cm(15))
    document.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    document.add_heading("3.1 经线与纬线 Warp and weft", level=2)
    document.add_paragraph(
        "每一列是一条经线，每一行是一条纬线；光标负责把纬线穿过去。"
        "Every column is a warp thread and every row a weft thread; the cursors pass the weft through."
    )
    document.add_heading("3.1.1 小结 Summary", level=3)
    document.add_paragraph("先搭框架，再填内容。Frames first, then content.")


def landscape_section(document) -> None:
    section = document.add_section(WD_SECTION.NEW_PAGE)
    section.orientation = WD_ORIENT.LANDSCAPE
    section.page_width, section.page_height = section.page_height, section.page_width
    document.add_heading("附录 Appendix", level=1)
    document.add_paragraph("横向页面来自第二个分节。This landscape sheet comes from a second section.")


def header_footer(document) -> None:
    section = document.sections[0]
    header = section.header.paragraphs[0]
    header.text = "SwarmLoom · 群织"
    header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    header.runs[0].font.color.rgb = INDIGO
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer.add_run("第 ")
    add_page_field(footer)
    footer.add_run(" 页 · Page")


def drop_thumbnail(document) -> None:
    """The python-docx template ships a thumbnail of itself; it is not part of the sample."""
    package = document.part.package
    for rel_id, rel in list(package.rels.items()):
        if rel.reltype == RT.THUMBNAIL:
            package.rels.pop(rel_id)


def normalized(raw: bytes) -> bytes:
    """Rewrites the ZIP with fixed timestamps so repeated runs produce identical bytes."""
    source = zipfile.ZipFile(io.BytesIO(raw))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
        for info in source.infolist():
            fixed = copy.copy(info)
            fixed.date_time = FIXED_ZIP_TIME
            fixed.compress_type = zipfile.ZIP_DEFLATED
            target.writestr(fixed, source.read(info.filename))
    return out.getvalue()


def main() -> None:
    document = Document()
    props = document.core_properties
    props.title = "SwarmLoom Weave Report"
    props.author = "SwarmLoom"
    props.last_modified_by = "SwarmLoom"
    props.revision = 1
    fixed = datetime(2026, 11, 10, tzinfo=timezone.utc)
    props.created = fixed
    props.modified = fixed
    props.last_printed = fixed

    configure_styles(document)
    footnotes = add_footnotes_part(document)
    first_page(document, footnotes)
    second_page(document)
    header_footer(document)
    landscape_section(document)
    drop_thumbnail(document)

    buffer = io.BytesIO()
    document.save(buffer)
    OUT.write_bytes(normalized(buffer.getvalue()))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
