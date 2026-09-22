#!/usr/bin/env python3
"""Generate the demo PDFs for the example bookshelf, plus exact glyph geometry.

Run once (whenever examples/readings.json changes) with the project's venv:

    C:/Users/ayesilka/.venvs/claude/Scripts/python.exe scripts/gen-example-pdfs.py

Outputs (all committed, so CI never needs Python):
    examples/pdfs/<slug>.pdf   the drawn source PDF
    examples/geometry.json     per-line bounding boxes in PDF user space

The geometry lets scripts/build-examples.mjs place text-highlight quads exactly
over the drawn glyphs. Coordinates are PDF points: origin bottom-left, y up.
"""
import json
import os

from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import getFont, stringWidth

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_PATH = os.path.join(ROOT, "examples", "readings.json")
PDF_DIR = os.path.join(ROOT, "examples", "pdfs")
GEOM_PATH = os.path.join(ROOT, "examples", "geometry.json")


def line_box(line, page_w, page_h):
    """Bounding box of one drawn line in PDF user space: (x0, y0, x1, y1)."""
    face = getFont(line["font"]).face
    size = line["size"]
    ascent = face.ascent / 1000.0 * size
    descent = face.descent / 1000.0 * size  # negative
    width = stringWidth(line["text"], line["font"], size)
    x0 = line["x"]
    x1 = line["x"] + width
    y0 = line["y"] + descent
    y1 = line["y"] + ascent
    return [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)]


def main():
    with open(SPEC_PATH, encoding="utf-8") as f:
        spec = json.load(f)

    page_w, page_h = spec["pageSize"]
    os.makedirs(PDF_DIR, exist_ok=True)

    geometry = {"pageSize": [page_w, page_h], "readings": {}}

    for reading in spec["readings"]:
        slug = reading["slug"]
        pdf_path = os.path.join(PDF_DIR, f"{slug}.pdf")
        c = canvas.Canvas(pdf_path, pagesize=(page_w, page_h))
        c.setTitle(reading["title"])

        line_boxes = {}  # line id -> {page, box}
        for page_index, page in enumerate(reading["pages"]):
            for line in page["lines"]:
                c.setFont(line["font"], line["size"])
                c.drawString(line["x"], line["y"], line["text"])
                if "id" in line:
                    line_boxes[line["id"]] = {
                        "page": page_index,
                        "box": line_box(line, page_w, page_h),
                    }
            c.showPage()
        c.save()

        geometry["readings"][slug] = {
            "pageCount": len(reading["pages"]),
            "lines": line_boxes,
        }
        print(f"wrote {os.path.relpath(pdf_path, ROOT)} "
              f"({len(reading['pages'])} pages, {len(line_boxes)} anchored lines)")

    with open(GEOM_PATH, "w", encoding="utf-8") as f:
        json.dump(geometry, f, indent=2)
        f.write("\n")
    print(f"wrote {os.path.relpath(GEOM_PATH, ROOT)}")


if __name__ == "__main__":
    main()
