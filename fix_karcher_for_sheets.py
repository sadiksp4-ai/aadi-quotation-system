import openpyxl
from openpyxl.drawing.spreadsheet_drawing import TwoCellAnchor, AnchorMarker
import re

input_file = "Aadi_Enterprises_Karcher_Product_Master_Complete_With_Images_Q.xlsx"
output_file = "Karcher_Master_GoogleSheets_Ready.xlsx"

print(f"1. Loading '{input_file}'...")
wb = openpyxl.load_workbook(input_file)
ws = wb["Product Import Sheet"]

# Column Q is column index 17 (1-based), so 0-based index is 16
COL_Q_INDEX_0 = 16
ws.column_dimensions['Q'].width = 18

print("2. Converting 118 Kärcher images to cell-locked TwoCellAnchors...")
converted_count = 0

for img in ws._images:
    row_idx = None

    if hasattr(img, 'anchor'):
        if hasattr(img.anchor, '_from'):
            row_idx = img.anchor._from.row
        elif isinstance(img.anchor, str):
            digits = re.findall(r'\d+', img.anchor)
            if digits:
                row_idx = int(digits[0]) - 1

    if row_idx is not None:
        ws.row_dimensions[row_idx + 1].height = 65

        # Centering offsets (in EMUs)
        col_offset = 95250   # ~10px padding
        row_offset = 47625   # ~5px padding

        _from = AnchorMarker(col=COL_Q_INDEX_0, colOff=col_offset, row=row_idx, rowOff=row_offset)
        _to = AnchorMarker(col=COL_Q_INDEX_0 + 1, colOff=-col_offset, row=row_idx + 1, rowOff=-row_offset)

        img.anchor = TwoCellAnchor(editAs="twoCell", _from=_from, to=_to)
        converted_count += 1

print(f"3. Locked {converted_count} images to Column Q cells.")
wb.save(output_file)
print(f"Saved: '{output_file}'. Ready for Google Sheets import!")