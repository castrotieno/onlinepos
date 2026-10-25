# SmallBiz POS & Inventory Manager — v2

A modern, online-ready **Point of Sale (POS) + Inventory Management** system for small businesses.

- Modern sidebar dashboard UI
- Supabase authentication + PostgreSQL backend
- Inventory, stock in/out, reorder alerts
- POS cart, checkout, receipts, and receipt printing
- Sales log management: view, reprint, and delete sales (stock is restored)
- Report generation with date filters and printable reports
- Sample data loader, refresh, and full data reset
- Ready for GitHub Pages hosting

## Supabase setup

The app is pre-configured with your Supabase project URL and publishable key in `config.js`.

1. Open the Supabase dashboard.
2. Go to **SQL Editor**.
3. Run the entire contents of `supabase/schema.sql`.
4. Go to **Authentication -> Users** and create your first user, or use **Create account** in the app.

## Run locally

```bash
python -m http.server 8080
```

Open http://localhost:8080

## Deploy to GitHub Pages

1. Create a GitHub repository, e.g. `smallbiz-pos`.
2. Upload all files, keeping this structure:

```text
index.html
styles.css
app.js
config.js
README.md
supabase/schema.sql
```

3. Go to **Settings -> Pages**.
4. Choose **Deploy from a branch**, branch `main`, folder `/ (root)`.
5. Save. Your site will be available at:

```text
https://YOUR-USERNAME.github.io/smallbiz-pos/
```

## Main features

### Dashboard
- Today's revenue, profit, transactions, and items sold
- Low-stock / reorder alerts
- Recent sales

### POS
- Product search
- Click-to-add cart
- Quantity editing
- Discount, customer, and payment method
- Automatic stock deduction
- Printable receipt after checkout

### Products
- Add, edit, delete products
- Cost price, selling price, stock, reorder level
- Search and stock status badges

### Stock
- Stock In and Stock Out
- Movement notes
- Complete stock history

### Sales log
- Filter sales by date and search customer
- View receipt
- Reprint receipt
- Delete a sale; stock is automatically restored

### Reports
- Custom date range
- Revenue, profit, transactions, items sold
- Daily sales breakdown
- Best-selling products
- Printable report

### Utilities
- **Refresh**: reload all data
- **Load sample data**: adds demo products and sample sales
- **Reset data**: permanently deletes products, stock history, sales, and sale items

## Security

- Only authenticated users can access business data.
- The publishable/anon key is safe in a public static site because RLS is enabled.
- Never place a Supabase `service_role` key or database password in this frontend.
