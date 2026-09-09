# Notes to Sizing/POV

**A tool for SA's to enter in notes from various sources and then auto generate a sizing presentation, design document, schema document...**

A single-user (per team), multi-customer web app for capturing engagement notes (text, files, images) per customer + app, and generating heuristic Atlas sizing recommendations and schema design findings from that data — output as copy-paste-ready text for use in decks/docs.

## Features

- **Customer → App → Notes hierarchy** — select or create a customer, then select or create an app for that customer, then capture notes scoped to that pair.
- **Text notes** — paste/type notes directly into the app.
- **File & image notes** — upload documents/images, stored in MongoDB Atlas via GridFS.
- **Sizing recommendation** — heuristic Atlas cluster tier estimate based on actual stored data size (per app), using configurable tier pricing.
- **Schema design linting** — flags schema drift, oversized documents, missing indexes, and other design concerns found in a given app's notes.
- **Settings page** — edit Atlas tier pricing and global/per-customer discount percentages used in sizing calculations.

## Tech Stack

- Node.js + Express (backend API)
- MongoDB Atlas driver (`mongodb` npm package) + GridFS for file storage
- Plain HTML/CSS/vanilla JS frontend (no build step, no framework)
- `dotenv` for environment config, `multer` for file upload handling

## Architecture

### Multi-tenancy: database-per-customer, collection-per-app

```
Cluster
├── platform (database)
│   ├── customers (collection)
│   │   { name, dbSlug, discountPercent, apps: [{ name, appSlug, createdAt }], createdAt }
│   └── pricingConfig (collection, singleton doc "default")
│       { tiers: [...], discountPercent, updatedAt }
├── disney (database)                       # one database per customer
│   ├── mobile-app.notes                    # one collection per app
│   ├── mobile-app-uploads.files / .chunks  # GridFS bucket per app
│   ├── website.notes
│   └── website-uploads.files / .chunks
├── acme (database)
│   └── ... same pattern per its apps
```

This design keeps per-app sizing/schema analysis clean (native `collStats()`/`db.stats()` scoped exactly to one app's data) and keeps customer data cleanly isolated. At hackathon/team scale (dozen customers, up to ~40 apps each) this stays well within Atlas namespace limits on any dedicated (M10+) tier.

### Data model

**Note document** (in `<appSlug>.notes`):
```json
{
  "_id": "ObjectId",
  "title": "Meeting recap",
  "type": "text",
  "body": "Discussed Q3 roadmap...",
  "source": "manual",
  "externalId": null,
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```
File notes additionally include `fileId`, `filename`, `contentType`, `size` (and omit `body`).

**Customer registry** (in `platform.customers`):
```json
{
  "name": "Disney",
  "dbSlug": "disney",
  "discountPercent": null,
  "apps": [{ "name": "Mobile App", "appSlug": "mobile-app", "createdAt": "ISODate" }],
  "createdAt": "ISODate"
}
```

**Pricing config** (in `platform.pricingConfig`, singleton doc `_id: "default"`):
```json
{
  "_id": "default",
  "tiers": [
    { "tier": "M10", "ramGB": 2, "storageGB": 10, "vCPUs": 2, "monthlyPrice": 58.4 }
  ],
  "discountPercent": 0,
  "updatedAt": "ISODate"
}
```
Seeded from real public Atlas pricing (mongodb.com/pricing) on first server start.

## Folder Structure

```
.
├── .env                     # local secrets (gitignored)
├── .env.example             # template for .env
├── server.js                # Express app entry point
├── db.js                    # Mongo client singleton, per-customer/app db/collection/bucket helpers, pricingConfig seeding
├── routes/
│   ├── customers.js         # customer + app registry endpoints
│   ├── config.js            # pricing config endpoints
│   └── notes.js             # notes + file endpoints, scoped by customer/app
├── services/
│   ├── sizingAnalyzer.js     # heuristic Atlas tier estimator
│   └── schemaLinter.js       # schema design lint checks
├── public/
│   ├── assets/mongodb-logo.svg
│   ├── index.html
│   ├── style.css
│   └── script.js
└── package.json
```

## Setup & Run

This project uses a **shared Atlas cluster** for the team — everyone on the team points their local `.env` at the same connection string so you all see the same customers/apps/notes.

1. Clone the repo:
   ```
   git clone <repo-url>
   cd <repo>
   ```
2. Install dependencies:
   ```
   npm install
   ```
3. Copy the env template and fill in the shared connection string (get this from a teammate via a secure channel — Slack DM, password manager, etc. — **never** commit it or paste it into an issue/PR):
   ```
   cp .env.example .env
   ```
   Edit `.env`:
   ```
   ATLAS_URI=<shared connection string>
   PORT=3000
   ```
4. Make sure your IP is allowed in the Atlas cluster's **Network Access** list (or ask whoever manages the cluster to add it / temporarily allow `0.0.0.0/0` for the hackathon).
5. Start the app:
   ```
   npm start
   ```
6. Open [http://localhost:3000](http://localhost:3000).

## API Reference

| Method | Route | Description |
|---|---|---|
| GET | `/api/customers` | List all customers |
| POST | `/api/customers` | Create a customer `{ name }` |
| PATCH | `/api/customers/:customerSlug` | Update a customer's `discountPercent` override |
| GET | `/api/customers/:customerSlug/apps` | List a customer's apps |
| POST | `/api/customers/:customerSlug/apps` | Create an app for a customer `{ name }` |
| GET | `/api/config/pricing` | Get tier pricing + global discount |
| PUT | `/api/config/pricing` | Replace tier pricing / global discount |
| GET | `/api/customers/:customerSlug/apps/:appSlug/notes` | List notes for a customer+app |
| POST | `/api/customers/:customerSlug/apps/:appSlug/notes` | Create a text note `{ title, body }` |
| POST | `/api/customers/:customerSlug/apps/:appSlug/notes/upload` | Upload a file/image note (multipart form, field `file`, optional `title`) |
| GET | `/api/customers/:customerSlug/apps/:appSlug/files/:fileId` | Stream/download a file note's content |
| GET | `/api/customers/:customerSlug/apps/:appSlug/analysis/sizing` | Get heuristic sizing recommendation (text) |
| GET | `/api/customers/:customerSlug/apps/:appSlug/analysis/schema` | Get schema design lint findings (text) |

## Known Limitations / Explicitly Deferred (future work)

- **No authentication** — single-user-per-team app for now; anyone with the shared connection string/app URL has full access.
- **No real document/presentation file export** — sizing/schema outputs are presentation-ready *text* meant to be copy-pasted into slides/docs, not generated PPTX/DOCX/PDF files yet.
- **No Salesforce Notes integration yet** — the `source` and `externalId` fields exist on note documents specifically to make this easier to add later (dedupe/upsert by external ID), but no sync logic exists yet.
- **No Atlas Admin API integration** — sizing recommendations are heuristic, computed only from `collStats()`/`db.stats()` data already visible to the driver; no live cluster metrics or Performance Advisor integration.
- **Hand-written CSS, not MongoDB's official LeafyGreen UI** — styling approximates MongoDB's brand palette but isn't pixel-accurate to MongoDB's real design system. Migrating to LeafyGreen UI (React) later is possible without touching backend/API code.
