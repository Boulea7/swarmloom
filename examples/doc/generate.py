"""Generate examples/doc/report.doc, the Word 97-2003 (.doc) sample of SwarmLoom.

The file is written byte by byte from the published MS-DOC and MS-CFB specifications, with the
Python standard library only, so the sample is produced by this project (MIT like the rest of the
repository). It exercises what the DOC adapter reads: the built-in Title and Heading styles, mixed
Chinese and Latin text, a footnote, a hyperlink field, a bordered table, a header and a footer, an
explicit page break and a second, landscape section (three sheets in total).

Usage (from the repository root, Python 3.9 or later, no packages needed):

    python3 examples/doc/generate.py

The output is byte-for-byte reproducible: no timestamps or random values are written.
It is checked by SwarmLoom's own parser and by an independent .doc text extractor; it has not been
opened in Microsoft Word, so treat it as a parser sample rather than a Word compatibility reference.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path

OUT = Path(__file__).resolve().parent / "report.doc"

HOME = "https://github.com/Boulea7/swarmloom"

# ---------------------------------------------------------------------------------------------
# Property modifiers (sprms, MS-DOC 2.6). The operand size follows from bits 13-15 of the opcode.
# ---------------------------------------------------------------------------------------------

_FIXED = {0: 1, 1: 1, 2: 2, 3: 4, 4: 2, 5: 2, 7: 3}


def sprm(op: int, value: int | bytes) -> bytes:
    """One sprm with a fixed-size operand (an int) or a variable one (bytes, 1-byte size prefix)."""
    spra = op >> 13
    head = struct.pack("<H", op)
    if spra == 6:
        assert isinstance(value, bytes) and len(value) < 256
        return head + bytes([len(value)]) + value
    size = _FIXED[spra]
    assert isinstance(value, int)
    return head + value.to_bytes(size, "little", signed=value < 0)


# Character sprms.
C_BOLD = 0x0835
C_ISTD = 0x4A30
C_SPEC = 0x0855
C_SIZE = 0x4A43  # half-points
C_FONT_ASCII = 0x4A4F
C_FONT_EAST_ASIA = 0x4A50
C_FONT_OTHER = 0x4A51
C_LID_ASCII = 0x486D
C_LID_EAST_ASIA = 0x486E
C_VERT = 0x2A48  # 1 = superscript
C_UNDERLINE = 0x2A3E
C_COLOR = 0x2A42  # Ico: 2 = blue

# Paragraph and table sprms.
P_ALIGN = 0x2403  # 1 = centred
P_KEEP_NEXT = 0x2406
P_SPACE_BEFORE = 0xA413
P_SPACE_AFTER = 0xA414
P_LINE = 0x6412
P_OUTLINE = 0x2640
P_IN_TABLE = 0x2416
P_ROW_END = 0x2417
T_GAP_HALF = 0x9602
T_DEF_TABLE = 0xD608

# Section sprms.
S_BREAK = 0x3009  # 2 = new page
S_ORIENT = 0x301D  # 2 = landscape
S_PAGE_WIDTH = 0xB01F
S_PAGE_HEIGHT = 0xB020
S_MARGIN_LEFT = 0xB021
S_MARGIN_RIGHT = 0xB022
S_MARGIN_TOP = 0x9023
S_MARGIN_BOTTOM = 0x9024
S_HEADER_TOP = 0xB017
S_FOOTER_BOTTOM = 0xB018


def line_spacing(twips: int, multiple: bool) -> bytes:
    return struct.pack("<HhH", P_LINE, twips, 1 if multiple else 0)


def table_definition(edges: list[int]) -> bytes:
    """sprmTDefTable: column edges in twips and a single 1/2 pt black border on every cell side."""
    cells = len(edges) - 1
    brc = bytes([4, 1, 1, 0])  # Brc80: width in 1/8 pt, single line, black, no spacing
    tc = struct.pack("<HH", 0, 0) + brc * 4
    operand = bytes([cells]) + b"".join(struct.pack("<h", e) for e in edges) + tc * cells
    # The operand of sprmTDefTable has a 2-byte size that counts the rest of the operand plus one.
    return struct.pack("<HH", T_DEF_TABLE, len(operand) + 1) + operand


# ---------------------------------------------------------------------------------------------
# Fonts (SttbfFfn) and styles (STSH)
# ---------------------------------------------------------------------------------------------

FONTS = [
    # name, family (1 roman, 2 swiss, 3 modern, 5 decorative), charset
    ("Times New Roman", 1, 0),
    ("Symbol", 5, 2),
    ("Arial", 2, 0),
    ("宋体", 1, 0x86),
    ("微软雅黑", 2, 0x86),
    ("Courier New", 3, 0),
]
F_ARIAL, F_SONG, F_YAHEI = 2, 3, 4


def font_table() -> bytes:
    out = struct.pack("<HH", len(FONTS), 0)
    for name, family, charset in FONTS:
        flags = 2 | 0x04 | (family << 4)  # variable pitch, TrueType, family
        body = bytes([flags]) + struct.pack("<h", 400) + bytes([charset, 0]) + bytes(10) + bytes(24)
        body += name.encode("utf-16-le") + b"\0\0"
        out += bytes([len(body)]) + body
    return out


@dataclass
class Style:
    istd: int
    sti: int
    name: str
    kind: str = "paragraph"  # or "character"
    base: int = 0x0FFF
    next: int = 0
    papx: bytes = b""
    chpx: bytes = b""


NORMAL, H1, H2, H3, DEFAULT_FONT = 0, 1, 2, 3, 10
TITLE, HEADER, FOOTER, NOTE_TEXT, NOTE_REF, HYPERLINK = 15, 16, 17, 18, 19, 20


def heading(istd: int, size: int, before: int) -> Style:
    return Style(
        istd,
        sti=istd,
        name=f"heading {istd}",
        base=NORMAL,
        papx=sprm(P_KEEP_NEXT, 1) + sprm(P_SPACE_BEFORE, before) + sprm(P_SPACE_AFTER, 120) + sprm(P_OUTLINE, istd - 1),
        chpx=sprm(C_BOLD, 1) + sprm(C_SIZE, size) + sprm(C_FONT_EAST_ASIA, F_YAHEI),
    )


STYLES = [
    Style(
        NORMAL,
        sti=0,
        name="Normal",
        papx=sprm(P_SPACE_AFTER, 120) + line_spacing(300, True),
        chpx=sprm(C_FONT_ASCII, F_ARIAL)
        + sprm(C_FONT_EAST_ASIA, F_SONG)
        + sprm(C_FONT_OTHER, F_ARIAL)
        + sprm(C_SIZE, 21)
        + sprm(C_LID_ASCII, 0x0409)
        + sprm(C_LID_EAST_ASIA, 0x0804),
    ),
    heading(H1, 32, 360),
    heading(H2, 28, 240),
    heading(H3, 24, 200),
    Style(DEFAULT_FONT, sti=65, name="Default Paragraph Font", kind="character", next=DEFAULT_FONT),
    Style(
        TITLE,
        sti=62,
        name="Title",
        base=NORMAL,
        papx=sprm(P_ALIGN, 1) + sprm(P_SPACE_BEFORE, 240) + sprm(P_SPACE_AFTER, 360),
        chpx=sprm(C_BOLD, 1) + sprm(C_SIZE, 36) + sprm(C_FONT_EAST_ASIA, F_YAHEI),
    ),
    Style(HEADER, sti=31, name="header", base=NORMAL, papx=sprm(P_ALIGN, 1), chpx=sprm(C_SIZE, 18)),
    Style(FOOTER, sti=32, name="footer", base=NORMAL, papx=sprm(P_ALIGN, 1), chpx=sprm(C_SIZE, 18)),
    Style(NOTE_TEXT, sti=29, name="footnote text", base=NORMAL, chpx=sprm(C_SIZE, 18)),
    Style(NOTE_REF, sti=38, name="footnote reference", kind="character", base=DEFAULT_FONT, next=NOTE_REF,
          chpx=sprm(C_VERT, 1)),
    Style(HYPERLINK, sti=85, name="Hyperlink", kind="character", base=DEFAULT_FONT, next=HYPERLINK,
          chpx=sprm(C_UNDERLINE, 1) + sprm(C_COLOR, 2)),
]


def upx(data: bytes) -> bytes:
    """An LPUpx: 2-byte size, the bytes, then padding to an even length."""
    return struct.pack("<H", len(data)) + data + (b"\0" if len(data) % 2 else b"")


def std(style: Style) -> bytes:
    name = struct.pack("<H", len(style.name)) + style.name.encode("utf-16-le") + b"\0\0"
    if style.kind == "paragraph":
        upxs = [upx(struct.pack("<H", style.istd) + style.papx), upx(style.chpx)]
        stk = 1
    else:
        upxs = [upx(style.chpx)]
        stk = 2
    size = 10 + len(name) + sum(len(u) for u in upxs)
    # StdfBase: sti, stk | istdBase, cupx | istdNext, bchUpe, grfstd.
    base = struct.pack("<HHHHH", style.sti, stk | (style.base << 4), len(upxs) | (style.next << 4), size, 0)
    return base + name + b"".join(upxs)


def style_sheet() -> bytes:
    by_istd = {s.istd: s for s in STYLES}
    count = max(by_istd) + 1
    # Stshif: cstd, cbSTDBaseInFile, fStdStylenamesWritten, stiMaxWhenSaved, istdMaxFixedWhenSaved,
    # nVerBuiltInNamesWhenSaved, default ASCII / East Asian / other fonts.
    stshi = struct.pack("<HHHHHHHHH", count, 10, 1, 91, 15, 0, F_ARIAL, F_SONG, F_ARIAL)
    out = struct.pack("<H", len(stshi)) + stshi
    for istd in range(count):
        entry = std(by_istd[istd]) if istd in by_istd else b""
        out += struct.pack("<H", len(entry)) + entry
    return out


# ---------------------------------------------------------------------------------------------
# Text stories
# ---------------------------------------------------------------------------------------------


@dataclass
class Story:
    """Text of one story with its character runs and paragraph ends, in story-relative CPs."""

    text: list[str] = field(default_factory=list)
    cp: int = 0
    chars: list[tuple[int, int, bytes]] = field(default_factory=list)
    paras: list[tuple[int, int, bytes]] = field(default_factory=list)
    marks: dict[str, int] = field(default_factory=dict)

    def run(self, text: str, chpx: bytes = b"") -> Story:
        if text:
            self.chars.append((self.cp, self.cp + len(text), chpx))
            self.text.append(text)
            self.cp += len(text)
        return self

    def mark(self, name: str) -> Story:
        self.marks[name] = self.cp
        return self

    def end(self, istd: int = NORMAL, papx: bytes = b"", mark: str = "\r") -> Story:
        self.run(mark)
        self.paras.append((self.cp, istd, papx))
        return self

    def para(self, text: str, istd: int = NORMAL, papx: bytes = b"") -> Story:
        return self.run(text).end(istd, papx)

    @property
    def value(self) -> str:
        return "".join(self.text)


SPECIAL = sprm(C_SPEC, 1)
IN_CELL = sprm(P_IN_TABLE, 1)
TABLE_EDGES = [0, 2300, 4600, 8300]
TABLE = [
    ("流 Stream", "内容 Content", "说明 Note"),
    ("WordDocument", "FIB、正文、格式页", "FIB, text and formatting pages"),
    ("1Table", "样式、分段表、分节表", "Styles, piece table, sections"),
    ("文本 Text", "UTF-16LE", "中文与 Latin 同在一段"),
]


def main_story() -> Story:
    s = Story()
    s.para("群织旧版文档样例 · SwarmLoom Legacy DOC Sample", TITLE)
    s.para(
        "这份 Word 97-2003 文件由 examples/doc/generate.py 逐字节写出，用来演示群织如何把旧版 .doc "
        "织成一页页的纸面。This Word 97-2003 file is written byte by byte by a script in this repository."
    )
    s.para("1 织机如何读取 .doc", H1)
    s.run(
        "解析器直接在浏览器里读取复合文件、文件信息块与分段表，不需要服务器，也不调用 Word。"
        "The parser reads the compound file, the FIB and the piece table in pure JavaScript."
    )
    s.mark("footnote").run("\x02", SPECIAL + sprm(C_ISTD, NOTE_REF)).end()
    s.para("1.1 文本模式 Text mode", H2)
    s.para(
        "默认的文本模式保留标题、段落、表格、页眉页脚、脚注与分节，不显示图片和字符格式（字体、颜色、强调）。"
        "Text mode keeps headings, paragraphs, tables, headers, footers, notes and sections."
    )
    s.run("项目主页 Project home: ")
    s.mark("field-begin").run("\x13", SPECIAL).run(f' HYPERLINK "{HOME}" ')
    s.mark("field-separator").run("\x14", SPECIAL).run(HOME.removeprefix("https://"), sprm(C_ISTD, HYPERLINK))
    s.mark("field-end").run("\x15", SPECIAL).end()
    s.para("1.2 文件里的流 Streams in this file", H2)
    for r, row in enumerate(TABLE):
        for cell in row:
            s.run(cell, sprm(C_BOLD, 1) if r == 0 else b"").end(NORMAL, IN_CELL, mark="\x07")
        s.end(NORMAL, IN_CELL + sprm(P_ROW_END, 1) + sprm(T_GAP_HALF, 108) + table_definition(TABLE_EDGES), mark="\x07")
    s.para(
        "下一页从显式分页符开始：群织只在真实的分页符与分节处切分纸张，不模拟 Word 的自动分页。"
        "The next sheet starts at an explicit page break."
    )
    s.run("\x0c").para("2 分页与分节 Pages and sections", H1)
    # A section break (0x0C) takes the place of the paragraph mark of the section's last paragraph.
    s.run(
        "这一页仍属于第一节（纵向 A4）。本页末尾的分节符开启一个横向的新节，页眉和页脚沿用第一节的内容。"
        "This sheet still belongs to the first, portrait section."
    ).end(NORMAL, mark="\x0c")
    s.mark("section-2")
    s.para("3 横向页 Landscape page", H1)
    s.para(
        "横向页面更宽：群织按每一节的纸张尺寸画出纸面，纸与纸之间留出桌面灰的间隙。"
        "Each sheet takes the paper size of its section; sheets are stacked with a gap."
    )
    s.para("3.1 页眉与页脚 Header and footer", H3)
    s.para("页眉“群织 SwarmLoom · 旧版 Word 样例”和页脚出现在每一页上。The header and footer repeat on every sheet.")
    s.para("— 完 · The End —", NORMAL, sprm(P_ALIGN, 1))
    return s


def footnote_story() -> Story:
    s = Story()
    s.run("\x02", SPECIAL + sprm(C_ISTD, NOTE_REF)).run(
        " MS-DOC 是微软公开的 Word 二进制格式规范。MS-DOC is Microsoft's published specification of the format."
    )
    s.end(NOTE_TEXT)
    s.mark("end").end()  # Word ends the footnote document with one more paragraph mark
    return s


def header_story() -> tuple[Story, list[int]]:
    """The header document and its PlcfHdd CPs: 6 separator stories, then 6 stories per section."""
    s = Story()
    cps = [0] * 6  # footnote/endnote separators: empty, so Word uses its defaults
    cps += [s.cp]  # even header (unused: the document is not set up for facing pages)
    cps += [s.cp]
    s.para("群织 SwarmLoom · 旧版 Word 样例", HEADER).end(HEADER)
    cps += [s.cp]  # even footer
    cps += [s.cp]
    s.para("examples/doc/report.doc · generated by generate.py · MIT", FOOTER).end(FOOTER)
    cps += [s.cp, s.cp]  # first-page header and footer: empty
    cps += [s.cp] * 6  # second section: empty stories inherit the first section's
    end = s.cp
    s.end()  # the header document ends with one more paragraph mark
    cps += [end, end + 3]  # end of the last story, then Word's guard entry
    return s, cps


# ---------------------------------------------------------------------------------------------
# Formatted disk pages (FKP), MS-DOC 2.9.
# ---------------------------------------------------------------------------------------------

PAGE = 512
TEXT_FC = 0x800


def fkp_pages(runs: list[tuple[int, int, bytes]], kind: str) -> list[tuple[int, int, bytes]]:
    """Packs (fcStart, fcEnd, data) runs into FKP pages; returns (first fc, last fc, page bytes)."""
    entry_size = 13 if kind == "papx" else 1
    pages = []
    i = 0
    while i < len(runs):
        chosen: list[tuple[int, int, bytes]] = []
        blobs: dict[bytes, int] = {}
        used = 0
        while i < len(runs):
            data = runs[i][2]
            blob = encode_fkp_entry(data, kind)
            extra = 0 if (not blob or blob in blobs) else len(blob)
            crun = len(chosen) + 1
            if (crun + 1) * 4 + crun * entry_size + used + extra > PAGE - 2:
                break
            if extra:
                blobs[blob] = 0
                used += extra
            chosen.append(runs[i])
            i += 1
        if not chosen:
            raise ValueError("a single property run does not fit in an FKP page")
        page = bytearray(PAGE)
        top = PAGE - 2
        for blob in blobs:
            top -= len(blob)
            page[top : top + len(blob)] = blob
            blobs[blob] = top
        crun = len(chosen)
        for k, (fc_start, _, _) in enumerate(chosen):
            struct.pack_into("<I", page, k * 4, fc_start)
        struct.pack_into("<I", page, crun * 4, chosen[-1][1])
        table = (crun + 1) * 4
        for k, (_, _, data) in enumerate(chosen):
            blob = encode_fkp_entry(data, kind)
            page[table + k * entry_size] = blobs[blob] // 2 if blob else 0
        page[PAGE - 1] = crun
        pages.append((chosen[0][0], chosen[-1][1], bytes(page)))
    return pages


def encode_fkp_entry(data: bytes, kind: str) -> bytes:
    """A Chpx (cb, grpprl) or a PapxInFkp (cb or 0 + cb', istd + grpprl), padded to an even size."""
    if kind == "chpx":
        if not data:
            return b""
        blob = bytes([len(data)]) + data
        return blob + (b"\0" if len(blob) % 2 else b"")
    if len(data) % 2:
        return bytes([(len(data) + 1) // 2]) + data
    return bytes([0, len(data) // 2]) + data


def bin_table(pages: list[tuple[int, int, bytes]], first_pn: int) -> bytes:
    fcs = [p[0] for p in pages] + [pages[-1][1]]
    return b"".join(struct.pack("<I", fc) for fc in fcs) + b"".join(
        struct.pack("<I", first_pn + k) for k in range(len(pages))
    )


def plc(cps: list[int], data: list[bytes] | None = None) -> bytes:
    return b"".join(struct.pack("<I", cp) for cp in cps) + b"".join(data or [])


# ---------------------------------------------------------------------------------------------
# Document assembly
# ---------------------------------------------------------------------------------------------

PORTRAIT = (
    sprm(S_BREAK, 2)
    + sprm(S_PAGE_WIDTH, 11906)
    + sprm(S_PAGE_HEIGHT, 16838)
    + sprm(S_MARGIN_LEFT, 1800)
    + sprm(S_MARGIN_RIGHT, 1800)
    + sprm(S_MARGIN_TOP, 1440)
    + sprm(S_MARGIN_BOTTOM, 1440)
    + sprm(S_HEADER_TOP, 851)
    + sprm(S_FOOTER_BOTTOM, 992)
)
LANDSCAPE = (
    sprm(S_BREAK, 2)
    + sprm(S_ORIENT, 2)
    + sprm(S_PAGE_WIDTH, 16838)
    + sprm(S_PAGE_HEIGHT, 11906)
    + sprm(S_MARGIN_LEFT, 1440)
    + sprm(S_MARGIN_RIGHT, 1440)
    + sprm(S_MARGIN_TOP, 1800)
    + sprm(S_MARGIN_BOTTOM, 1800)
    + sprm(S_HEADER_TOP, 851)
    + sprm(S_FOOTER_BOTTOM, 992)
)


def dop() -> bytes:
    """A Dop97 (500 bytes) with Word's defaults: widow control, footnotes at the page bottom, 0.5 in tabs."""
    out = bytearray(500)
    struct.pack_into("<H", out, 0, 0x0002 | (1 << 5))  # fWidowControl, fpc = bottom of page
    struct.pack_into("<H", out, 2, 1 << 2)  # nFtn: footnotes start at 1
    struct.pack_into("<H", out, 10, 720)  # dxaTab
    struct.pack_into("<H", out, 14, 360)  # dxaHotZ
    struct.pack_into("<H", out, 32, 1)  # nRevision
    return bytes(out)


def build_document() -> tuple[bytes, bytes]:
    main = main_story()
    notes = footnote_story()
    header, hdd = header_story()
    ccp_text, ccp_ftn, ccp_hdd = main.cp, notes.cp, header.cp
    stories = [(main, 0), (notes, ccp_text), (header, ccp_text + ccp_ftn)]
    guard = Story().end()  # one more paragraph mark after the last story
    stories.append((guard, ccp_text + ccp_ftn + ccp_hdd))
    total = ccp_text + ccp_ftn + ccp_hdd + guard.cp
    text = "".join(story.value for story, _ in stories)
    assert len(text) == total

    def fc(cp: int) -> int:
        return TEXT_FC + 2 * cp

    char_runs: list[tuple[int, int, bytes]] = []
    para_runs: list[tuple[int, int, bytes]] = []
    for story, offset in stories:
        for start, end, chpx in story.chars:
            if char_runs and char_runs[-1][2] == chpx and char_runs[-1][1] == fc(offset + start):
                char_runs[-1] = (char_runs[-1][0], fc(offset + end), chpx)
            else:
                char_runs.append((fc(offset + start), fc(offset + end), chpx))
        start = offset
        for end, istd, papx in story.paras:
            para_runs.append((fc(start), fc(offset + end), struct.pack("<H", istd) + papx))
            start = offset + end

    word = bytearray(TEXT_FC)
    word += text.encode("utf-16-le")
    word += bytes(-len(word) % PAGE)
    chpx_pages = fkp_pages(char_runs, "chpx")
    chpx_pn = len(word) // PAGE
    for page in chpx_pages:
        word += page[2]
    papx_pages = fkp_pages(para_runs, "papx")
    papx_pn = len(word) // PAGE
    for page in papx_pages:
        word += page[2]
    sepx_fcs = []
    for grpprl in (PORTRAIT, LANDSCAPE):
        sepx_fcs.append(len(word))
        word += struct.pack("<H", len(grpprl)) + grpprl
        word += bytes(len(word) % 2)

    # Table stream.
    table = bytearray()
    fc_lcb: dict[int, tuple[int, int]] = {}

    def put(index: int, data: bytes) -> None:
        fc_lcb[index] = (len(table), len(data))
        table.extend(data)
        table.extend(bytes(len(table) % 2))

    put(1, style_sheet())
    fc_lcb[0] = fc_lcb[1]  # the original style sheet is the same one
    ref_cp = main.marks["footnote"]
    put(2, plc([ref_cp, ccp_text], [struct.pack("<h", 1)]))  # FRD: auto-numbered
    put(3, plc([0, notes.marks["end"], ccp_ftn]))
    section_2 = main.marks["section-2"]
    sed = [struct.pack("<HIHI", 0, sepx, 0, 0xFFFFFFFF) for sepx in sepx_fcs]
    put(6, plc([0, section_2, total], sed))
    put(11, plc(hdd))
    put(12, bin_table(chpx_pages, chpx_pn))
    put(13, bin_table(papx_pages, papx_pn))
    put(15, font_table())
    fields = [
        (main.marks["field-begin"], bytes([0x13, 88])),  # flt 88 = HYPERLINK
        (main.marks["field-separator"], bytes([0x14, 0xFF])),
        (main.marks["field-end"], bytes([0x15, 0x80])),  # fHasSep
    ]
    put(16, plc([cp for cp, _ in fields] + [ccp_text], [d for _, d in fields]))
    put(31, dop())
    pcd = struct.pack("<HIH", 0, TEXT_FC, 0)  # one uncompressed (UTF-16LE) piece
    pcdt = plc([0, total], [pcd])
    put(33, b"\x02" + struct.pack("<I", len(pcdt)) + pcdt)

    # File Information Block (MS-DOC 2.5.1), Word 97 layout.
    fib = bytearray(TEXT_FC)
    struct.pack_into("<HHHHH", fib, 0, 0xA5EC, 0x00C1, 0, 0x0804, 0)
    struct.pack_into("<H", fib, 0x0A, 0x0200 | 0x1000)  # fWhichTblStm (1Table), fExtChar
    struct.pack_into("<H", fib, 0x0C, 0x00BF)  # nFibBack
    struct.pack_into("<II", fib, 0x18, TEXT_FC, TEXT_FC + 2 * total)  # legacy fcMin / fcMac
    struct.pack_into("<H", fib, 0x20, 14)  # csw
    struct.pack_into("<H", fib, 0x22 + 13 * 2, 0x0804)  # lidFE
    struct.pack_into("<H", fib, 0x3E, 22)  # cslw
    lw = 0x40
    struct.pack_into("<iii", fib, lw + 3 * 4, ccp_text, ccp_ftn, ccp_hdd)
    struct.pack_into("<H", fib, 0x98, 93)  # cbRgFcLcb (Word 97)
    for index, (fc_value, lcb) in fc_lcb.items():
        struct.pack_into("<II", fib, 0x9A + index * 8, fc_value, lcb)
    struct.pack_into("<H", fib, 0x9A + 93 * 8, 0)  # cswNew
    word[:TEXT_FC] = fib
    struct.pack_into("<i", word, lw, len(word))  # cbMac
    return bytes(word), bytes(table)


# ---------------------------------------------------------------------------------------------
# Compound File Binary container (MS-CFB), version 3, 512-byte sectors, no mini stream.
# ---------------------------------------------------------------------------------------------

FREE, END, FAT_SECTOR, NO_STREAM = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD, 0xFFFFFFFF
MINI_CUTOFF = 4096
# CLSID of a Word document, {00020906-0000-0000-C000-000000000046}.
WORD_CLSID = bytes.fromhex("0609020000000000c000000000000046")


def dir_entry(name: str, kind: int, color: int, left: int, right: int, child: int, start: int, size: int,
              clsid: bytes = bytes(16)) -> bytes:
    raw = (name.encode("utf-16-le") + b"\0\0") if name else b""
    entry = bytearray(128)
    entry[: len(raw)] = raw
    struct.pack_into("<HBBIII", entry, 64, len(raw), kind, color, left, right, child)
    entry[80:96] = clsid
    struct.pack_into("<IQ", entry, 116, start, size)
    return bytes(entry)


def compound_file(word: bytes, table: bytes) -> bytes:
    # Streams of at least 4096 bytes live in regular sectors; padding avoids the mini stream.
    word += bytes(max(0, MINI_CUTOFF - len(word)))
    table += bytes(max(0, MINI_CUTOFF - len(table)))
    sectors = [-(-len(s) // PAGE) for s in (word, table)]
    fat_count = 1
    while fat_count * 128 < fat_count + 1 + sum(sectors):
        fat_count += 1
    directory_sector = fat_count
    word_start = directory_sector + 1
    table_start = word_start + sectors[0]
    total = table_start + sectors[1]

    fat = [FREE] * (fat_count * 128)
    for k in range(fat_count):
        fat[k] = FAT_SECTOR
    fat[directory_sector] = END
    for start, count in ((word_start, sectors[0]), (table_start, sectors[1])):
        for k in range(count):
            fat[start + k] = start + k + 1 if k + 1 < count else END
    assert total <= len(fat)

    # Directory: siblings form a red-black tree ordered by name length, then name.
    directory = (
        dir_entry("Root Entry", 5, 1, NO_STREAM, NO_STREAM, 1, END, 0, WORD_CLSID)
        + dir_entry("WordDocument", 2, 1, 2, NO_STREAM, NO_STREAM, word_start, len(word))
        + dir_entry("1Table", 2, 0, NO_STREAM, NO_STREAM, NO_STREAM, table_start, len(table))
        + dir_entry("", 0, 0, NO_STREAM, NO_STREAM, NO_STREAM, 0, 0)
    )

    header = bytearray(PAGE)
    header[0:8] = bytes.fromhex("d0cf11e0a1b11ae1")
    struct.pack_into("<HHHHH", header, 24, 0x003E, 0x0003, 0xFFFE, 9, 6)
    struct.pack_into("<IIIIIIIII", header, 40, 0, fat_count, directory_sector, 0, MINI_CUTOFF, END, 0, END, 0)
    difat = [FREE] * 109
    for k in range(fat_count):
        difat[k] = k
    struct.pack_into("<109I", header, 76, *difat)

    body = struct.pack(f"<{len(fat)}I", *fat) + directory
    body += word + bytes(-len(word) % PAGE) + table + bytes(-len(table) % PAGE)
    return bytes(header) + body


def main() -> None:
    word, table = build_document()
    OUT.write_bytes(compound_file(word, table))
    print(f"wrote {OUT.relative_to(Path.cwd()) if OUT.is_relative_to(Path.cwd()) else OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
