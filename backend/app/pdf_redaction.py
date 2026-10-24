"""Local PDF text extraction and permanent redaction helpers.

This module handles text-based PDFs only. Scanned PDFs require OCR and are
rejected when no selectable text can be extracted.
"""
from __future__ import annotations

import re
from collections.abc import Iterable

import pymupdf


MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 100
MAX_EXTRACTED_CHARS = 500_000


class PDFRedactionError(ValueError):
    """Raised when a PDF is invalid or cannot be safely processed."""


def extract_pdf_text(data: bytes) -> str:
    """Extract selectable text from a bounded, non-encrypted PDF."""
    if not data or len(data) > MAX_PDF_BYTES:
        raise PDFRedactionError("PDF is empty or exceeds the 10 MB limit.")
    if not data.startswith(b"%PDF-"):
        raise PDFRedactionError("The uploaded file is not a valid PDF.")

    try:
        with pymupdf.open(stream=data, filetype="pdf") as document:
            if document.is_encrypted:
                raise PDFRedactionError("Password-protected PDFs are not supported.")
            if document.page_count < 1 or document.page_count > MAX_PDF_PAGES:
                raise PDFRedactionError("PDF must contain between 1 and 100 pages.")

            pages = [page.get_text("text") for page in document]
    except PDFRedactionError:
        raise
    except Exception as exc:
        raise PDFRedactionError("The PDF could not be opened safely.") from exc

    text = "\\n".join(pages)
    if not text.strip():
        raise PDFRedactionError(
            "No selectable text was found. Scanned PDFs require OCR and are not supported."
        )
    if len(text) > MAX_EXTRACTED_CHARS:
        raise PDFRedactionError("Extracted PDF text exceeds the 500,000 character limit.")
    return text


def redact_pdf(data: bytes, approved_values: Iterable[str]) -> bytes:
    """Permanently redact approved exact text matches and verify the saved PDF.

    The caller must pass only values explicitly approved by the user. A value
    is located independently on each page. If any value cannot be found, the
    operation fails closed instead of returning a possibly incomplete export.
    """
    values = list(dict.fromkeys(
        value for value in approved_values
        if isinstance(value, str) and value.strip()
    ))
    if not values:
        raise PDFRedactionError("Approve at least one value before exporting.")

    # Validate and bound input before processing.
    extract_pdf_text(data)

    try:
        with pymupdf.open(stream=data, filetype="pdf") as document:
            found: set[str] = set()
            for page in document:
                for value in values:
                    rectangles = page.search_for(value)
                    if rectangles:
                        found.add(value)
                        for rectangle in rectangles:
                            page.add_redact_annot(rectangle, fill=(0, 0, 0))

            missing = [value for value in values if value not in found]
            if missing:
                raise PDFRedactionError(
                    "One or more approved values could not be located in the PDF. "
                    "No redacted file was exported."
                )

            for page in document:
                if page.first_annot:
                    page.apply_redactions(images=0, graphics=0)

            output = document.tobytes(garbage=4, deflate=True, clean=True)
    except PDFRedactionError:
        raise
    except Exception as exc:
        raise PDFRedactionError("PDF redaction failed; no file was exported.") from exc

    # Re-open and check the actual saved bytes, not only annotations.
    try:
        with pymupdf.open(stream=output, filetype="pdf") as verified:
            extracted = "\\n".join(page.get_text("text") for page in verified)
    except Exception as exc:
        raise PDFRedactionError("Could not verify the exported PDF.") from exc

    remaining = [value for value in values if re.search(re.escape(value), extracted, re.I)]
    if remaining:
        raise PDFRedactionError(
            "Verification failed: approved text remains extractable from the PDF."
        )
    return output
