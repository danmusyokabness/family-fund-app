import os
import re
import requests
import pdfplumber

PDF_FILENAME = "mpesa_statement.pdf"
PDF_PASSWORD = "YOUR_STATEMENT_PASSWORD"  # Your ID or Business Reg Number
LIVE_API_URL = "https://your-app.vercel.app/api/mpesa/import"

def process_and_sync():
    if not os.path.exists(PDF_FILENAME):
        print(f"Error: {PDF_FILENAME} not found.")
        return

    parsed_rows = []

    with pdfplumber.open(PDF_FILENAME, password=PDF_PASSWORD) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text:
                continue

            for line in text.split('\n'):
                match = re.search(r'(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+([A-Z0-9]+)\s+(.*?)\s+([\d,]+\.\d{2})', line)
                if match:
                    date_time, receipt, details, amount = match.groups()

                    phone_match = re.search(r'(2547\d{8}|2541\d{8}|07\d{8}|01\d{8})', details)
                    phone = phone_match.group(1) if phone_match else None

                    if phone:
                        if phone.startswith('0'):
                            phone = '254' + phone[1:]

                        date_str = date_time.split(' ')[0][:-2] + '01'

                        parsed_rows.append({
                            'phone': phone,
                            'amount': float(amount.replace(',', '')),
                            'dateStr': date_str
                        })

    if not parsed_rows:
        print("No transactions parsed.")
        return

    response = requests.post(LIVE_API_URL, json={'transactions': parsed_rows})

    if response.status_code == 200:
        print("Successfully updated live ledger database!")
        print(response.json())
    else:
        print(f"Error syncing data: {response.status_code} - {response.text}")

if __name__ == "__main__":
    process_and_sync()