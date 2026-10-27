# Nearle Daily — MCP server for Claude

Customers connect Nearle in Claude and sign in with their mobile number (your existing
`customers/login` API). Then they can search products, compare prices and place Cash on Delivery
orders on their own account.

- Your backend is not changed.
- No database: logins are signed tokens.
- No Claude API key or AI key is needed.

Tools: list_stores · browse_store · search_products · place_order (shows the bill first, then orders after a yes)

## Run free on Render
1. Push this folder to a GitHub repo (keep `.env` out of it).
2. On render.com, choose New → Web Service → pick the repo.
   - Build: `npm install`
   - Start: `npm start`
   - Instance type: Free
3. Under Environment, add:
   - `SECRET_KEY` = 32+ random characters
   - `HASURA_SECRET` = the same secret the app uses
4. Deploy, then open `https://YOUR-APP.onrender.com`. You should see "running".

## Add it to Claude
Go to Settings → Connectors → Add custom connector.
- Name: Nearle Daily
- URL: `https://YOUR-APP.onrender.com/mcp`

Click Connect, and the Nearle sign-in page opens. Enter your mobile number, and you're done.

## Own server instead
    cp .env.example .env   # set PUBLIC_URL to your https address
    npm install && npm start
