# Savora Express

A responsive, multi-page restaurant website and front-end ordering demonstration built with semantic HTML, CSS, and vanilla JavaScript. The visual identity uses warm orange and tomato accents, editorial food photography, and a clean, mobile-friendly layout.

> **ETB pricing approval required:** Current menu and fee numbers are legacy sample values and have not been approved as Ethiopian Birr prices. The site formats them as ETB for review, but checkout is blocked by default until the owner reviews the price list and explicitly sets `ETB_PRICES_APPROVED=true`. No historical database financial records are converted or rewritten.

## Features

- Home, About, Menu, Contact, and Checkout pages with shared responsive navigation and footer.
- A 12-item database catalog across six categories and a matching 12-item local fallback catalog.
- Menu category filters, search across names and descriptions, URL category links, and price/popularity sorting.
- Three catalog-favorite cards on the home page; they add the featured item to the cart without inventing a discount.
- Persistent guest cart backed by the API and browser LocalStorage, with quantity increase/decrease, removal, and item count.
- Legacy saved carts are migrated by matching stable product slugs or known identical older product IDs. Items with no current equivalent are removed with a visible notice; unknown old database IDs cannot be safely mapped when the API is unavailable.
- Checkout summary with subtotal, estimated 8% tax, the existing numeric delivery fee (ETB price approval pending), and free pickup selection.
- Checkout form validation with delivery-address requirements that adapt for pickup, international-format phone entry, and a clearly identified demo confirmation.
- Server-side Stripe or Chapa checkout selection, payment verification before order confirmation, and authenticated/idempotent payment callbacks.
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
2. Copy `.env.example` to `.env`, then set `DATABASE_URL`, `DIRECT_URL`, a unique private `JWT_SECRET`, and a private random `PAYMENT_STATUS_TOKEN_SECRET` of at least 32 characters for production. Use `DATABASE_URL` for the application's runtime connection (the pooled URL for Neon) and `DIRECT_URL` for Prisma CLI operations that require a direct database connection. Keep `.env` out of version control. Guest payment-status access uses a signed order-specific token kept out of request URLs; in development, the key is generated for the process and those links stop working after a server restart unless a persistent local key is configured.
3. Install dependencies with `npm install`.
4. Generate the Prisma client with `npm run prisma:generate`.
5. Apply committed database migrations with `npx prisma migrate deploy`.
6. Start the server with `npm start` (or `npm run dev` during development), then open `http://localhost:3000`.

For a new development database without migration history, review the schema and migration plan before creating the initial migration. Seeding is disabled by default and is refused in production. To opt in for a non-production database, set `ALLOW_DATABASE_SEEDING=true` locally before running `npm run prisma:seed`. The seed inserts sample menu records only when the products table is empty; it does not clear or replace existing records.

Authentication uses persistent per-login sessions. Apply the `AuthSession` migration before deploying code that validates session IDs; existing access tokens without a session ID will require users to sign in again.

### Chapa test checkout

Chapa is opt-in. Keep `CHAPA_CURRENCY=ETB` and `CHAPA_ENVIRONMENT=test` for local testing. Existing menu prices, the 8% tax rule, and the numeric delivery fee are displayed using ETB formatting but are not approved ETB prices; `ETB_PRICES_APPROVED` defaults to `false`, and both checkout endpoints reject requests before order or payment writes until the owner has reviewed and approved the complete price list. Do not set it to `true` until that review is complete. The integration does not convert currencies. `APP_BASE_URL` must be a publicly reachable server base URL when configuring Chapa callbacks; `CLIENT_URL` is used for the browser return URL. Configure `CHAPA_WEBHOOK_SECRET` with the webhook secret hash set in the Chapa dashboard. The server verifies the webhook signature and then calls Chapa's transaction verification endpoint before confirming an order.

Stripe uses its separate `STRIPE_CURRENCY` setting (default `USD`); it must be a recognized three-letter uppercase currency code with two minor-unit digits and be supported by the connected Stripe account. Because the current catalog prices are ETB and no conversion or alternate price list exists, Stripe refuses to start unless its currency is explicitly set to `ETB`; first confirm that the Stripe account supports ETB. Set `STRIPE_WEBHOOK_SECRET` whenever `PAYMENT_PROVIDER=stripe`; the server refuses to start without it. Chapa continues to use its independent ETB-only `CHAPA_CURRENCY`.

This integration uses Chapa's [Accept Payments](https://developer.chapa.co/integrations/accept-payments) and [Webhooks](https://developer.chapa.co/integrations/webhooks) API documentation. A browser return is never treated as payment proof. The status shown after returning is loaded from the backend, and an order remains pending until a verified provider notification or server-side verification confirms payment.

To run the focused provider tests without contacting Chapa or making payments, run `node --test tests/chapa.test.js`. Run the complete local test suite with `npm test`. No schema change or migration is needed.

Google Fonts and Unsplash-hosted photos require internet access. The frontend and API are served from the same origin by Express.

## Customization

### Brand and contact information

Edit the repeated brand, address, telephone, email, hours, and social links in the page headers and footers. Replace the clearly noted sample location and `hello@savora.example` email before launch.

### Images

Food photography uses direct Unsplash image URLs in the HTML, database product records, and the fallback catalog in `script.js`. Replace those URLs with images you have permission to use. Keep useful alt text and use appropriately sized/compressed images; hero images load eagerly while most other images are lazy-loaded.

### Colors and typography

At the top of `style.css`, change the CSS custom properties (`--orange`, `--tomato`, `--charcoal`, `--cream`, and font variables). Google Font imports are in each page's `<head>`.

### Menu, offers, and prices

Product prices are displayed in Ethiopian Birr (ETB); the database stores the numeric amount without a currency column. The API and checkout use the canonical slug-to-price map in `src/lib/approvedPrices.js`. Price approval for checkout is controlled by `ETB_PRICES_APPROVED`; until it is enabled after owner review, public pages mark prices as unapproved and checkout stays disabled. Add database menu items in `prisma/seed.js` for a new, empty database; the seed intentionally skips when products already exist. The 12-item `fallbackProducts` catalog in `script.js` is used only when the API is unavailable. The home page highlights three current catalog favorites; it does not apply a discount or display a crossed-out comparison price. Checkout uses integer minor units with an 8% estimated tax rule and ETB 100 delivery fee; pickup is free. Existing financial records are historical and are not relabeled or rewritten by the ETB formatting change.

### Real ordering

A production checkout requires a secure backend for inventory, order submission, notifications, and payment-provider configuration. Payment credentials stay on the server. Stripe and Chapa orders remain pending until payment is verified by the backend; without supported provider credentials, checkout uses the existing demo mode and does not process a transaction.

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

Before a real launch, configure a strong unique `JWT_SECRET`, a production database URL, the selected provider's live keys and webhook settings, `APP_BASE_URL`, and the correct `CLIENT_URL`; replace demo restaurant content and review checkout, privacy, and operational requirements.

## Quality Checks

Run `npm test` and check the pages in a browser at desktop and mobile widths, then verify:

- Navigation and category links open the expected pages and menu filter.
- Search, categories, and sorting update menu results.
- Adding products updates the header count and survives a page reload.
- Checkout quantity controls, removal, tax, delivery/pickup, required fields, and demo confirmation work.
- Contact/newsletter forms show validation and local-only feedback.
- Photos load and sample contact/content has been replaced for a real restaurant.
