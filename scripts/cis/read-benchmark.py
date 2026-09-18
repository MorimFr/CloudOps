"""Read a locally supplied benchmark without copying it or persisting extracted text.

Development aid only. Install pypdf separately; it is not a CloudOps dependency.
Output metadata to stdout for review. Page numbers are PRINTED benchmark pages;
the supplied PDF's cover adds one to the PDF viewer's one-based page number.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

from pypdf import PdfReader


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--pages", help="Printed page interval, inclusive, e.g. 21:23")
    args = parser.parse_args()
    reader = PdfReader(args.pdf)
    cover = reader.pages[0].extract_text()
    if "v7.0.0 - 05-20-2026" not in cover:
        raise ValueError("Unexpected benchmark cover/version/date")
    if args.pages:
        first, last = map(int, args.pages.split(":"))
        if first < 1 or last >= len(reader.pages) or first > last:
            raise ValueError("Invalid printed page interval")
        for index in range(first, last + 1):
            print(reader.pages[index].extract_text())
        return
    heading = re.compile(r"^\s*Page \d+\s+(\d+(?:\.\d+)+)\s+(.+?)\((Automated|Manual)\)\s+Profile Applicability:\s*(.*?)\s*Description:", re.S)
    boundary = re.compile(r"^\s*Page \d+\s+\d+(?:\.\d+)*\s+[A-Z]")
    pages = {index: reader.pages[index].extract_text() for index in range(19, 599)}
    controls = []
    for index, page in pages.items():
        match = heading.search(page)
        if not match:
            continue
        end = index
        while end + 1 in pages and not boundary.search(pages[end + 1]):
            end += 1
        text = "\n".join(pages[number] for number in range(index, end + 1))
        audit = text.split("Audit:", 1)[1].split("Remediation:", 1)[0] if "Audit:" in text else ""
        permissions = sorted(set(re.findall(r"\b[A-Z][A-Za-z-]+(?:\.[A-Za-z]+)*\.(?:Read|ReadWrite)(?:\.[A-Za-z]+)*\b", audit)))
        controls.append({
            "cisId": match[1],
            "title": " ".join(re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "-", match[2]).split()),
            "cisAssessmentStatus": match[3].upper(),
            "profiles": re.findall(r"E[35] Level [12]", match[4]),
            "sourceSection": match[1].rsplit(".", 1)[0],
            "sourcePageStart": index,
            "sourcePageEnd": end,
            "auditPageStart": next((number for number in range(index, end + 1) if "Audit:" in pages[number]), None),
            "remediationPageStart": next((number for number in range(index, end + 1) if "Remediation:" in pages[number]), None),
            "cisExamplePermissions": permissions,
        })
    with args.pdf.open("rb") as source:
        source_sha256 = hashlib.file_digest(source, "sha256").hexdigest()
    print(json.dumps({
        "sourceFile": args.pdf.name,
        "sourceSha256": source_sha256,
        "pdfPages": len(reader.pages),
        "controls": controls,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
