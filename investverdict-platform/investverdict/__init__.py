"""
InvestVerdict — Financial Statement Data Extractor.

Public API:
    from investverdict import extract
    result = extract("path/to/annual_report.pdf")  # -> dict (structured JSON)
"""

from .pipeline import extract

__all__ = ["extract"]
__version__ = "0.1.0"
