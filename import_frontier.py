import os
import json
from pypdf import PdfReader

pdf_filename = "Frontier Bin Price  List 2026 -27.pdf"
if not os.path.exists(pdf_filename) and os.path.exists(f"../{pdf_filename}"):
    pdf_filename = f"../{pdf_filename}"

img_dir = "public/images"
os.makedirs(img_dir, exist_ok=True)

print(f"1. Reading '{pdf_filename}'...")
reader = PdfReader(pdf_filename)

# Extract primary high-res product photo per page
page_images = {}
for p_idx, page in enumerate(reader.pages):
    best_img = None
    best_size = 0
    for img_obj in page.images:
        if img_obj.name.lower().endswith(('.jpg', '.jpeg', '.png')):
            if len(img_obj.data) > best_size and len(img_obj.data) > 30000:
                best_size = len(img_obj.data)
                best_img = img_obj
    if best_img:
        page_images[p_idx + 1] = best_img

# Catalog definitions from PDF
frontier_products = [
    # Page 2: Foot Operated Pedal Bins
    {"sku": "FLBN ROL 70", "name": "Frontier Foot Operated Pedal Bin 70L", "category": "Waste Management & Bins", "subcategory": "Foot Operated Pedal Bins", "price": 6769.0, "desc": "Frontier 70L Foot Operated Pedal Bin with Wheels & Moulded Handles. 582x420x790 mm. UV stable polymer.", "page": 2},
    {"sku": "FLBN ROL 90", "name": "Frontier Foot Operated Pedal Bin 90L", "category": "Waste Management & Bins", "subcategory": "Foot Operated Pedal Bins", "price": 7410.0, "desc": "Frontier 90L Foot Operated Pedal Bin with Wheels & Moulded Handles. 625x450x860 mm. UV stable polymer.", "page": 2},
    {"sku": "FLBN ROL 120", "name": "Frontier Foot Operated Pedal Bin 120L", "category": "Waste Management & Bins", "subcategory": "Foot Operated Pedal Bins", "price": 7936.0, "desc": "Frontier 120L Foot Operated Pedal Bin with Wheels & Moulded Handles. 685x490x935 mm. UV stable polymer.", "page": 2},
    {"sku": "FLBN ROL 240", "name": "Frontier Foot Operated Pedal Bin 240L", "category": "Waste Management & Bins", "subcategory": "Foot Operated Pedal Bins", "price": 11170.0, "desc": "Frontier 240L Foot Operated Pedal Bin with Heavy-Duty Wheels & Handles. 810x640x1040 mm. UV stable polymer.", "page": 2},
    # Page 3: Community Bin
    {"sku": "FLBCB-660", "name": "Frontier Community Bulk Waste Storage Bin 660L", "category": "Waste Management & Bins", "subcategory": "Community Bins", "price": 26850.0, "desc": "Frontier 660L (650L capacity) Bulk Waste Community Bin with 4 Wheels & Hygiene Lid. 1240x1000x1164 mm.", "page": 3},
    # Page 4: Material Handling Carts
    {"sku": "FLC-430", "name": "Frontier Multi Purpose Material Handling Cart 430L", "category": "Material Handling & Linen", "subcategory": "Laundry & Linen Carts", "price": 27483.0, "desc": "Frontier 430L Multi-Purpose Linen / Laundry / Material Handling Cart. 1270x800x690 mm (855 mm with trolley).", "page": 4},
    {"sku": "FLC-950", "name": "Frontier Multi Purpose Material Handling Cart 950L", "category": "Material Handling & Linen", "subcategory": "Laundry & Linen Carts", "price": 34720.0, "desc": "Frontier 950L Bulk Handling & Laundry Cart. 1675x1116x686 mm (920 mm with trolley).", "page": 4},
    # Page 5: Slim Bins
    {"sku": "FLB SLIM", "name": "Frontier Slim Bin 90L", "category": "Waste Management & Bins", "subcategory": "Slim Bins", "price": 4850.0, "desc": "Frontier 90L Space-Saving Slim Bin for pantries & kitchens. 584x304x765 mm.", "page": 5},
    # Page 6: Round Bins
    {"sku": "FLB 60", "name": "Frontier Round Commercial Waste Bin 60L", "category": "Waste Management & Bins", "subcategory": "Round Bins", "price": 3968.0, "desc": "Frontier 60L Heavy Duty Round Bin with Lid. Dia: 478 mm, H: 564 mm.", "page": 6},
    {"sku": "FLB 80", "name": "Frontier Round Commercial Waste Bin 80L", "category": "Waste Management & Bins", "subcategory": "Round Bins", "price": 4202.0, "desc": "Frontier 80L Heavy Duty Round Bin with Flat/Funnel Lid. Dia: 518 mm, H: 614 mm.", "page": 6},
    {"sku": "FLB 120", "name": "Frontier Round Commercial Waste Bin 120L", "category": "Waste Management & Bins", "subcategory": "Round Bins", "price": 4435.0, "desc": "Frontier 120L Commercial Round Bin. Dia: 605 mm, H: 696 mm.", "page": 6},
    # Page 7: Hooded Litter Bins
    {"sku": "FLB RET-30", "name": "Frontier Hooded Litter Bin 30L", "category": "Waste Management & Bins", "subcategory": "Hooded Litter Bins", "price": 1693.0, "desc": "Frontier 30L Hooded Litter Bin. W: 375 mm, H: 610 mm.", "page": 7},
    {"sku": "FLB RET-60", "name": "Frontier Hooded Litter Bin 60L", "category": "Waste Management & Bins", "subcategory": "Hooded Litter Bins", "price": 2100.0, "desc": "Frontier 60L Hooded Litter Bin. W: 424 mm, H: 885 mm.", "page": 7},
    {"sku": "FLB RET-100", "name": "Frontier Hooded Litter Bin 100L", "category": "Waste Management & Bins", "subcategory": "Hooded Litter Bins", "price": 3500.0, "desc": "Frontier 100L Hooded Litter Bin. W: 523 mm, H: 950 mm.", "page": 7},
    # Page 8: Drum Bin
    {"sku": "FLB100", "name": "Frontier Classic Drum Bin 100L", "category": "Waste Management & Bins", "subcategory": "Drum Bins", "price": 4300.0, "desc": "Frontier 100L Classic Drum Bin with Flat Lid. Dia: 430 mm, H: 750 mm.", "page": 8},
    # Page 9: NRB Lobby Bins
    {"sku": "FLBNRB60-STONE", "name": "Frontier NRB Bin 60L (Stone Finish)", "category": "Waste Management & Bins", "subcategory": "Premium Lobby & Public Bins", "price": 4500.0, "desc": "Frontier NRB Premium Lobby Bin with Stone Finish. 450x245x915 mm.", "page": 9},
    {"sku": "FLBNRB100-STONE", "name": "Frontier NRB Bin 100L (Stone Finish)", "category": "Waste Management & Bins", "subcategory": "Premium Lobby & Public Bins", "price": 4950.0, "desc": "Frontier NRB Premium Lobby Bin with Stone Finish. 505x370x930 mm.", "page": 9},
    {"sku": "FLBNRB60-SOLID", "name": "Frontier NRB Bin 60L (Solid Colour)", "category": "Waste Management & Bins", "subcategory": "Premium Lobby & Public Bins", "price": 3875.0, "desc": "Frontier NRB Solid Colour Lobby Bin. 450x245x915 mm.", "page": 9},
    {"sku": "FLBNRB100-SOLID", "name": "Frontier NRB Bin 100L (Solid Colour)", "category": "Waste Management & Bins", "subcategory": "Premium Lobby & Public Bins", "price": 4300.0, "desc": "Frontier NRB Solid Colour Lobby Bin. 505x370x930 mm.", "page": 9},
    # Page 10: Oval Public Bins
    {"sku": "FLBOVB60-STONE", "name": "Frontier Oval Bin 60L (Stone Finish)", "category": "Waste Management & Bins", "subcategory": "Premium Lobby & Public Bins", "price": 3910.0, "desc": "Frontier Oval Aesthetic Public Bin with Stone Finish. 310x410x716 mm.", "page": 10},
    {"sku": "FLBOVB90-STONE", "name": "Frontier Oval Bin 90L (Stone Finish)", "category": "Waste Management & Bins", "subcategory": "Premium Lobby & Public Bins", "price": 4376.0, "desc": "Frontier Oval Aesthetic Public Bin with Stone Finish. 300x420x999 mm.", "page": 10},
    {"sku": "FLBOVB60-SOLID", "name": "Frontier Oval Bin 60L (Solid Colour)", "category": "Waste Management & Bins", "subcategory": "Premium Lobby & Public Bins", "price": 3186.0, "desc": "Frontier Oval Solid Colour Public Bin. 310x410x716 mm.", "page": 10},
    {"sku": "FLBOVB90-SOLID", "name": "Frontier Oval Bin 90L (Solid Colour)", "category": "Waste Management & Bins", "subcategory": "Premium Lobby & Public Bins", "price": 3641.0, "desc": "Frontier Oval Solid Colour Public Bin. 300x420x999 mm.", "page": 10},
    # Page 11: Doffing Basket
    {"sku": "FDB-301", "name": "Frontier Doffing Basket 301L", "category": "Material Handling & Linen", "subcategory": "Material Handling Tubs", "price": 25100.0, "desc": "Frontier Doffing Basket with 4 Heavy Duty Wheels & Frame. 930x630x525 mm.", "page": 11}
]

# Write photos and format catalog entries
items_to_add = []
for p in frontier_products:
    p_num = p["page"]
    clean_sku = p["sku"].replace(' ', '_').replace('/', '_')
    img_filename = f"{clean_sku}.jpg"
    img_path = os.path.join(img_dir, img_filename)

    if p_num in page_images and not os.path.exists(img_path):
        with open(img_path, "wb") as f:
            f.write(page_images[p_num].data)

    items_to_add.append({
        "brand": "Frontier",
        "sku": p["sku"],
        "name": p["name"],
        "description": p["desc"],
        "category": p["category"],
        "subcategory": p["subcategory"],
        "unit": "Nos",
        "hsn": "39249090",
        "gst": "18%",
        "mrp": p["price"],
        "sellingPrice": p["price"],
        "stock": "In Stock",
        "image": f"/images/{img_filename}"
    })

print(f"2. Saved {len(items_to_add)} product photos into '{img_dir}'.")

# Update products.json
json_path = "src/data/products.json"
existing = []
if os.path.exists(json_path):
    with open(json_path, "r", encoding="utf-8") as f:
        existing = json.load(f)

# Prevent duplicates
existing = [x for x in existing if x.get("brand") != "Frontier"]
merged = existing + items_to_add

with open(json_path, "w", encoding="utf-8") as f:
    json.dump(merged, f, indent=2)

print(f"3. Successfully updated '{json_path}'.")
print(f"New catalog total: {len(merged)} products across Tramontina, Dolphy, Kärcher, and Frontier!")