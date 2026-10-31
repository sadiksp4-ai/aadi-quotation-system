import pandas as pd
import json
import os

excel_file = "Aadi Clients for Website.xlsx"
if not os.path.exists(excel_file) and os.path.exists(f"../{excel_file}"):
    excel_file = f"../{excel_file}"

xls = pd.ExcelFile(excel_file)
clients = []

for sheet in xls.sheet_names:
    df = pd.read_excel(excel_file, sheet_name=sheet)
    for _, row in df.iterrows():
        account_name = str(row.get('Client Account Name', '')).strip()
        if not account_name or account_name == 'nan':
            continue

        prop_name = str(row.get('Operating Brand / Property Name', '')).strip()
        legal = str(row.get('Legal / Parent Entity', '')).strip()
        addr = str(row.get('Property Address', '')).strip()
        city = str(row.get('Region / City', '')).strip()
        person = str(row.get('Contact Person', '')).strip()
        desig = str(row.get('Designation', '')).strip()
        phone = str(row.get('Contact Number', '')).strip()
        email = str(row.get('Email Address', '')).strip()

        # Clean formatting
        phone = phone.replace('.0', '') if phone != 'nan' else ''
        person = person if person != 'nan' else ''
        desig = desig if desig != 'nan' else ''
        email = email if email != 'nan' else ''
        addr = addr if addr != 'nan' else ''
        legal = legal if legal != 'nan' else ''
        prop_name = prop_name if prop_name != 'nan' else account_name

        # Detect State for GST Auto-Fill (Default Maharashtra - 27 unless out of state)
        place_of_supply = "Maharashtra (27)"
        addr_lower = (addr + " " + city).lower()
        if "kerala" in addr_lower:
            place_of_supply = "Kerala (32)"
        elif "delhi" in addr_lower or "gurgaon" in addr_lower or "haryana" in addr_lower:
            place_of_supply = "Haryana (06)"
        elif "uttarakhand" in addr_lower:
            place_of_supply = "Uttarakhand (05)"
        elif "goa" in addr_lower:
            place_of_supply = "Goa (30)"
        elif "karnataka" in addr_lower or "bengaluru" in addr_lower or "bangalore" in addr_lower:
            place_of_supply = "Karnataka (29)"
        elif "gujarat" in addr_lower:
            place_of_supply = "Gujarat (24)"

        clients.append({
            "id": len(clients) + 1,
            "category": sheet.strip(),
            "accountName": account_name,
            "propertyName": prop_name,
            "legalEntity": legal,
            "address": addr,
            "city": city,
            "contactPerson": person,
            "designation": desig,
            "phone": phone,
            "email": email,
            "placeOfSupply": place_of_supply
        })

os.makedirs("src/data", exist_ok=True)
with open("src/data/clients.json", "w", encoding="utf-8") as f:
    json.dump(clients, f, indent=2)

print(f"Successfully exported {len(clients)} clients into 'src/data/clients.json'!")