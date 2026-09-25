This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.



# Family Emergency Fund Web Platform Architecture Specification

## Project Intent & Overview
A web platform replacing legacy spreadsheets for managing a Family Emergency Fund (KES 300 monthly target per member, M-PESA Buy Goods Till 1611383, August–July Financial Year). Access relies on zero-login personalized links (`/?member=<slug>`).

## Technical Stack
- **Frontend & Server Actions**: Next.js (App Router, React 19, TypeScript, Tailwind CSS)
- **Database Backend**: Supabase (PostgreSQL with RLS disabled for app logic)
- **Deployment Platform**: Vercel

## Database Schema (PostgreSQL)
1. `members`: `id` (UUID PK), `full_name` (TEXT), `slug` (TEXT UNIQUE)
2. `member_phones`: `id` (UUID PK), `member_id` (FK members), `phone_number` (TEXT UNIQUE)
3. `ledger_entries`: `id` (UUID PK), `member_id` (FK members), `month_year` (DATE), `amount_paid` (DECIMAL), `target_amount` (DECIMAL default 300)
4. `message_board`: `id` (UUID PK), `sender_name` (TEXT), `content` (TEXT), `is_private` (BOOLEAN), `created_at` (TIMESTAMP)

## Financial Logic Rules
- **Financial Year Structure**: Runs August 1 through July 31 (e.g., FY 2026/2027 = Aug 2026 – Jul 2027).
- **Previous Year Roll-over**: Calculated dynamically by summing all contributions prior to the current selected FY start year.
- **Member Joining Logic**: Balances evaluate starting from the member's creation/joining month.

## Key Feature Specification
1. **Zero-Login Authentication**: URL slug (`?member=esther-nakhanu`) automatically maps personal stats and pre-fills identity on message posts.
2. **Master Ledger Table**: Features monthly columns (Aug-Jul), Carried Over totals, FY Total, and All-Time Contribution Total.
3. **Admin Dashboard Toggle**: Inline numerical editing for monthly balances and dynamic member onboarding.
4. **M-PESA Integration**: Free USSD action links (`tel:*334#`) placed directly in footer columns for instant payment execution.
5. **Community Board**: Supports public entries and private admin communication filters.