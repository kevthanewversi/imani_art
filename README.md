# Artist Studio

Portfolio site + shop + admin dashboard. One package, plug and play.
<img width="1509" height="824" alt="Screenshot 2026-04-19 at 13 39 16" src="https://github.com/user-attachments/assets/5887b014-d094-4081-8a3f-798b01622648" />


---

## Setup (3 steps)

```bash
# 1. Install
npm install

# 2. Start
npm start

# 3. Open
#    Portfolio  →  http://localhost:3001
#    Admin      →  http://localhost:3001/admin
#    Password   →  studio2024
```

That's it. The database and all tables are created automatically on first run.

---

## Configure (in the admin)

Go to **Admin → Site Settings** to update:
- Your name, bio, location, social links
- Hero text, about section, shipping info

Everything updates on the live site immediately.

---

## Change the admin password

Either set it in a `.env` file:
```
ADMIN_PASSWORD=yournewpassword
```

Or just keep the default for local use. **Change it before hosting publicly.**

---

## Enable Shopify (optional)

Shopify gives you PCI-compliant checkout, card payments, Apple Pay, and order management.

1. Go to your [Shopify Admin](https://admin.shopify.com) → Settings → Apps → Develop apps
2. Create an app, enable `write_products` + `read_products` + `write_inventory` scopes
3. Install it and copy the Admin API access token
4. Create a `.env` file:

```
ADMIN_PASSWORD=yournewpassword
SHOPIFY_STORE_DOMAIN=yourstore.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxxxxxxxxxxx
```

5. Restart the server (`npm start`)

Now when you click **Publish** on a painting in the admin, it syncs to Shopify automatically — with the image, title, description, and inventory set to 1 (since each original is unique). Marking a painting as sold zeroes the Shopify inventory.

**The portfolio cart:** once paintings are published to Shopify, visitors can add multiple pieces to a cart right on your site. Clicking **Checkout Securely** hands the full cart over to Shopify's hosted checkout — cards, Apple Pay, PayPal, shipping, and tax are all handled by Shopify. Cart contents persist across visits via localStorage, and automatically clear any paintings that have been sold.

**Without Shopify:** paintings marked as Live appear on the portfolio with an "Enquire" button that opens your email.

---

## Deploy online

### Railway (easiest — ~$5/mo, free trial)
```bash
# Push to a GitHub repo, then:
# 1. railway.app → New Project → Deploy from GitHub
# 2. Add your env vars in Railway dashboard
# 3. Done — Railway gives you a live URL + HTTPS
```

### Render (free tier)
Same process — connect GitHub repo, add env vars, deploy.

### Any VPS
```bash
git clone your-repo && cd artist-studio
npm install --production
# Keep running with PM2:
npm install -g pm2
pm2 start server.js --name studio
pm2 save && pm2 startup
```

---

## Data & backups

Everything is stored in `studio.db` (SQLite) and `uploads/` (images).

To back up: copy those two items. To migrate to a new server: copy them there.

---

## File structure
```
artist-studio/
├── server.js          ← Express server, API, DB, auth
├── package.json
├── .env.example       ← Copy to .env and customise
├── studio.db          ← Created on first run (your data)
├── uploads/           ← Created on first run (your images)
└── public/
    ├── index.html     ← Portfolio site (dynamic)
    └── admin/
        └── index.html ← Admin dashboard
```
