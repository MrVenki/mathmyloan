# Loan Compare India

SEO-first static site comparing loan rates, fees and EMI across Indian banks, for home, personal, car, education and property loans. Generated from `data/products.json`; zero dependencies.

```bash
npm test         # data rules, collector validation, EMI maths
npm run build    # writes dist/
npm run collect  # collector agent (needs ANTHROPIC_API_KEY)
```

## The accuracy rule (important)
A rate is published only if it has an official `https` source URL, a `retrievedOn` date within `maxAgeDays` (90), a sane starting rate, and is not flagged `review`. Anything else is hidden at build time and logged. Pages always show the source link and check date, and say the figure is a *starting* rate.

## Pages generated per verified product
- `/{loan}/` hub with a bank-picker comparison tool and rate table
- `/{loan}/{bank}/` bank page (rate, fee, prepayment, tenure, FAQ, EMI links)
- `/{loan}/{bank}/emi-{amount}-lakh-{years}-years/` EMI at the starting rate and at +0.5 to +2 points
- `/{loan}/{a}-vs-{b}/` for every pair of verified banks in a loan type
- `/{loan}-emi-calculator/`, home, about, privacy, sitemap, robots, IndexNow key

## Adding data
- **By hand:** add an entry to `data/products.json` copied from the bank's official page, with `sourceUrl` and `retrievedOn`.
- **By agent:** add `{bank, loan, url}` to `data/sources.json`. The weekly job fetches the page, asks Claude (Haiku) to extract terms with exact quotes, and keeps a value only if its quote appears verbatim in the page. A rate move over 0.5 points is saved with `review: true` (hidden) and sent to you on Telegram.

## One-time setup
1. Domain: buy one, set `siteUrl` and `basePath: ""` in `config.json`, add a `CNAME` file in the Pages settings, and add the new origin to the worker's `SITE_ORIGIN` (comma separated).
2. `contactEmail` in `config.json` (shown in the privacy policy).
3. Repo secrets: `ANTHROPIC_API_KEY` (collector), `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (alerts).
4. Pages source: GitHub Actions. Add the site to Google Search Console and submit `sitemap.xml`.
5. Redeploy the lead worker (`DealAgents/worker`, `npx wrangler deploy`) so `/lead` accepts bank and loan fields.
6. Sign a DSA or lead-partner agreement before forwarding leads to any bank.
