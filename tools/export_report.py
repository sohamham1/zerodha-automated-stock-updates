import json
import os
import re
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


PALETTE = {
    "navy": "14263D",
    "steel": "355C7D",
    "mist": "EAF0F6",
    "sand": "ECE6DC",
    "cream": "F8F5EF",
    "green": "216E39",
    "green_soft": "DDF2E3",
    "red": "A63D40",
    "red_soft": "F8D8DA",
    "amber": "A46C1F",
    "amber_soft": "FBECC7",
    "ink": "1F2933",
    "muted": "667085",
    "white": "FFFFFF",
}

THIN_BORDER = Border(
    left=Side(style="thin", color=PALETTE["sand"]),
    right=Side(style="thin", color=PALETTE["sand"]),
    top=Side(style="thin", color=PALETTE["sand"]),
    bottom=Side(style="thin", color=PALETTE["sand"]),
)


def format_currency(value):
    return f"INR {value:,.2f}"


def format_pct(value):
    return f"{value:.2f}%"


def bullet_join(items):
    if not items:
        return "• None"
    cleaned = [str(item).strip() for item in items if str(item or "").strip()]
    return "\n".join([f"• {item}" for item in cleaned]) if cleaned else "• None"


def sentence_bullets(text):
    if not text:
        return "• None"
    parts = [part.strip() for part in re.split(r"(?<=[.!?])\s+", str(text).strip()) if part.strip()]
    if not parts:
        parts = [str(text).strip()]
    return bullet_join(parts)


def bullet_lines(items):
    if not items:
        return "None"
    return "<br/>".join([f"• {item}" for item in items])


def sentiment_fill(sentiment):
    sentiment = (sentiment or "").lower()
    if sentiment == "bullish":
        return PatternFill("solid", fgColor=PALETTE["green_soft"])
    if sentiment == "cautious":
        return PatternFill("solid", fgColor=PALETTE["red_soft"])
    if sentiment == "neutral":
        return PatternFill("solid", fgColor=PALETTE["amber_soft"])
    return PatternFill("solid", fgColor=PALETTE["mist"])


def heat_fill(value):
    if value >= 50:
        return PatternFill("solid", fgColor="CBEFD7")
    if value >= 15:
        return PatternFill("solid", fgColor="E5F6EA")
    if value >= 0:
        return PatternFill("solid", fgColor="F2F6E2")
    if value >= -15:
        return PatternFill("solid", fgColor="FCEFD3")
    if value >= -30:
        return PatternFill("solid", fgColor="F9D9D7")
    return PatternFill("solid", fgColor="F2C6CC")


def set_widths(sheet, widths):
    for col, width in widths.items():
        sheet.column_dimensions[col].width = width


def style_header_row(sheet, row_idx, fill):
    for cell in sheet[row_idx]:
        cell.font = Font(name="Aptos", size=10, bold=True, color=PALETTE["white"])
        cell.fill = PatternFill("solid", fgColor=fill)
        cell.border = THIN_BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)


def style_body_range(sheet, start_row, end_row, left_cols=None):
    left_cols = left_cols or set()
    for row in sheet.iter_rows(min_row=start_row, max_row=end_row):
        for cell in row:
            cell.font = Font(name="Aptos", size=10, color=PALETTE["ink"])
            cell.border = THIN_BORDER
            cell.alignment = Alignment(
                horizontal="left" if cell.column in left_cols else "center",
                vertical="center",
                wrap_text=True,
            )


def autosize_with_cap(sheet, min_width=8, max_width=38):
    for column_cells in sheet.columns:
        letter = get_column_letter(column_cells[0].column)
        length = max(len(str(cell.value or "")) for cell in column_cells)
        sheet.column_dimensions[letter].width = max(min(length + 2, max_width), min_width)


def apply_cover(sheet, title, subtitle, generated_at):
    sheet.merge_cells("A1:J2")
    cell = sheet["A1"]
    cell.value = title
    cell.font = Font(name="Aptos Display", size=24, bold=True, color=PALETTE["white"])
    cell.fill = PatternFill("solid", fgColor=PALETTE["navy"])
    cell.alignment = Alignment(horizontal="left", vertical="center")
    sheet.row_dimensions[1].height = 32
    sheet.row_dimensions[2].height = 32

    sheet.merge_cells("A3:J4")
    sub = sheet["A3"]
    sub.value = subtitle
    sub.font = Font(name="Aptos", size=11, color=PALETTE["ink"])
    sub.fill = PatternFill("solid", fgColor=PALETTE["cream"])
    sub.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

    sheet.merge_cells("H5:J5")
    meta = sheet["H5"]
    meta.value = f"Generated {generated_at[:10]}"
    meta.font = Font(name="Aptos", size=9, italic=True, color=PALETTE["muted"])
    meta.alignment = Alignment(horizontal="right")


def write_kpi_card(sheet, top_left, title, value, accent):
    row = sheet[top_left].row
    col = sheet[top_left].column
    top = sheet.cell(row=row, column=col)
    bottom = sheet.cell(row=row + 1, column=col)
    top.value = title
    bottom.value = value
    top.font = Font(name="Aptos", size=9, bold=True, color=PALETTE["muted"])
    bottom.font = Font(name="Aptos Display", size=16, bold=True, color=accent)
    top.fill = PatternFill("solid", fgColor=PALETTE["cream"])
    bottom.fill = PatternFill("solid", fgColor=PALETTE["white"])
    top.border = THIN_BORDER
    bottom.border = THIN_BORDER
    top.alignment = Alignment(horizontal="left")
    bottom.alignment = Alignment(horizontal="left")


def add_dashboard(workbook, report):
    sheet = workbook.active
    sheet.title = "Dashboard"
    apply_cover(
        sheet,
        "Portfolio Weekly Intelligence Report",
        "A polished weekly dashboard grounded in Zerodha holdings, then layered with public evidence, brokerage coverage, and explicit caveats.",
        report["generatedAt"],
    )

    summary = report["summary"]
    invested = summary.get("totalInvested") or sum(h["investedValue"] for h in report["holdings"])
    pnl = summary["totalPnl"]
    ret = 0 if not invested else (pnl / invested) * 100
    pnl_color = PALETTE["green"] if pnl >= 0 else PALETTE["red"]

    write_kpi_card(sheet, "A7", "Current Value", format_currency(summary["totalValue"]), PALETTE["navy"])
    write_kpi_card(sheet, "C7", "Invested Value", format_currency(invested), PALETTE["steel"])
    write_kpi_card(sheet, "E7", "All-time P&L", format_currency(pnl), pnl_color)
    write_kpi_card(sheet, "G7", "All-time Return", format_pct(ret), pnl_color)

    strongest = max(report["holdings"], key=lambda item: item["returnPct"])
    weakest = min(report["holdings"], key=lambda item: item["returnPct"])
    largest = max(report["holdings"], key=lambda item: item["portfolioWeight"])

    sheet["J7"] = "Immediate Read"
    sheet["J7"].font = Font(name="Aptos", size=11, bold=True, color=PALETTE["navy"])
    insight_cards = [
        ("Largest Position", f"{largest['symbol']}  {format_pct(largest['portfolioWeight'])}", PALETTE["steel"]),
        ("Strongest Winner", f"{strongest['symbol']}  {format_pct(strongest['returnPct'])}", PALETTE["green"]),
        ("Weakest Return", f"{weakest['symbol']}  {format_pct(weakest['returnPct'])}", PALETTE["red"]),
        ("Bullish vs Cautious", f"{summary['sentimentCounts']['bullish']} / {summary['sentimentCounts']['cautious']}", PALETTE["amber"]),
    ]
    row = 8
    for title, value, color in insight_cards:
        sheet.merge_cells(start_row=row, start_column=10, end_row=row, end_column=11)
        sheet.merge_cells(start_row=row + 1, start_column=10, end_row=row + 1, end_column=11)
        t = sheet.cell(row=row, column=10)
        v = sheet.cell(row=row + 1, column=10)
        t.value = title
        v.value = value
        t.font = Font(name="Aptos", size=9, bold=True, color=PALETTE["muted"])
        v.font = Font(name="Aptos Display", size=12, bold=True, color=color)
        t.fill = PatternFill("solid", fgColor=PALETTE["cream"])
        v.fill = PatternFill("solid", fgColor=PALETTE["white"])
        t.border = THIN_BORDER
        v.border = THIN_BORDER
        row += 3

    sheet["A12"] = "Executive Notes"
    sheet["A12"].font = Font(name="Aptos", size=11, bold=True, color=PALETTE["navy"])
    for idx, note in enumerate(summary.get("notes", []), start=13):
        sheet.merge_cells(start_row=idx, start_column=1, end_row=idx, end_column=8)
        cell = sheet.cell(row=idx, column=1)
        cell.value = f"- {note}"
        cell.font = Font(name="Aptos", size=10, color=PALETTE["ink"])
        cell.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)

    start_row = 18
    sheet[f"A{start_row}"] = "Portfolio Snapshot"
    sheet[f"A{start_row}"].font = Font(name="Aptos", size=11, bold=True, color=PALETTE["navy"])
    headers = ["Symbol", "Weight %", "Current Value", "All-time P&L", "Return %", "Sentiment", "Broker Coverage", "Consensus Mix"]
    header_row = start_row + 1
    for i, header in enumerate(headers, start=1):
        sheet.cell(row=header_row, column=i, value=header)
    style_header_row(sheet, header_row, PALETTE["steel"])

    holdings = sorted(report["holdings"], key=lambda item: item["currentValue"], reverse=True)
    for offset, holding in enumerate(holdings, start=1):
        r = header_row + offset
        bc = holding.get("brokerageConsensus", {})
        values = [
            holding["symbol"],
            round(holding["portfolioWeight"], 2),
            format_currency(holding["currentValue"]),
            format_currency(holding["pnl"]),
            round(holding["returnPct"], 2),
            holding["summary"]["sentiment"].title(),
            bc.get("scannedCount", 0),
            f"B {bc.get('buy',0)} / H {bc.get('hold',0)} / S {bc.get('sell',0)}",
        ]
        for i, value in enumerate(values, start=1):
            sheet.cell(row=r, column=i, value=value)
        sheet.cell(row=r, column=5).fill = heat_fill(holding["returnPct"])
        sheet.cell(row=r, column=6).fill = sentiment_fill(holding["summary"]["sentiment"])
        sheet.cell(row=r, column=4).font = Font(
            name="Aptos",
            size=10,
            bold=True,
            color=PALETTE["green"] if holding["pnl"] >= 0 else PALETTE["red"],
        )

    end_row = header_row + len(holdings)
    style_body_range(sheet, header_row + 1, end_row, left_cols={1, 8})
    set_widths(sheet, {"A": 16, "B": 12, "C": 18, "D": 18, "E": 12, "F": 12, "G": 14, "H": 22, "I": 4, "J": 4})


def add_heatmap_sheet(workbook, report):
    sheet = workbook.create_sheet("Heatmap")
    apply_cover(
        sheet,
        "Portfolio Heatmap",
        "A quick visual scan of exposure, return, P&L, sentiment, and broker coverage across the full portfolio.",
        report["generatedAt"],
    )
    headers = ["Symbol", "Weight %", "Return %", "All-time P&L", "Broker Coverage", "Buy", "Hold", "Sell", "Sentiment"]
    row = 7
    for i, header in enumerate(headers, start=1):
        sheet.cell(row=row, column=i, value=header)
    style_header_row(sheet, row, PALETTE["steel"])
    holdings = sorted(report["holdings"], key=lambda item: item["portfolioWeight"], reverse=True)
    for offset, holding in enumerate(holdings, start=1):
        r = row + offset
        bc = holding.get("brokerageConsensus", {})
        vals = [
            holding["symbol"],
            round(holding["portfolioWeight"], 2),
            round(holding["returnPct"], 2),
            format_currency(holding["pnl"]),
            bc.get("scannedCount", 0),
            bc.get("buy", 0),
            bc.get("hold", 0),
            bc.get("sell", 0),
            holding["summary"]["sentiment"].title(),
        ]
        for i, value in enumerate(vals, start=1):
            sheet.cell(row=r, column=i, value=value)
        sheet.cell(row=r, column=2).fill = heat_fill(holding["portfolioWeight"] - 20)
        sheet.cell(row=r, column=3).fill = heat_fill(holding["returnPct"])
        sheet.cell(row=r, column=4).fill = heat_fill(holding["returnPct"])
        sheet.cell(row=r, column=9).fill = sentiment_fill(holding["summary"]["sentiment"])
        for c in (5, 6, 7, 8):
            sheet.cell(row=r, column=c).fill = PatternFill("solid", fgColor=PALETTE["cream"])
    style_body_range(sheet, row + 1, row + len(holdings), left_cols={1, 9})
    set_widths(sheet, {"A": 16, "B": 12, "C": 12, "D": 16, "E": 14, "F": 8, "G": 8, "H": 8, "I": 14})
    sheet.freeze_panes = "A8"


def add_holdings_sheet(workbook, report):
    sheet = workbook.create_sheet("Holdings")
    apply_cover(
        sheet,
        "Holdings Detail",
        "Ground-truth holding values directly from the Zerodha snapshot, organized for quick review and sorting.",
        report["generatedAt"],
    )
    headers = [
        "Exchange", "Symbol", "Company", "ISIN", "Qty", "Buy Avg", "Last Price",
        "Invested Value", "Current Value", "All-time P&L", "Return %", "Weight %",
        "Day Move %", "Sentiment", "Broker Coverage",
    ]
    row = 7
    for i, header in enumerate(headers, start=1):
        sheet.cell(row=row, column=i, value=header)
    style_header_row(sheet, row, PALETTE["navy"])
    for offset, holding in enumerate(report["holdings"], start=1):
        r = row + offset
        vals = [
            holding["exchange"], holding["symbol"], holding["companyName"], holding.get("isin") or "",
            holding["quantity"], holding["averagePrice"], holding["lastPrice"], holding["investedValue"],
            holding["currentValue"], holding["pnl"], holding["returnPct"], holding["portfolioWeight"],
            holding["weeklyChangePct"], holding["summary"]["sentiment"].title(),
            holding.get("brokerageConsensus", {}).get("scannedCount", 0),
        ]
        for i, value in enumerate(vals, start=1):
            sheet.cell(row=r, column=i, value=value)
        sheet.cell(row=r, column=10).font = Font(
            name="Aptos",
            size=10,
            bold=True,
            color=PALETTE["green"] if holding["pnl"] >= 0 else PALETTE["red"],
        )
        sheet.cell(row=r, column=11).fill = heat_fill(holding["returnPct"])
        sheet.cell(row=r, column=14).fill = sentiment_fill(holding["summary"]["sentiment"])
    style_body_range(sheet, row + 1, row + len(report["holdings"]), left_cols={1, 2, 3, 4, 14})
    set_widths(sheet, {"A": 10, "B": 14, "C": 22, "D": 18, "E": 8, "F": 12, "G": 12, "H": 14, "I": 14, "J": 14, "K": 12, "L": 12, "M": 12, "N": 12, "O": 14})
    sheet.freeze_panes = "A8"


def add_stock_summary_sheet(workbook, report):
    sheet = workbook.create_sheet("Stock Summaries")
    apply_cover(
        sheet,
        "Narrative Summary",
        "Immediately consumable insights, reasons, watchpoints, and transparent broker consensus notes for each holding.",
        report["generatedAt"],
    )
    headers = ["Symbol", "Sentiment", "Brokerage Consensus", "Why It May Be Moving", "Key Developments", "Watchpoints", "Immediate Read"]
    row = 7
    for i, header in enumerate(headers, start=1):
        sheet.cell(row=row, column=i, value=header)
    style_header_row(sheet, row, PALETTE["steel"])
    for offset, holding in enumerate(report["holdings"], start=1):
        r = row + offset
        bc = holding.get("brokerageConsensus", {})
        consensus = (
            f"Of the {bc.get('scannedCount',0)} brokerage recommendation items scanned, "
            f"{bc.get('buy',0)} advise buy, {bc.get('hold',0)} advise hold, and "
            f"{bc.get('sell',0)} advise sell. {bc.get('coverageNote','')}"
        )
        immediate = (
            f"All-time return is {format_pct(holding['returnPct'])}. "
            f"Portfolio weight is {format_pct(holding['portfolioWeight'])}. "
            f"Confidence is {holding['summary']['confidence']}."
        )
        vals = [
            holding["symbol"],
            holding["summary"]["sentiment"].title(),
            sentence_bullets(consensus),
            sentence_bullets(holding["summary"]["whyMoving"]),
            bullet_join(holding["summary"]["keyDevelopments"]),
            bullet_join(holding["summary"]["watchpoints"]),
            sentence_bullets(immediate),
        ]
        for i, value in enumerate(vals, start=1):
            sheet.cell(row=r, column=i, value=value)
        sheet.cell(row=r, column=2).fill = sentiment_fill(holding["summary"]["sentiment"])
        line_count = max(str(value).count("\n") + 1 for value in vals[2:])
        sheet.row_dimensions[r].height = max(36, min(18 + line_count * 14, 132))
    style_body_range(sheet, row + 1, row + len(report["holdings"]), left_cols={1, 3, 4, 5, 6, 7})
    set_widths(sheet, {"A": 14, "B": 12, "C": 44, "D": 40, "E": 38, "F": 32, "G": 24})
    sheet.freeze_panes = "A8"


def add_sources_sheet(workbook, report):
    sheet = workbook.create_sheet("Sources")
    apply_cover(
        sheet,
        "Evidence & Sources",
        "All surfaced evidence and brokerage links reviewed for this portfolio brief.",
        report["generatedAt"],
    )
    headers = ["Symbol", "Category", "Title", "Source", "Published At", "URL"]
    row = 7
    for i, header in enumerate(headers, start=1):
        sheet.cell(row=row, column=i, value=header)
    style_header_row(sheet, row, PALETTE["steel"])
    r = row + 1
    for holding in report["holdings"]:
        for item in holding.get("evidence", []):
            vals = [holding["symbol"], item.get("category", ""), item.get("title", ""), item.get("source", ""), item.get("publishedAt", ""), item.get("url", "")]
            for i, value in enumerate(vals, start=1):
                sheet.cell(row=r, column=i, value=value)
            r += 1
        for item in holding.get("brokerageConsensus", {}).get("items", []):
            vals = [holding["symbol"], "brokerage_consensus", item.get("title", ""), item.get("broker", "") or item.get("source", ""), item.get("publishedAt", ""), item.get("url", "")]
            for i, value in enumerate(vals, start=1):
                sheet.cell(row=r, column=i, value=value)
            r += 1
    if r > row + 1:
        style_body_range(sheet, row + 1, r - 1, left_cols={1, 2, 3, 4, 5, 6})
    set_widths(sheet, {"A": 12, "B": 18, "C": 44, "D": 22, "E": 14, "F": 50})
    sheet.freeze_panes = "A8"


def build_workbook(report, output_dir):
    workbook = Workbook()
    add_dashboard(workbook, report)
    add_heatmap_sheet(workbook, report)
    add_holdings_sheet(workbook, report)
    add_stock_summary_sheet(workbook, report)
    add_sources_sheet(workbook, report)
    for sheet in workbook.worksheets:
        autosize_with_cap(sheet)
    file_path = os.path.join(output_dir, "weekly_report.xlsx")
    workbook.save(file_path)
    return file_path


def pdf_styles():
    styles = getSampleStyleSheet()
    return {
        "kicker": ParagraphStyle("Kicker", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=11, textColor=colors.HexColor("#355C7D"), spaceAfter=6),
        "title": ParagraphStyle("Title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=27, leading=31, textColor=colors.HexColor("#14263D"), alignment=TA_LEFT, spaceAfter=8),
        "subtitle": ParagraphStyle("Subtitle", parent=styles["Normal"], fontName="Helvetica", fontSize=11, leading=15, textColor=colors.HexColor("#667085"), spaceAfter=14),
        "heading": ParagraphStyle("Heading", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=14, leading=18, textColor=colors.HexColor("#14263D"), spaceBefore=10, spaceAfter=6),
        "section_label": ParagraphStyle("SectionLabel", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8.5, leading=10, textColor=colors.HexColor("#355C7D"), spaceAfter=4),
        "body": ParagraphStyle("Body", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.7, leading=14, textColor=colors.HexColor("#1F2933"), spaceAfter=6),
        "muted": ParagraphStyle("Muted", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.5, leading=12, textColor=colors.HexColor("#667085"), spaceAfter=4),
        "summary": ParagraphStyle("Summary", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=colors.HexColor("#14263D"), spaceAfter=6),
        "hero_value": ParagraphStyle("HeroValue", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=17, leading=19, textColor=colors.white, spaceAfter=2),
        "hero_label": ParagraphStyle("HeroLabel", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.5, leading=10, textColor=colors.HexColor("#D7E4F1"), spaceAfter=0),
        "card_body": ParagraphStyle("CardBody", parent=styles["BodyText"], fontName="Helvetica", fontSize=9, leading=12.5, textColor=colors.HexColor("#1F2933"), spaceAfter=0),
        "stock_title": ParagraphStyle("StockTitle", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=colors.HexColor("#14263D"), spaceAfter=2),
        "stock_meta": ParagraphStyle("StockMeta", parent=styles["BodyText"], fontName="Helvetica", fontSize=9, leading=12, textColor=colors.HexColor("#667085"), spaceAfter=0),
    }


def mini_kpi_table(report, styles):
    invested = report["summary"].get("totalInvested") or sum(h["investedValue"] for h in report["holdings"])
    pnl = report["summary"]["totalPnl"]
    ret = 0 if not invested else (pnl / invested) * 100
    data = [[
        Paragraph("<b>Invested</b><br/>" + format_currency(invested), styles["body"]),
        Paragraph("<b>Current Value</b><br/>" + format_currency(report["summary"]["totalValue"]), styles["body"]),
        Paragraph("<b>All-time P&L</b><br/>" + format_currency(pnl), styles["body"]),
        Paragraph("<b>Return</b><br/>" + format_pct(ret), styles["body"]),
    ]]
    table = Table(data, colWidths=[4.15 * cm] * 4)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8F5EF")),
        ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#ECE6DC")),
        ("INNERGRID", (0, 0), (-1, -1), 0.7, colors.HexColor("#ECE6DC")),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


def cover_insight_table(report, styles):
    strongest = max(report["holdings"], key=lambda item: item["returnPct"])
    weakest = min(report["holdings"], key=lambda item: item["returnPct"])
    largest = max(report["holdings"], key=lambda item: item["portfolioWeight"])
    data = [
        ["Largest position", f"{largest['symbol']} at {format_pct(largest['portfolioWeight'])} of portfolio"],
        ["Best all-time return", f"{strongest['symbol']} at {format_pct(strongest['returnPct'])}"],
        ["Weakest all-time return", f"{weakest['symbol']} at {format_pct(weakest['returnPct'])}"],
    ]
    table = Table(data, colWidths=[4.1 * cm, 11.2 * cm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#ECE6DC")),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#ECE6DC")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#355C7D")),
    ]))
    return table


def top_holdings_table(report):
    holdings = sorted(report["holdings"], key=lambda item: item["portfolioWeight"], reverse=True)
    rows = [["Symbol", "Weight %", "Return %", "Sentiment"]]
    for holding in holdings:
        rows.append([
            holding["symbol"],
            format_pct(holding["portfolioWeight"]),
            format_pct(holding["returnPct"]),
            holding["summary"]["sentiment"].title(),
        ])
    table = Table(rows, colWidths=[4.0 * cm, 3.1 * cm, 3.1 * cm, 4.2 * cm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#14263D")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#ECE6DC")),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#ECE6DC")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def stock_card_table(holding):
    bc = holding.get("brokerageConsensus", {})
    left = [
        ["Original buy price", format_currency(holding["averagePrice"])],
        ["Current price", format_currency(holding["lastPrice"])],
        ["Quantity", str(holding["quantity"])],
        ["Current value", format_currency(holding["currentValue"])],
        ["All-time P&L", format_currency(holding["pnl"])],
        ["All-time return", format_pct(holding["returnPct"])],
    ]
    right = [
        ["Sentiment", holding["summary"]["sentiment"].title()],
        ["Portfolio weight", format_pct(holding["portfolioWeight"])],
        ["Snapshot day move", format_pct(holding["weeklyChangePct"])],
        ["Broker coverage", str(bc.get("scannedCount", 0))],
        ["Consensus", f"Buy {bc.get('buy',0)} / Hold {bc.get('hold',0)} / Sell {bc.get('sell',0)}"],
        ["Weekly trades", str((holding.get("weeklyActivity") or {}).get("tradesCount", 0))],
    ]
    rows = [["Metric", "Value", "Metric", "Value"]] + [[a, b, c, d] for (a, b), (c, d) in zip(left, right)]
    table = Table(rows, colWidths=[3.5 * cm, 3.9 * cm, 3.5 * cm, 4.2 * cm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#14263D")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#ECE6DC")),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#ECE6DC")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return table


def executive_summary_points(report):
    holdings = report["holdings"]
    biggest = max(holdings, key=lambda item: item["portfolioWeight"])
    strongest = max(holdings, key=lambda item: item["returnPct"])
    weakest = min(holdings, key=lambda item: item["returnPct"])
    summary = report["summary"]["sentimentCounts"]
    invested = report["summary"].get("totalInvested") or sum(h["investedValue"] for h in holdings)
    total_return = 0 if not invested else (report["summary"]["totalPnl"] / invested) * 100
    return [
        f"The portfolio is up {format_currency(report['summary']['totalPnl'])} all-time, with {format_pct(total_return)} total return.",
        f"{biggest['symbol']} is now the dominant position at {format_pct(biggest['portfolioWeight'])} of portfolio value, so its future moves will have outsized impact.",
        f"{strongest['symbol']} remains the strongest winner at {format_pct(strongest['returnPct'])}, while {weakest['symbol']} is the weakest all-time return at {format_pct(weakest['returnPct'])}.",
        f"Current stance mix is {summary['bullish']} bullish, {summary['neutral']} neutral, and {summary['cautious']} cautious names based on this report.",
    ]


def action_points(report):
    holdings = report["holdings"]
    largest = max(holdings, key=lambda item: item["portfolioWeight"])
    weakest_cautious = sorted(
        [item for item in holdings if item["summary"]["sentiment"] == "cautious"],
        key=lambda item: item["portfolioWeight"],
        reverse=True,
    )
    weakest = min(holdings, key=lambda item: item["returnPct"])
    bullish = [h for h in holdings if h["summary"]["sentiment"] == "bullish"]
    points = [
        f"Anchor attention on {largest['symbol']} first because it represents the largest portfolio weight at {format_pct(largest['portfolioWeight'])}.",
        f"Revisit the original thesis for {weakest['symbol']} because it has the deepest all-time drawdown at {format_pct(weakest['returnPct'])}.",
    ]
    if bullish:
        points.append(f"Protect the strongest winner, {bullish[0]['symbol']}, and confirm that its positive operating momentum still supports the current gain.")
    if weakest_cautious:
        points.append(f"Most pressured names needing scrutiny are {', '.join(item['symbol'] for item in weakest_cautious[:3])}.")
    points.append("Treat broker-consensus counts carefully when coverage is limited; some Indian mid-cap names in this report have incomplete public research visibility.")
    return points


def sentiment_color(sentiment):
    sentiment = (sentiment or "").lower()
    if sentiment == "bullish":
        return colors.HexColor("#216E39")
    if sentiment == "cautious":
        return colors.HexColor("#A63D40")
    return colors.HexColor("#A46C1F")


def hero_banner(report, styles):
    invested = report["summary"].get("totalInvested") or sum(h["investedValue"] for h in report["holdings"])
    pnl = report["summary"]["totalPnl"]
    ret = 0 if not invested else (pnl / invested) * 100
    data = [
        [Paragraph("Weekly Portfolio Brief", styles["title"]), ""],
        [
            Paragraph(
                "Built from a real Zerodha holdings snapshot and then consolidated with public company filings, broker commentary, and explicit evidence gaps.",
                styles["subtitle"],
            ),
            Paragraph(
                f"<font size='9' color='#D7E4F1'>Generated</font><br/><font size='12'><b>{report['generatedAt'][:10]}</b></font>",
                styles["body"],
            ),
        ],
        [Paragraph(format_currency(report["summary"]["totalValue"]), styles["hero_value"]), Paragraph(format_currency(pnl), styles["hero_value"])],
        [Paragraph("Current portfolio value", styles["hero_label"]), Paragraph("All-time portfolio P&L", styles["hero_label"])],
        [Paragraph(format_pct(ret), styles["hero_value"]), Paragraph(str(report["summary"]["holdingsCount"]), styles["hero_value"])],
        [Paragraph("All-time portfolio return", styles["hero_label"]), Paragraph("Equity holdings covered", styles["hero_label"])],
    ]
    table = Table(data, colWidths=[11.6 * cm, 5.0 * cm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#14263D")),
        ("SPAN", (0, 0), (1, 0)),
        ("LINEBELOW", (0, 1), (1, 1), 0.5, colors.HexColor("#355C7D")),
        ("LINEABOVE", (0, 2), (1, 2), 0.5, colors.HexColor("#355C7D")),
        ("LINEABOVE", (0, 4), (1, 4), 0.5, colors.HexColor("#355C7D")),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return table


def insight_cards(title, items, styles):
    rows = [[Paragraph(title, styles["heading"])]]
    for item in items:
        rows.append([Paragraph(f"• {item}", styles["body"])])
    table = Table(rows, colWidths=[16.6 * cm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F8F5EF")),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#ECE6DC")),
        ("INNERGRID", (0, 1), (-1, -1), 0.3, colors.HexColor("#F1ECE4")),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


def stock_header_table(holding, styles):
    sentiment = holding["summary"]["sentiment"].title()
    data = [
        [Paragraph(holding["symbol"], styles["stock_title"]), Paragraph(f"<b>{sentiment}</b>", styles["stock_title"])],
        [
            Paragraph(
                f"{holding['exchange']}  |  Qty {holding['quantity']}  |  Buy avg {format_currency(holding['averagePrice'])}  |  Current {format_currency(holding['lastPrice'])}",
                styles["stock_meta"],
            ),
            Paragraph(
                f"Confidence {holding['summary']['confidence'].title()}  |  Weight {format_pct(holding['portfolioWeight'])}",
                styles["stock_meta"],
            ),
        ],
    ]
    table = Table(data, colWidths=[11.6 * cm, 5.0 * cm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8F5EF")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#ECE6DC")),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("ALIGN", (1, 0), (1, 1), "RIGHT"),
        ("TEXTCOLOR", (1, 0), (1, 0), sentiment_color(sentiment)),
    ]))
    return table


def narrative_box(label, text, styles, fill):
    table = Table(
        [[Paragraph(label.upper(), styles["section_label"])], [Paragraph(text, styles["card_body"])]],
        colWidths=[8.05 * cm],
    )
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(f"#{fill}")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#ECE6DC")),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


def dual_narrative_row(left_label, left_text, right_label, right_text, styles):
    table = Table(
        [[
            narrative_box(left_label, left_text, styles, "FFFFFF"),
            narrative_box(right_label, right_text, styles, "F8F5EF"),
        ]],
        colWidths=[8.1 * cm, 8.1 * cm],
    )
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return table


def source_table(holding):
    rows = [["Source", "Reference reviewed"]]
    for item in holding["summary"]["citations"][:4]:
        rows.append([item["source"], item["title"]])
    if len(rows) == 1:
        rows.append(["None", "No source citations captured."])
    table = Table(rows, colWidths=[4.2 * cm, 12.0 * cm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#14263D")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#ECE6DC")),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#F1ECE4")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def build_pdf(report, output_dir):
    file_path = os.path.join(output_dir, "weekly_report.pdf")
    styles = pdf_styles()
    doc = SimpleDocTemplate(
        file_path,
        pagesize=A4,
        rightMargin=1.4 * cm,
        leftMargin=1.4 * cm,
        topMargin=1.2 * cm,
        bottomMargin=1.2 * cm,
    )
    story = [
        hero_banner(report, styles),
        Spacer(1, 0.3 * cm),
        insight_cards("Executive Summary", executive_summary_points(report), styles),
        Spacer(1, 0.22 * cm),
        insight_cards("Immediate Action Points", action_points(report), styles),
        Spacer(1, 0.22 * cm),
        Paragraph("Portfolio Shape", styles["heading"]),
        cover_insight_table(report, styles),
        Spacer(1, 0.22 * cm),
        mini_kpi_table(report, styles),
        Spacer(1, 0.22 * cm),
        Paragraph("Portfolio Weight Snapshot", styles["heading"]),
        top_holdings_table(report),
    ]
    for note in report["summary"].get("notes", []):
        story.append(Paragraph(note, styles["muted"]))
    story.append(PageBreak())

    for index, holding in enumerate(report["holdings"]):
        bc = holding.get("brokerageConsensus", {})
        consensus_text = (
            f"Of the {bc.get('scannedCount',0)} brokerage recommendation items scanned, "
            f"{bc.get('buy',0)} advise buy, {bc.get('hold',0)} advise hold, and "
            f"{bc.get('sell',0)} advise sell. {bc.get('coverageNote','')}"
        )
        story.extend([
            stock_header_table(holding, styles),
            Spacer(1, 0.18 * cm),
            stock_card_table(holding),
            Spacer(1, 0.18 * cm),
            dual_narrative_row("Immediate read", holding["summary"]["rationale"], "Why it may be moving", holding["summary"]["whyMoving"], styles),
            Spacer(1, 0.18 * cm),
            dual_narrative_row("Brokerage consensus", consensus_text, "Coverage note", bc.get("coverageNote", "Coverage quality was not explicitly flagged."), styles),
            Spacer(1, 0.18 * cm),
            dual_narrative_row("Key developments", bullet_lines(holding["summary"]["keyDevelopments"]), "Watchpoints", bullet_lines(holding["summary"]["watchpoints"]), styles),
            Spacer(1, 0.18 * cm),
            dual_narrative_row(
                "Missing evidence",
                bullet_lines(holding["summary"]["missingEvidence"]),
                "Sentiment signal",
                f"The holding screens as <b>{holding['summary']['sentiment']}</b> with <b>{holding['summary']['confidence']}</b> confidence based on the evidence captured in this run.",
                styles,
            ),
            Spacer(1, 0.18 * cm),
            Paragraph("Sources Reviewed", styles["heading"]),
            source_table(holding),
        ])
        if index != len(report["holdings"]) - 1:
            story.append(PageBreak())

    doc.build(story)
    return file_path


def main():
    report_json_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    include_pdf = sys.argv[3] == "1"
    report = json.loads(report_json_path.read_text(encoding="utf-8"))
    build_workbook(report, str(output_dir))
    if include_pdf:
        build_pdf(report, str(output_dir))
    print("ok")


if __name__ == "__main__":
    main()
