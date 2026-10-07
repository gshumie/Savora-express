# Savora Express

A responsive, multi-page restaurant website and front-end ordering demonstration built with semantic HTML, CSS, and vanilla JavaScript. The visual identity uses warm orange and tomato accents, editorial food photography, and a clean, mobile-friendly layout.

> **Demo mode:** The Express API stores menu, guest cart, and demo order data in PostgreSQL. When Stripe is not configured, checkout records an order with a pending development payment; it does not charge a card or notify a restaurant. Contact and newsletter forms validate locally and do not submit information. Ratings, review counts, restaurant contact details, hours, and location are sample content; replace them before launch.

## Features

- Home, About, Menu, Contact, and Checkout pages with shared responsive navigation and footer.
- 12 insert-only database sample menu items across six categories, plus 23 local fallback demo items.
- Menu category filters, search across names and descriptions, URL category links, and price/popularity sorting.
- Featured dishes and daily, bundle, and seasonal offers; offer cards add their discounted item to the cart.
- Persistent guest cart backed by the API and browser LocalStorage, with quantity increase/decrease, removal, and item count.
- Checkout summary with subtotal, estimated 8% tax, $3.99 sample delivery fee, and free pickup selection.
- Checkout form validation with delivery-address requirements that adapt for pickup, international-format phone entry, and a clearly identified demo confirmation.
- Contact and newsletter form validation with local success messages only.
- Keyboard-visible focus, skip links, semantic landmarks, alt text, reduced-motion support, and accessible status messages.
- SEO titles, meta descriptions, Open Graph metadata, lazy-loaded non-hero photos, and responsive layouts.

## Technology

- HTML5, CSS3, vanilla JavaScript, Node.js, Express, Prisma, and PostgreSQL.
- Google Fonts (DM Serif Display and Manrope) and Unsplash-hosted food photography load from the internet.
- Browser LocalStorage stores only the demo cart item IDs and quantities. Checkout details are not saved.

## Project Structure

```text
savora-express/
├── index.html       # Home, featured dishes, offers, reviews, newsletter
├── about.html       # Story, values, history, and team
├── menu.html        # Searchable, filterable menu
├── contact.html     # Contact form, hours, and map placeholder
├── checkout.html    # Cart, delivery/pickup, summary, demo confirmation
├── style.css        # Shared design system and responsive styles
├── script.js        # Menu data and shared interactions
├── server.js         # Express API and frontend server
├── src/              # API routes, Prisma client, auth, and configuration
├── prisma/           # Prisma schema, migrations, and safe insert-only seed
├── .env.example      # Local configuration template (no real credentials)
├── README.md        # Project guide
└── .gitignore       # Common local/editor files to omit
```

## Run Locally

### Start the backend

1. Install Node.js and PostgreSQL.
2. Copy `.env.example` to `.env`, then set `DATABASE_URL` and a unique, private `JWT_SECRET`. Keep `.env` out of version control.
3. Install dependencies with `npm install`.
4. Generate the Prisma client with `npm run prisma:generate`.
5. Apply committed database migrations with `npx prisma migrate deploy`.
6. Start the server with `npm start` (or `npm run dev` during development), then open `http://localhost:3000`.

For a new development database without migration history, review the schema and migration plan before creating the initial migration. `npm run prisma:seed` inserts sample menu records only when the products table is empty; it does not clear or replace existing records.

Google Fonts and Unsplash-hosted photos require internet access. The frontend and API are served from the same origin by Express.

## Customization

### Brand and contact information

Edit the repeated brand, address, telephone, email, hours, and social links in the page headers and footers. Replace the clearly noted sample location and `hello@savora.example` email before launch.

### Images

Food photography uses direct Unsplash image URLs in the HTML, database product records, and the fallback catalog in `script.js`. Replace those URLs with images you have permission to use. Keep useful alt text and use appropriately sized/compressed images; hero images load eagerly while most other images are lazy-loaded.

### Colors and typography

At the top of `style.css`, change the CSS custom properties (`--orange`, `--tomato`, `--charcoal`, `--cream`, and font variables). Google Font imports are in each page's `<head>`.

### Menu, offers, and prices

Add database menu items in `prisma/seed.js` for a new, empty database; the seed intentionally skips when products already exist. The `fallbackProducts` array in `script.js` is used only when the API is unavailable. Featured dishes and offer cards are selected from the available catalog. `originalPrice` is shown as a crossed-out offer price. Sample checkout tax and delivery fee are the `TAX_RATE` and `DELIVERY_FEE` constants.

### Real ordering

A production checkout requires a secure backend for inventory, order submission, notifications, and a payment provider. Do not place payment credentials or secret keys in this front-end project. The current checkout intentionally performs no real transaction.

## Git and GitHub

From the project folder, open the VS Code terminal. `.env` and `node_modules/` are excluded by `.gitignore`; `.env.example` is intentionally included as a credentials-free template. If this folder is not already a Git repository, initialize it and make the first commit:

```powershell
git init
git add .
git commit -m "Build Savora Express restaurant website"
git branch -M main
```

Create an empty repository on GitHub using your own account. Do not initialize that remote repository with a README or license if you already made the local first commit. Replace the placeholder below with the URL GitHub gives you, then connect and push:

```powershell
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

If `origin` already exists, inspect it with `git remote -v` and update it only if needed; do not add a duplicate remote.

## Hosting

GitHub Pages can host only the static frontend files; it cannot run this Express API or connect this project to PostgreSQL. To use menu, cart, and order API features after publishing, deploy the Node.js server and PostgreSQL database to a backend-capable host and configure private environment variables there.

Before a real launch, configure a strong unique `JWT_SECRET`, a production database URL, Stripe keys/webhook, and the correct `CLIENT_URL`; replace demo restaurant content and review checkout, privacy, and operational requirements.

## Quality Checks

Run `npm test` and check the pages in a browser at desktop and mobile widths, then verify:

- Navigation and category links open the expected pages and menu filter.
- Search, categories, and sorting update menu results.
- Adding products updates the header count and survives a page reload.
- Checkout quantity controls, removal, tax, delivery/pickup, required fields, and demo confirmation work.
- Contact/newsletter forms show validation and local-only feedback.
- Photos load and sample contact/content has been replaced for a real restaurant.
