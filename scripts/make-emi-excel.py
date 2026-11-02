"""Builds the free MathMyLoan EMI calculator workbook (assets/downloads/mathmyloan-emi-calculator.xlsx).

Run: python scripts/make-emi-excel.py
Everything except the yellow input cells is a formula, so the sheet updates as you type.
"""
from pathlib import Path

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

OUT = Path(__file__).resolve().parent.parent / "assets" / "downloads" / "mathmyloan-emi-calculator.xlsx"
MONTHS = 360  # 30 years
FIRST = 17  # first schedule row
LAST = FIRST + MONTHS - 1

FONT = "Arial"
BLUE = Font(name=FONT, color="0000FF", bold=True)
BODY = Font(name=FONT)
BOLD = Font(name=FONT, bold=True)
WHITE_BOLD = Font(name=FONT, bold=True, color="FFFFFF")
YELLOW = PatternFill("solid", fgColor="FFFF00")
HEAD = PatternFill("solid", fgColor="2563EB")
SOFT = PatternFill("solid", fgColor="EFF6FF")
THIN = Side(style="thin", color="D0D7E2")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
# Indian digit grouping: ₹1,23,45,678
RUPEES = '[>=10000000]"₹"##\\,##\\,##\\,##0;[>=100000]"₹"##\\,##\\,##0;"₹"##,##0'

wb = Workbook()
ws = wb.active
ws.title = "EMI Calculator"

ws["A1"] = "MathMyLoan EMI Calculator"
ws["A1"].font = Font(name=FONT, bold=True, size=16, color="1D4ED8")
ws["A2"] = "Type in the yellow cells. Everything else updates automatically. Free from mathmyloan.com"
ws["A2"].font = Font(name=FONT, italic=True, color="475569")

inputs = [
    (4, "Loan amount (₹)", 5000000, RUPEES, "Example: ₹50 lakh. Enter your own amount."),
    (5, "Interest rate (% per year)", 0.085, "0.00%", "Example: 8.5%. Use the rate your bank offers you."),
    (6, "Tenure (years, up to 30)", 20, "0", "Example: 20 years. The schedule covers up to 30 years."),
    (7, "Extra payment every month (₹)", 0, RUPEES, "Optional. Any amount you plan to prepay each month."),
]
ws["A3"] = "Inputs"
ws["A3"].font = BOLD
for row, label, value, fmt, note in inputs:
    ws.cell(row=row, column=1, value=label).font = BODY
    c = ws.cell(row=row, column=2, value=value)
    c.font, c.fill, c.number_format, c.border = BLUE, YELLOW, fmt, BOX
    c.comment = Comment(note, "MathMyLoan")

ws["A9"] = "Results"
ws["A9"].font = BOLD
results = [
    (10, "Monthly EMI (₹)", "=IF(B5=0,B4/(B6*12),PMT(B5/12,B6*12,-B4))", RUPEES),
    (11, "Total interest (₹)", f"=SUM(C{FIRST}:C{LAST})", RUPEES),
    (12, "Total payment (₹)", "=B4+B11", RUPEES),
    (13, "Loan closes after (months)", f'=COUNTIF(B{FIRST}:B{LAST},">0.5")', "0"),
    (14, "Interest saved by extra payments (₹)", "=MAX(0,B10*B6*12-B4-B11)", RUPEES),
]
for row, label, formula, fmt in results:
    ws.cell(row=row, column=1, value=label).font = BODY
    c = ws.cell(row=row, column=2, value=formula)
    c.font, c.number_format, c.border, c.fill = BOLD, fmt, BOX, SOFT

headers = ["Month", "Opening balance (₹)", "Interest (₹)", "EMI paid (₹)", "Extra payment (₹)", "Principal repaid (₹)", "Closing balance (₹)"]
for col, text in enumerate(headers, start=1):
    c = ws.cell(row=FIRST - 1, column=col, value=text)
    c.font, c.fill, c.alignment, c.border = WHITE_BOLD, HEAD, Alignment(horizontal="center", wrap_text=True), BOX

for r in range(FIRST, LAST + 1):
    ws.cell(row=r, column=1, value=1 if r == FIRST else f"=A{r - 1}+1")
    ws.cell(row=r, column=2, value="=$B$4" if r == FIRST else f"=G{r - 1}")
    ws.cell(row=r, column=3, value=f"=IF(B{r}<=0,0,B{r}*$B$5/12)")
    ws.cell(row=r, column=4, value=f"=IF(B{r}<=0,0,MIN($B$10,B{r}+C{r}))")
    ws.cell(row=r, column=5, value=f"=IF(B{r}<=0,0,MIN($B$7,B{r}+C{r}-D{r}))")
    ws.cell(row=r, column=6, value=f"=D{r}+E{r}-C{r}")
    ws.cell(row=r, column=7, value=f"=MAX(0,B{r}-F{r})")
    for col in range(1, 8):
        c = ws.cell(row=r, column=col)
        c.font = BODY
        c.number_format = "0" if col == 1 else RUPEES

for col, width in zip("ABCDEFG", [38, 20, 16, 16, 18, 20, 20]):
    ws.column_dimensions[col].width = width
ws.row_dimensions[FIRST - 1].height = 32
ws.freeze_panes = f"A{FIRST}"

guide = wb.create_sheet("How to use")
lines = [
    ("How to use this calculator", True),
    ("1. On the EMI Calculator tab, change the yellow cells: loan amount, interest rate, tenure and any extra monthly payment.", False),
    ("2. Your EMI, total interest and the month the loan closes update instantly.", False),
    ("3. The schedule below the results shows every month's interest, principal and remaining balance.", False),
    ("", False),
    ("The EMI formula", True),
    ("EMI = PMT(annual rate / 12, years x 12, -loan amount). Example: =PMT(8.5%/12, 240, -5000000).", False),
    ("Interest each month = opening balance x annual rate / 12. The rest of the EMI repays principal.", False),
    ("", False),
    ("Notes", True),
    ("The example values (₹50 lakh, 8.5%, 20 years) are only a sample. Use the rate your bank actually offers you.", False),
    ("This is an estimate on a reducing-balance basis, not a loan offer. Banks may round EMIs slightly differently.", False),
    ("Compare current bank rates and more calculators at https://mathmyloan.com", False),
]
for i, (text, bold) in enumerate(lines, start=1):
    c = guide.cell(row=i, column=1, value=text)
    c.font = BOLD if bold else BODY
guide.column_dimensions["A"].width = 120

OUT.parent.mkdir(parents=True, exist_ok=True)
wb.save(OUT)
print(f"wrote {OUT}")
