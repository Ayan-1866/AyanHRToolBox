# Email OTP login for the HR Tool

Locks `https://employees.alcoverealty.in/p/hr-tool-box/`. Visitors get a sign-in page, a 6-digit
code is emailed from Gmail to the allowed address, and the portal opens after the code is entered.
A sign-in lasts 12 hours (`SESSION_HOURS`). Needs Python 3.8+ on the server — nothing else to install.

## 1. Gmail app password
On the Google account that will send the codes (e.g. hr@alcoverealty.in):
Google Account → Security → turn on **2-Step Verification** → **App passwords** → create one named
"HR Tool OTP". Copy the 16-letter password.

## 2. Install the gate (on the server)
```
sudo mkdir -p /opt/hr-otp-gate
sudo cp otp_gate.py /opt/hr-otp-gate/
sudo cp hr-otp-gate.env.example /etc/hr-otp-gate.env
sudo nano /etc/hr-otp-gate.env        # fill GMAIL_USER, GMAIL_APP_PASSWORD, ALLOWED_EMAILS, SESSION_SECRET
sudo chmod 600 /etc/hr-otp-gate.env
sudo cp hr-otp-gate.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now hr-otp-gate
curl -s http://127.0.0.1:8090/auth/health   # should print: ok
```
`SESSION_SECRET`: run `openssl rand -hex 32` and paste the result.

## 3. Put it in front of the portal
The site answers with both Caddy and nginx headers — add the rules to whichever serves
`/p/hr-tool-box/` (usually the outer one):
- **Caddy:** add `Caddyfile.snippet` to the `employees.alcoverealty.in { … }` block, then `sudo systemctl reload caddy`
- **nginx:** add `nginx.snippet.conf` to the matching `server { … }` block, then `sudo nginx -t && sudo systemctl reload nginx`

## 4. Check
Open `https://employees.alcoverealty.in/p/hr-tool-box/` in a private window → you should land on
"Sign in". Click **Send code**, enter the code from the email → the HR Tool opens.
Logs: `journalctl -u hr-otp-gate -f` (codes are never written to the log).

## Safety built in
Codes expire after 10 minutes, work once, and lock after 5 wrong tries; at most one code a minute
and 6 an hour per address. Sign-ins are signed cookies (HttpOnly, Secure, SameSite). Only addresses
in `ALLOWED_EMAILS` can receive a code.
