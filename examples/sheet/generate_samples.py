"""Generate examples/sheet/sales.xlsx and examples/sheet/cities.csv, the SwarmLoom sheet samples.

Run from any directory with a Python that has openpyxl:

    python examples/sheet/generate_samples.py

All figures are invented. Output is reproducible: fixed document dates and fixed ZIP
entry timestamps.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import re
import zipfile
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

HERE = Path(__file__).resolve().parent
FIXED_ZIP_TIME = (2026, 1, 1, 0, 0, 0)

# SwarmLoom brand palette.
INDIGO = "5B5BF7"
TEAL = "14B8A6"
AMBER = "F5A524"
INK = "0B0B12"
TINT = "EEF0FF"

REGIONS = ["North", "South", "East", "West", "Central"]
PRODUCTS = ["Loom Kit", "Thread Pack", "Cursor Pro", "Studio Pass"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]


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


def units(region: int, product: int, month: int) -> int:
    """Deterministic, plausible-looking unit counts (no randomness)."""
    base = 120 + 37 * region + 53 * product
    season = (month * 17 + region * 11 + product * 7) % 41
    return base + season * 3


def build_workbook() -> Workbook:
    wb = Workbook()
    ws = wb.active
    ws.title = "Sales H1"

    thin = Side(style="thin", color="C9CBF9")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor=INDIGO)
    band_fill = PatternFill("solid", fgColor=TINT)
    total_fill = PatternFill("solid", fgColor=AMBER)

    ws.merge_cells("A1:I1")
    title = ws["A1"]
    title.value = "SwarmLoom sales, first half 2026"
    title.font = Font(name="Calibri", size=16, bold=True, color=INK)
    title.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 30

    headers = ["Region", "Product", *MONTHS, "Total"]
    for col, text in enumerate(headers, start=1):
        cell = ws.cell(row=3, column=col, value=text)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center" if col > 2 else "left", vertical="center")
        cell.border = Border(bottom=thin)
    ws.row_dimensions[3].height = 22

    row = 4
    for r, region in enumerate(REGIONS):
        for p, product in enumerate(PRODUCTS):
            ws.cell(row=row, column=1, value=region)
            ws.cell(row=row, column=2, value=product)
            for m in range(len(MONTHS)):
                cell = ws.cell(row=row, column=3 + m, value=units(r, p, m))
                cell.number_format = "#,##0"
            total = ws.cell(row=row, column=9, value=f"=SUM(C{row}:H{row})")
            total.number_format = "#,##0"
            total.font = Font(bold=True)
            if (row - 4) % 2 == 1:
                for col in range(1, 10):
                    ws.cell(row=row, column=col).fill = band_fill
            row += 1

    last = row - 1
    ws.cell(row=row, column=1, value="Total").font = Font(bold=True)
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=2)
    for col in range(3, 10):
        letter = ws.cell(row=3, column=col).column_letter
        cell = ws.cell(row=row, column=col, value=f"=SUM({letter}4:{letter}{last})")
        cell.number_format = "#,##0"
        cell.font = Font(bold=True)
    for col in range(1, 10):
        ws.cell(row=row, column=col).fill = total_fill
        ws.cell(row=row, column=col).border = Border(top=Side(style="medium", color=INK))

    row += 2
    ws.cell(row=row, column=1, value="Growth vs 2025")
    growth = ws.cell(row=row, column=3, value=0.184)
    growth.number_format = "0.0%"
    ws.cell(row=row + 1, column=1, value="Report date")
    date = ws.cell(row=row + 1, column=3, value=dt.date(2026, 7, 1))
    date.number_format = "yyyy-mm-dd"
    ws.cell(row=row + 2, column=1, value="Average price")
    price = ws.cell(row=row + 2, column=3, value=24.5)
    price.number_format = '"$"#,##0.00'

    ws.column_dimensions["A"].width = 14
    ws.column_dimensions["B"].width = 14
    for col in "CDEFGH":
        ws.column_dimensions[col].width = 9
    ws.column_dimensions["I"].width = 11
    ws.freeze_panes = "C4"

    # A second, smaller sheet so multi-sheet rendering is exercised.
    notes = wb.create_sheet("Notes")
    notes["A1"] = "Product"
    notes["B1"] = "Launched"
    notes["C1"] = "Owner"
    for c in ("A1", "B1", "C1"):
        notes[c].font = Font(bold=True, color="FFFFFF")
        notes[c].fill = PatternFill("solid", fgColor=TEAL)
    for i, (product, launched, owner) in enumerate(
        [
            ("Loom Kit", dt.date(2025, 3, 14), "Weaving team"),
            ("Thread Pack", dt.date(2025, 6, 2), "Assets team"),
            ("Cursor Pro", dt.date(2025, 9, 21), "Core team"),
            ("Studio Pass", dt.date(2026, 1, 8), "Studio team"),
        ],
        start=2,
    ):
        notes.cell(row=i, column=1, value=product)
        cell = notes.cell(row=i, column=2, value=launched)
        cell.number_format = "d mmm yyyy"
        notes.cell(row=i, column=3, value=owner)
    notes.column_dimensions["A"].width = 14
    notes.column_dimensions["B"].width = 14
    notes.column_dimensions["C"].width = 16

    fixed = dt.datetime(2026, 1, 1)
    wb.properties.creator = "SwarmLoom contributors"
    wb.properties.lastModifiedBy = "SwarmLoom contributors"
    wb.properties.created = fixed
    wb.properties.modified = fixed
    wb.properties.title = "SwarmLoom sales"
    return wb


def cached_totals() -> dict[str, int]:
    """Results of the SUM formulas. openpyxl writes formulas without results while spreadsheet
    apps cache them; the sample mimics an app-saved file (the adapter never evaluates formulas)."""
    values: dict[str, int] = {}
    row = 4
    for r in range(len(REGIONS)):
        for p in range(len(PRODUCTS)):
            values[f"I{row}"] = sum(units(r, p, m) for m in range(len(MONTHS)))
            row += 1
    for i, letter in enumerate("CDEFGH"):
        values[f"{letter}{row}"] = sum(
            units(r, p, i) for r in range(len(REGIONS)) for p in range(len(PRODUCTS))
        )
    values[f"I{row}"] = sum(values[f"I{k}"] for k in range(4, row))
    return values


FORMULA_CELL = re.compile(r'<c r="([A-Z]+[0-9]+)"([^>]*)><f>([^<]*)</f>(?:<v\s*/>|<v></v>)*</c>')
INLINE_CELL = re.compile(r'<c ([^>]*?) t="inlineStr"><is><t(?: xml:space="preserve")?>([^<]*)</t></is></c>')
SST_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
SST_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings"
SST_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"


def app_like(parts: dict[str, bytes]) -> None:
    """Post-process openpyxl output in place so it looks like a spreadsheet-app save: cached
    formula results and a shared string table instead of inline strings."""
    totals = cached_totals()
    strings: list[str] = []
    index: dict[str, int] = {}
    count = 0

    def shared(match: re.Match[str]) -> str:
        nonlocal count
        text = match.group(2)
        if text not in index:
            index[text] = len(strings)
            strings.append(text)
        count += 1
        return f'<c {match.group(1)} t="s"><v>{index[text]}</v></c>'

    def cached(match: re.Match[str]) -> str:
        ref, attrs, formula = match.groups()
        value = f"<v>{totals[ref]}</v>" if ref in totals else ""
        return f'<c r="{ref}"{attrs}><f>{formula}</f>{value}</c>'

    for name in sorted(parts):
        if name.startswith("xl/worksheets/sheet"):
            xml = parts[name].decode("utf-8")
            if name == "xl/worksheets/sheet1.xml":
                xml = FORMULA_CELL.sub(cached, xml)
            parts[name] = INLINE_CELL.sub(shared, xml).encode("utf-8")

    items = "".join(f"<si><t>{text}</t></si>" for text in strings)
    parts["xl/sharedStrings.xml"] = (
        f'<sst xmlns="{SST_NS}" count="{count}" uniqueCount="{len(strings)}">{items}</sst>'
    ).encode("utf-8")
    rels = parts["xl/_rels/workbook.xml.rels"].decode("utf-8")
    rel = f'<Relationship Type="{SST_REL}" Target="sharedStrings.xml" Id="rId9"/>'
    parts["xl/_rels/workbook.xml.rels"] = rels.replace("</Relationships>", rel + "</Relationships>").encode("utf-8")
    types = parts["[Content_Types].xml"].decode("utf-8")
    override = f'<Override PartName="/xl/sharedStrings.xml" ContentType="{SST_TYPE}"/>'
    parts["[Content_Types].xml"] = types.replace("</Types>", override + "</Types>").encode("utf-8")


def write_xlsx() -> Path:
    buf = io.BytesIO()
    build_workbook().save(buf)
    src = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
    parts = {info.filename: src.read(info.filename) for info in src.infolist()}
    app_like(parts)
    packed = io.BytesIO()
    with zipfile.ZipFile(packed, "w", zipfile.ZIP_DEFLATED) as dst:
        # [Content_Types].xml first, as Office writes it.
        for name in sorted(parts, key=lambda n: (n != "[Content_Types].xml", n)):
            dst.writestr(name, parts[name])
    out = HERE / "sales.xlsx"
    out.write_bytes(reproducible_zip(packed.getvalue()))
    return out


CITIES = [
    ("Shanghai", "China", 24870895, 6341, "Huangpu River"),
    ("São Paulo", "Brazil", 12396372, 1521, "Tietê River"),
    ("Lagos", "Nigeria", 15388000, 1171, "Lagos Lagoon"),
    ("Mumbai", "India", 12442373, 603, "Arabian Sea"),
    ("Mexico City", "Mexico", 9209944, 1485, "Valley of Mexico"),
    ("Istanbul", "Türkiye", 15655924, 5343, "Bosphorus"),
    ("Tokyo", "Japan", 14094034, 2194, "Tokyo Bay"),
    ("Cairo", "Egypt", 10044894, 3085, "Nile"),
    ("Paris", "France", 2102650, 105, "Seine"),
    ("Toronto", "Canada", 2794356, 630, "Lake Ontario"),
    ("Nairobi", "Kenya", 4397073, 696, "Nairobi River"),
    ("Sydney", "Australia", 5450496, 12368, 'Port Jackson, "the Harbour"'),
]


def write_csv() -> Path:
    """Illustrative, roughly rounded figures for demonstration only (not authoritative data).
    Exercises quoting, an embedded comma and quotes, and non-ASCII names."""
    out = HERE / "cities.csv"
    with out.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(["City", "Country", "Population", "Area (km²)", "Water"])
        for row in CITIES:
            writer.writerow(row)
    return out


def main() -> None:
    for path in (write_xlsx(), write_csv()):
        print(f"wrote {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
