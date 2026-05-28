# EPR Category + Fee Estimator with AI Verification

This is the combined EPR category classifier and fee estimator, upgraded with a server-side AI category verification endpoint.

## What changed

- The main app remains `index.html`.
- Low-confidence or multi-material classifier results show an **AI category check** box.
- The browser calls `/api/classify`.
- `/api/classify.js` calls the OpenAI API from the server so the API key is not exposed in browser code.

## Local setup

1. Install the Vercel CLI if needed:

   ```bash
   npm i -g vercel
   ```

2. Copy `.env.example` to `.env.local` and add your key:

   ```bash
   cp .env.example .env.local
   ```

3. Run locally:

   ```bash
   vercel dev
   ```

4. Open the local URL shown by Vercel.

Do not open `index.html` directly from your file system if you want AI verification. The static app will still work, but `/api/classify` will not exist.

## Vercel deployment

1. Import this folder into a Vercel project.
2. Add `OPENAI_API_KEY` as a Vercel Environment Variable.
3. Optional: add `OPENAI_MODEL` if you want to use a different model.
4. Deploy.

## Safety / use limits

The AI feature is a review assistant only. The workbook categories and published fee schedules remain the source of truth. Estimated states and mapped assumptions are for planning only, not compliance invoices, accruals, customer-facing claims, or supplier chargebacks.
