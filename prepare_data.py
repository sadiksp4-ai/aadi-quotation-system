import openpyxl
import pandas as pd
import json
import os
import re

output_img_dir = "public/images"
os.makedirs(output_img_dir, exist_ok=True)
all_products = []

def clean_val(v):
    if pd.isna(v) or v is None:
        return ""
    return str(v).strip()

# --- 1. PROCESS TRAMONTINA ---
tramontina_path = "../Tramontina/Tramontina_Visual_Quotation.xlsx"
if os.path.exists(tramontina_path):
    print("Processing Tramontina...")
    wb = openpyxl.load_workbook(tramontina_path)
    ws = wb["Tramontina Catalog"]

    # Extract row to SKU map
    row_sku_map = {}
    for r in range(8, 417):
        sku = clean_val(ws.cell(row=r, column=3).value)
        if sku:
            clean_sku = sku[:-2] if sku.endswith(".0") else sku
            row_sku_map[r] = clean_sku

            desc = clean_val(ws.cell(row=r, column=4).value)
            cat = clean_val(ws.cell(row=r, column=2).value)
            mrp = ws.cell(row=r, column=10).value or 0
            hsn = clean_val(ws.cell(row=r, column=6).value)

            all_products.append({
                "brand": "Tramontina",
                "sku": clean_sku,
                "name": desc,
                "category": cat or "Cookware",
                "hsn": hsn,
                "gst": "5%",
                "mrp": float(mrp) if str(mrp).replace('.', '', 1).isdigit() else 0,
                "sellingPrice": float(mrp) if str(mrp).replace('.', '', 1).isdigit() else 0,
                "image": f"/images/{clean_sku}.png"
            })

    # Extract images from sheet
    for img in ws._images:
        row_idx = None
        if hasattr(img, 'anchor'):
            if hasattr(img.anchor, '_from'):
                row_idx = img.anchor._from.row + 1
            elif isinstance(img.anchor, str):
                nums = re.findall(r'\d+', img.anchor)
                if nums:
                    row_idx = int(nums[0])
        if row_idx in row_sku_map:
            sku = row_sku_map[row_idx]
            with open(f"{output_img_dir}/{sku}.png", "wb") as f:
                f.write(img._data())

# --- 2. PROCESS DOLPHY ---
dolphy_path = "../Dolphy/Dolphy_Visual_Catalog.xlsx"
if os.path.exists(dolphy_path):
    print("Processing Dolphy...")
    wb = openpyxl.load_workbook(dolphy_path)
    ws = wb["Dolphy"]

    row_sku_map = {}
    for r in range(5, ws.max_row + 1):
        sku = clean_val(ws.cell(row=r, column=2).value)
        if sku:
            clean_sku = sku[:-2] if sku.endswith(".0") else sku
            row_sku_map[r] = clean_sku

            name = clean_val(ws.cell(row=r, column=3).value)
            cat = clean_val(ws.cell(row=r, column=5).value)
            mrp = ws.cell(row=r, column=13).value or 0
            sp = ws.cell(row=r, column=12).value or mrp
            hsn = clean_val(ws.cell(row=r, column=8).value)

            all_products.append({
                "brand": "Dolphy",
                "sku": clean_sku,
                "name": name,
                "category": cat or "Hospitality Hardware",
                "hsn": hsn,
                "gst": "18%",
                "mrp": float(mrp) if str(mrp).replace('.', '', 1).isdigit() else 0,
                "sellingPrice": float(sp) if str(sp).replace('.', '', 1).isdigit() else 0,
                "image": f"/images/{clean_sku}.png"
            })

    for img in ws._images:
        row_idx = None
        if hasattr(img, 'anchor'):
            if hasattr(img.anchor, '_from'):
                row_idx = img.anchor._from.row + 1
            elif isinstance(img.anchor, str):
                nums = re.findall(r'\d+', img.anchor)
                if nums:
                    row_idx = int(nums[0])
        if row_idx in row_sku_map:
            sku = row_sku_map[row_idx]
            with open(f"{output_img_dir}/{sku}.png", "wb") as f:
                f.write(img._data())

# Save JSON
os.makedirs("src/data", exist_ok=True)
with open("src/data/products.json", "w", encoding="utf-8") as f:
    json.dump(all_products, f, indent=2)

print(f"Extraction complete! Indexed {len(all_products)} products into src/data/products.json")