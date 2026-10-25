# SmallBiz POS & Inventory Manager

An online-ready **Point of Sale (POS) + Inventory Management** system for small businesses.

- HTML / CSS / JavaScript frontend (no build step)
- Supabase backend: authentication, PostgreSQL database, and secure APIs
- Ready to host free on GitHub Pages

## Features

- Email/password login
- Product catalog with SKU, category, cost price, selling price, stock, and reorder level
- Stock In / Stock Out with full movement history
- POS cart and checkout
- Automatic stock deduction on sales
- Sales history with profit tracking
- Dashboard with today's sales, profit, product count, and low-stock alerts
- Reorder-level alerts
- Atomic sale processing to prevent overselling

## Supabase setup

This project is pre-configured for Supabase project:

- Project URL: `https://wdutzhesbtbrbrgiohrh.supabase.co`
- Publishable/anon key: already set in `config.js`

### 1. Create the database tables

1. Open your Supabase dashboard: https://supabase.com/dashboard
2. Select the project.
3. Open **SQL Editor**.
4. Copy and run the entire contents of `supabase/schema.sql`.

### 2. Create your first user

Go to **Authentication -> Users -> Add user**, then create an email/password user.
Alternatively, open the app and use **Create account**.

## Run locally

Open `index.html` directly, or run:

```bash
python -m http.server 8080
```

Then open: http://localhost:8080

## Deploy to GitHub Pages

1. Create a GitHub repository, for example `smallbiz-pos`.
2. Upload every file from this folder, keeping the folder structure:
   - `index.html`
   - `app.js`
   - `styles.css`
   - `config.js`
   - `supabase/schema.sql`
   - `README.md`
3. Go to **Settings -> Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select branch `main` and folder `/ (root)`, then save.
6. Your app will be available at:

```
https://YOUR-GITHUB-USERNAME.github.io/smallbiz-pos/
```

## Security

- The publishable/anon key is safe for a public static site because Row Level Security is enabled.
- Only authenticated users can read or write business data.
- Never place a Supabase `service_role` key in this project.
- The PostgreSQL connection string shown in the Supabase dashboard is for server-side/admin use only; it is not needed by this web app.

## Daily workflow

1. Add products in **Products**.
2. Record received inventory using **Stock -> Stock In**.
3. Sell items through **POS**.
4. Monitor performance and reorder needs in **Dashboard**.
5. Review sales and profit in **Sales**.
