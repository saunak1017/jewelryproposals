# Jewelry Proposal App

A Cloudflare Pages + React/Vite app for creating private jewelry proposal links from Excel files, collecting customer selections, and exporting clean PDF summaries.

## What this app does

### Admin side
- Password-protected admin area at `/admin`
- Upload Excel file with columns A-K
- Upload product images named by Style Number
- Upload logo
- Preview all pulled information before publishing
- Edit text fields before publishing
- Warn when images are missing
- Enter Prepared For, optional intro text, and custom URL slug
- Publish proposal
- View customer submissions
- Export submission summary PDF

### Customer side
- Proposal URL: `/proposal/YOUR-SLUG`
- Opens to All Styles
- Secondary navigation generated from Column J
- Product cards show image, style number, category, metal, TCW, stone type, and price
- Product detail pages show all fields except Secondary Navigation Category
- Groups same Style Number together when Natural and Lab Grown versions exist
- Customer can add styles to a selection, choose version, enter quantity, and submit

## Excel columns required

| Column | Header |
|---|---|
| A | Style Number |
| B | Jewelry Category |
| C | Description |
| D | Metal |
| E | Diamond Quality |
| F | Total Carat Weight |
| G | Stone Type |
| H | Price |
| I | Notes |
| J | Secondary Navigation Category |
| K | Diamond Type |

Column K is internal logic only. Use exactly:
- Natural
- Lab Grown

Column G remains customer-facing and can say things like Natural Diamond, Lab Grown Diamond, Semiprecious Gemstone, Natural & Semiprecious, etc.

## Image naming

Product images should be named exactly like the style number, plus extension.

Examples:
- `ER123.jpg`
- `ER123.jpeg`
- `ER123.PNG`

Accepted formats:
- jpg
- jpeg
- png

The app compresses uploaded product images before saving them into D1, so you do not need R2 for the first version.

## Cloudflare setup

### 1. Create GitHub repository

Create a new GitHub repo, for example:

```text
jewelry-proposal-app
```

Upload all files from this folder.

### 2. Create Cloudflare Pages project

In Cloudflare Pages:

- Connect to your GitHub repo
- Framework preset: `React (Vite)`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: leave blank

### 3. Create D1 database

Create a Cloudflare D1 database named:

```text
jewelry_proposals
```

### 4. Apply migration

In Cloudflare, run the SQL inside:

```text
migrations/001_init.sql
```

Or using Wrangler:

```bash
wrangler d1 execute jewelry_proposals --file=migrations/001_init.sql
```

### 5. Add D1 binding

In your Cloudflare Pages project settings:

- Go to Settings
- Functions
- D1 database bindings
- Add binding
- Variable name: `DB`
- Database: `jewelry_proposals`

### 6. Add environment variable

In Cloudflare Pages project settings, add:

```text
ADMIN_PASSWORD=choose-a-password-here
```

This is the password you use at `/admin`.

### 7. Deploy

After deployment, open:

```text
https://your-project.pages.dev/admin
```

## Notes for V1

- Email notifications are not included yet because fully free email sending requires another service or Google Apps Script setup.
- Submissions are saved in the admin dashboard.
- PDF export is generated from the admin submission detail page.
- Product images are stored in D1 as compressed data URLs. This keeps setup free and simple, but for very large image libraries later, Cloudflare R2 would be better.

## Suggested future upgrades

- Email notification on new submission
- Cloudflare R2 image storage
- Proposal editing after publishing
- Delete/archive proposal
- Download submissions as Excel
- Customer viewed/opened tracking
- Status workflow: New, Reviewed, Confirmed, Produced
