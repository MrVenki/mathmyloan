# MathMyLoan

SEO-first static site comparing loan rates, fees and EMI across Indian banks. Generated from `data/products.json`; the site itself has no runtime dependencies.

```bash
npm test         # data rules, scraper rules, EMI maths
npm run build    # writes dist/
npm run scrape   # reads every bank's official rate page and writes data/drafts.json (no AI)
```

## The accuracy rule (important)
A rate is published only if it has an official `https` source URL, a `retrievedOn` date within `maxAgeDays` (90), a sane starting rate, and is not flagged `review`. Anything else is hidden at build time and logged. Pages always show the source link and check date, and say the figure is a *starting* rate.

## Pages generated per verified product
- `/{loan}/` hub with a bank-picker comparison tool and rate table
- `/{loan}/{bank}/` bank page (rate, fee, prepayment, tenure, FAQ, EMI links)
- `/{loan}/{bank}/emi-{amount}-lakh-{years}-years/` EMI at the starting rate and at +0.5 to +2 points
- `/{loan}/{a}-vs-{b}/` for every pair of verified banks in a loan type
- `/{loan}-emi-calculator/`, home, about, privacy, sitemap, robots, IndexNow key

## Rate scraper and admin (how rates get updated)
1. **Sources** (`data/sources.json`): official bank pages. `loan: "*"` means "every loan this page lists". `render: true` reads the page in headless Chrome, `manual: true` marks a rate checked by hand, and `base` + `plus` work out a rate the bank states as a margin over another of its loans.
2. **Scraper** (`src/scrape/`, `npm run scrape`): fetches each page (plain HTTP, headless Chrome for script-driven or bot-protected pages, PDF text for rate sheets) and finds each loan's rate with no AI:
   - a learned rule: the exact line where the approved rate was last seen (numbers blanked), so the next run reads the new number from the same place;
   - otherwise the approved rate itself, if it is still on the page (and a rule is learned from it);
   - otherwise keyword rules: lines about that loan type, lowest plausible rate, ignoring benchmarks, spreads, fees and penal rates.
   The scraper identifies itself (`MathMyLoanBot`) and respects refusals: a page that denies automated access or shows a bot check is reported as "could not read", so you check that bank by hand.
   Results go to `data/drafts.json` as *same*, *changed*, *check carefully*, *new*, *could not read* or *check by hand*. Live rates never change here.
3. **Email**: when there is something new to review, a summary goes to `MAIL_TO` with a link to the admin page.
4. **Admin** (`/admin/`, not indexed): review each draft with the page text it came from, edit the rate, conditions, fee, prepayment and tenure, then approve or reject. "Confirm unchanged rates" refreshes the check date of every rate that was found unchanged. Rates, Banks and Sources tabs edit everything directly. "Publish to site" commits the changed files in one commit, which rebuilds the site in about two minutes.
5. **New bank**: add it in Admin → Banks, then its rate pages in Sources (or run `node scripts/discover-sources.mjs <slug> <homepage>` to find them), then run the scraper.

### Running it
- **GitHub**: `.github/workflows/scrape.yml` runs daily at 06:00 IST and on demand (Admin → Scraper → Run, or the Actions tab). It commits only `data/drafts.json` and `data/scrape-rules.json`.
- **Your computer**: `npm ci`, then `npm run scrape` (add `-- --push` to commit and push the drafts, `-- --bank sbi` for one bank). Needs Google Chrome installed for script-driven pages.

### Setup
- **Admin sign-in**: a GitHub fine-grained token for this repository with *Contents: read and write* and *Actions: read and write* (GitHub → Settings → Developer settings → Fine-grained tokens). The token stays in your browser.
- **Email**: repository secrets `SMTP_USER`, `SMTP_PASS`, `MAIL_TO` (and optionally `SMTP_HOST`, default smtp.gmail.com, and `SMTP_PORT`, default 465). With Gmail, `SMTP_PASS` is an app password (Google Account → Security → 2-Step Verification → App passwords). For local runs put the same keys in a `.env` file (git-ignored).

## Adding data by hand
Add an entry to `data/products.json` copied from the bank's official page, with `sourceUrl` and `retrievedOn`, or use the admin Rates tab.

## One-time setup
1. Domain: set `siteUrl` and `basePath: ""` in `config.json`, add a `CNAME` file in the Pages settings, and add the origin to the worker's `SITE_ORIGIN` (comma separated).
2. `contactEmail` in `config.json` (shown in the privacy policy).
3. Pages source: GitHub Actions. Add the site to Google Search Console and submit `sitemap.xml`.
4. Redeploy the lead worker (`DealAgents/worker`, `npx wrangler deploy`) so `/lead` accepts bank and loan fields.
5. Sign a DSA or lead-partner agreement before forwarding leads to any bank.
