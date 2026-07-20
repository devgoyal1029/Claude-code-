"""
Generate a synthetic Schedule III-style digital PDF for end-to-end testing.
Writes test_inputs/sample_financials.pdf.

Run: python3 tests/make_sample_pdf.py
"""

import os

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "test_inputs", "sample_financials.pdf")


def _table(data):
    t = Table(data, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
    ]))
    return t


def build():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(OUT, pagesize=A4)
    story = []

    story.append(Paragraph("Acme Manufacturing Limited", styles["Title"]))
    story.append(Paragraph(
        "Standalone Statement of Profit and Loss (₹ in Lakhs)", styles["Heading2"]))
    pl = [
        ["Particulars", "Note", "2024-25", "2023-24"],
        ["Revenue from Operations", "21", "16,789.00", "14,567.00"],
        ["Other Income", "22", "1,200.00", "1,100.00"],
        ["Total Income", "", "17,989.00", "15,667.00"],
        ["Cost of materials consumed", "23", "(9,000.00)", "(8,000.00)"],
        ["Employee benefits expense", "24", "(3,000.00)", "(2,800.00)"],
        ["Finance costs", "25", "(500.00)", "(450.00)"],
        ["Total Expenses", "", "(12,500.00)", "(11,250.00)"],
        ["Profit Before Tax", "", "5,489.00", "4,417.00"],
    ]
    story.append(_table(pl))
    story.append(Spacer(1, 8 * mm))

    story.append(Paragraph(
        "Standalone Balance Sheet as at 31 March 2025 (₹ in Lakhs)",
        styles["Heading2"]))
    bs = [
        ["Particulars", "Note", "2024-25", "2023-24"],
        ["Property, Plant and Equipment", "3", "20,000.00", "18,000.00"],
        ["Inventories", "4", "5,000.00", "4,500.00"],
        ["Trade Receivables", "5", "3,000.00", "2,800.00"],
        ["Cash and Cash Equivalents", "6", "2,000.00", "1,700.00"],
        ["Total Assets", "", "30,000.00", "27,000.00"],
        ["Equity Share Capital", "7", "10,000.00", "10,000.00"],
        ["Other Equity", "8", "12,000.00", "9,500.00"],
        ["Borrowings", "9", "5,000.00", "5,500.00"],
        ["Trade Payables", "10", "3,000.00", "2,000.00"],
        ["Total Equity and Liabilities", "", "30,000.00", "27,000.00"],
    ]
    story.append(_table(bs))

    doc.build(story)
    print("Wrote", OUT)


if __name__ == "__main__":
    build()
