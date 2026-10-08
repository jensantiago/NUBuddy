# NU Buddy

NU Buddy is a static HTML/CSS/JavaScript campus facility-reporting portal backed by Supabase Authentication, PostgreSQL, Row Level Security, and private Supabase Storage. The interface keeps the existing blue-and-gold layout and does not need a frontend build step.

## Supabase setup

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard). Keep the database password and any service-role/secret keys out of this repository and browser code.
2. In the Supabase SQL Editor, run [`supabase/migrations/20261008000000_nu_buddy_backend.sql`](supabase/migrations/20261008000000_nu_buddy_backend.sql) in full. It creates the tables, constraints, indexes, triggers, RLS policies, approval/status RPCs, and the private `report-photos` bucket.
3. In **Authentication → Providers → Email**, keep email/password enabled and turn on email confirmations. Customize the confirmation and recovery templates if needed.
4. In **Authentication → URL Configuration**, set the local Site URL to `http://localhost:8000` and add `http://localhost:8000/**` to the redirect allow list. Add the deployed site origin and its redirect pattern before deploying.
5. The supplied project URL and **publishable** key are already configured in [`js/config.js`](js/config.js). For a different Supabase project, copy its Project URL and publishable key (the legacy `anon` key is also publishable) from **Project Settings → API** and replace those values. These are the only Supabase values permitted in browser code. Never use a service-role or secret key here.

### First Facilities administrator

There is intentionally no browser-side account creation or role assignment for administrators. Register through the app using an authorized `@admin.nu.edu.ph` mailbox and verify its email. A trusted project owner must then approve the first administrator once in the SQL Editor:

```sql
update public.profiles p
set account_status = 'approved'
from auth.users u
where p.user_id = u.id
	and p.school_email = lower('authorized.person@admin.nu.edu.ph')
	and p.role = 'facility_admin'
	and u.email_confirmed_at is not null;
```

Replace the example with the authorized mailbox. After this bootstrap, approved Facilities administrators can approve or reject pending staff and guard accounts in the app. They cannot approve themselves. New student accounts are eligible after email verification; staff and guards remain pending until an administrator approves them.

## Run locally

From this project folder, run:

```powershell
py -m http.server 8000
```

Then open `http://localhost:8000`. Alternatively, use VS Code Live Server and add its exact local URL to Supabase's redirect allow list. Opening `index.html` as a `file://` URL is not supported because browser modules and Supabase Auth redirects require HTTP.

## Deploy

Deploy the project folder as a static site to any HTTPS static host (for example, Netlify, Cloudflare Pages, or GitHub Pages). Set the Supabase Auth Site URL and redirect allow list to the deployed HTTPS origin, and update `js/config.js` with the same project's URL and publishable key. No server-side secret is needed for the implemented flows; database authorization is enforced by RLS and narrowly scoped PostgreSQL functions.

## Implemented

- Supabase sign-up, sign-in, email confirmation, password recovery, password change, session persistence, and logout.
- Account roles are derived from verified Auth emails: `@students.nu.edu.ph` → student, `@admin.nu.edu.ph` → Facilities admin, and `@guard.nu.edu.ph` → security guard. The only temporary personal-email exception is the exact address `santiagojenina683@gmail.com`, mapped to a pending Facilities admin account; other Gmail and personal addresses are rejected. Remove this exception before production use.
- Student report submission, private photo upload, report lists/details/search/filtering, status history, notifications, read state, and Philippine-time timestamps.
- Approved staff report queues, status changes, notifications, and staff approval/rejection. Guards can change status only for Safety / Security, Locked Classroom, and Electrical Problem reports; Facilities administrators can update all reports.
- Dashboard totals computed from rows visible under RLS. Pending means Submitted only; Active means Under Review or In Progress; Open excludes only Resolved.
- Greetings use `Asia/Manila` and refresh while a dashboard remains open. Theme choice is the only app data persisted in browser local storage.

## Security and limitations

Email confirmation proves control of a mailbox; it does not independently verify enrollment, employment, or eligibility in NU's records. This project has no connection to a registrar/staff directory, so domain access is enforced and staff eligibility is handled through administrator approval. Confirm the allowed domains and approval process with the university before production use.

The supplied project credentials are configured, and its Supabase Auth health endpoint responded successfully. The database migration is **not applied**: a read-only request for `public.profiles` returned `PGRST205` (table absent from the schema cache). Run the SQL migration above in the Supabase SQL Editor before attempting registration or reports. Sign-up, email delivery, RLS with separate accounts, storage access, approval flows, and report operations still need testing in that project. Supabase email provider limits and deliverability depend on your project configuration.

Uploaded images use signed URLs that expire after one hour; the app obtains fresh URLs when report data is loaded. Private bucket access is enforced by Storage policies. SQL Editor bootstrap and migration execution require a trusted project owner; the browser does not receive elevated credentials.
