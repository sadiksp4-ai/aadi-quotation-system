import openpyxl
import pandas as pd
import json
import os
import re

karcher_file = "Aadi_Enterprises_Karcher_Product_Master_Complete_With_Images_Q.xlsx"
# If the file is in Downloads root, adjust the path:
if not os.path.exists(karcher_file) and os.path.exists(f"../{karcher_file}"):
    karcher_file = f"../{karcher_file}"

output_img_dir = "public/images"
os.makedirs(output_img_dir, exist_ok=True)

print(f"1. Loading '{karcher_file}'...")
wb = openpyxl.load_workbook(karcher_file)
ws = wb["Product Import Sheet"]

# Map row numbers to SKUs
row_to_sku = {}
karcher_items = []

for r in range(2, ws.max_row + 1):
    sku = ws.cell(row=r, column=2).value
    name = ws.cell(row=r, column=3).value
    desc = ws.cell(row=r, column=4).value
    cat = ws.cell(row=r, column=5).value
    subcat = ws.cell(row=r, column=6).value
    unit = ws.cell(row=r, column=7).value
    hsn = ws.cell(row=r, column=8).value
    gst = ws.cell(row=r, column=9).value
    sp = ws.cell(row=r, column=12).value
    mrp = ws.cell(row=r, column=13).value

    if not sku:
        continue

    clean_sku = str(sku).strip()
    row_to_sku[r] = clean_sku

    karcher_items.append({
        "brand": "Kärcher",
        "sku": clean_sku,
        "name": str(name).strip() if name else "",
        "description": str(desc).strip() if desc else "",
        "category": str(cat).strip() if cat else "Cleaning Equipment",
        "subcategory": str(subcat).strip() if subcat else "",
        "unit": str(unit).strip() if unit else "Nos",
        "hsn": str(hsn).strip() if hsn else "84243000",
        "gst": f"{int(gst)}%" if gst else "18%",
        "mrp": float(mrp) if mrp else 0,
        "sellingPrice": float(sp) if sp else float(mrp or 0),
        "stock": "In Stock",
        "image": f"/images/{clean_sku}.png"
    })

print(f"Read {len(karcher_items)} Kärcher products.")

# 2. Extract embedded images by SKU
extracted_imgs = 0
for img in ws._images:
    r_idx = None
    if hasattr(img, 'anchor') and hasattr(img.anchor, '_from'):
        r_idx = img.anchor._from.row + 1
    elif isinstance(img.anchor, str):
        digits = re.findall(r'\d+', img.anchor)
        if digits:
            r_idx = int(digits[0])

    if r_idx in row_to_sku:
        sku = row_to_sku[r_idx]
        out_img_path = os.path.join(output_img_dir, f"{sku}.png")
        with open(out_img_path, "wb") as f:
            f.write(img._data())
        extracted_imgs += 1

print(f"2. Extracted {extracted_imgs} Kärcher product images into '{output_img_dir}'.")

# 3. Merge into src/data/products.json
json_path = "src/data/products.json"
existing_products = []
if os.path.exists(json_path):
    with open(json_path, "r", encoding="utf-8") as f:
        existing_products = json.load(f)

# Filter out old Kärcher entries if previously added to avoid duplicates
existing_products = [p for p in existing_products if p.get("brand") != "Kärcher"]
merged_products = existing_products + karcher_items

with open(json_path, "w", encoding="utf-8") as f:
    json.dump(merged_products, f, indent=2)

print(f"3. Successfully updated '{json_path}'.")
print(f"Total catalog count across all brands: {len(merged_products)} products!")