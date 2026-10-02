# Login codes emailed to HR (Google Apps Script)

Anyone who signs in to the HR Tool with Google gets a 6-digit code emailed to **hr@alcoverealty.in**.
They can open the portal only after HR gives them the code. No server access needed — Google runs it.

## Set it up (about 5 minutes, signed in as hr@alcoverealty.in)
1. Go to **https://script.google.com** → **New project**. Name it `HR Tool login codes`.
2. Delete what's in `Code.gs` and paste in everything from this folder's `Code.gs`. Click **Save**.
3. In the function list at the top choose **testEmail** → **Run** → **Review permissions** → choose
   hr@alcoverealty.in → **Allow**. A test email arrives in the HR inbox.
4. **Deploy → New deployment** → gear icon → **Web app**:
   - Description: `HR Tool login`
   - Execute as: **Me (hr@alcoverealty.in)**
   - Who has access: **Anyone**
   → **Deploy** → copy the **Web app URL** (ends in `/exec`).
5. Send that URL to whoever builds the portal (or paste it into `build/otp-api.txt`, rebuild, and
   upload the new `index.html`).

## Using it
- A person opens the portal → **Sign in with Google** → HR gets an email
  "HR Tool login code 123456 — person@example.com".
- HR gives the code only to people they approve. The code works for 10 minutes, once, with 5 tries.
- A sign-in lasts 12 hours. **Log out** is in the portal's sidebar.

## Changing it later
Edit `Code.gs` in script.google.com, then **Deploy → Manage deployments → ✏️ → Version: New version
→ Deploy**. The URL stays the same.
