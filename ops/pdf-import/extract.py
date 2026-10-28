"""Bounded local extraction. Never execute document actions or follow links.

Run only in the read-only, network-less container described in pdf-import.ts.
Input and output travel over pipes; the document is never stored on disk.
"""
import base64
import json
import resource
import sys

resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
import pymupdf as fitz


def fail(code):
    print(json.dumps({"error": code}))
    sys.exit(0)


def contains(outer, inner):
    return outer.x0 <= inner.x0 and outer.y0 <= inner.y0 and outer.x1 >= inner.x1 and outer.y1 >= inner.y1


def area(rect):
    return max(0, rect.width) * max(0, rect.height)


def rgb(color):
    if color is None:
        return None
    if isinstance(color, (float, int)):
        return (color,) * 3
    if len(color) == 1:
        return tuple(color) * 3
    if len(color) == 3:
        return tuple(color)
    if len(color) == 4:
        c, m, y, k = color
        return (1 - min(1, c + k), 1 - min(1, m + k), 1 - min(1, y + k))
    return None


try:
    payload = json.loads(sys.stdin.buffer.read(7_100_000))
    data = base64.b64decode(payload["data"], validate=True)
    if not data.startswith(b"%PDF-") or len(data) > 5_242_880:
        fail("PDF_TYPE_OR_SIZE")
    doc = fitz.open(stream=data, filetype="pdf")
    if doc.needs_pass:
        fail("PDF_ENCRYPTED")
    if not 1 <= len(doc) <= 12 or doc.xref_length() > 20_000:
        fail("PDF_LIMIT")
    # Include form objects, images and embedded streams in the expansion limit.
    # OS memory/CPU limits also cover decompression of a single hostile stream.
    expanded = 0
    for xref in range(1, doc.xref_length()):
        if doc.xref_is_stream(xref):
            stream = doc.xref_stream(xref)
            expanded += len(stream)
            del stream
            if expanded > 33_554_432:
                fail("PDF_EXPANSION_LIMIT")
    fragments, warnings, excluded, total = [], set(), 0, 0
    for page_number, page in enumerate(doc, 1):
        bounds = page.rect
        if bounds.width > 2500 or bounds.height > 3500:
            fail("PDF_PAGE_LIMIT")
        drawings = page.get_drawings()
        seen = set()
        for span in page.get_texttrace():
            box = fitz.Rect(span["bbox"])
            text = "".join(chr(c[0]) for c in span["chars"] if c[0] >= 32 or c[0] in (9, 10)).strip()
            if not text:
                continue
            if (span["type"] == 3 or span.get("opacity", 1) < 0.05 or span["size"] < 3
                    or box.is_empty or area(box & bounds) < area(box) * .8):
                excluded += 1
                continue
            # Respect paint order: find an opaque backdrop, then reject text
            # subsequently covered by an opaque filled rectangle. Unlike a
            # blanket 'white text' filter, this preserves white-on-dark text.
            background, covered = (1., 1., 1.), False
            for drawing in drawings:
                if drawing.get("fill") is None or drawing.get("fill_opacity", 1) < .98:
                    continue
                # Only a complete rectangular fill proves coverage; bounding
                # boxes of circles/paths must not hide legitimate text.
                if not any(item[0] == "re" and contains(item[1], box) for item in drawing["items"]):
                    continue
                if drawing.get("seqno", -1) < span["seqno"]:
                    background = rgb(drawing["fill"]) or background
                elif drawing.get("seqno", -1) > span["seqno"]:
                    covered = True
            foreground = rgb(span.get("color"))
            if covered or foreground and max(abs(a-b) for a, b in zip(foreground, background)) < .06:
                excluded += 1
                continue
            key = (text, tuple(round(n, 1) for n in box))
            if key in seen:
                excluded += 1
                continue
            seen.add(key)
            total += len(text)
            if total > 120_000 or len(fragments) >= 4000:
                fail("PDF_TEXT_LIMIT")
            fragments.append({"id": len(fragments)+1, "page": page_number,
                              "text": text, "bbox": [round(n, 2) for n in box]})
    if excluded:
        warnings.add("HIDDEN_TEXT_EXCLUDED")
    if not fragments:
        warnings.add("NO_VISIBLE_TEXT")
    # Provenance retains each independent fragment. Position ordering helps
    # reading without pretending to infer tables or complex column semantics.
    fragments.sort(key=lambda f: (f["page"], round(f["bbox"][1] / 4), f["bbox"][0]))
    print(json.dumps({"fragments": fragments, "pages": len(doc), "warnings": sorted(warnings),
                      "engine": "pymupdf-" + fitz.VersionBind}, ensure_ascii=False))
except (MemoryError, RuntimeError, ValueError, KeyError, TypeError, OverflowError):
    fail("PDF_PARSE_FAILED")
