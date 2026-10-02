#!/usr/bin/env python3
"""
Alcove HR Tool - email OTP gate.

Runs next to the web server (Caddy or nginx). Before the portal is served, the web server asks
/auth/check whether the visitor has a valid session cookie. If not, the visitor is sent to
/auth/login, where a 6-digit code is emailed (via Gmail) to an allowed address. Entering the code
sets a signed session cookie and opens the portal.

Standard library only. Configure with environment variables (see hr-otp-gate.env.example).
"""
import hashlib
import hmac
import html
import json
import os
import secrets
import smtplib
import ssl
import threading
import time
from email.message import EmailMessage
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlsplit

# ---------- configuration ----------
GMAIL_USER = os.environ.get("GMAIL_USER", "")                     # sender Gmail / Google Workspace address
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "")
ALLOWED = [e.strip().lower() for e in os.environ.get("ALLOWED_EMAILS", "hr@alcoverealty.in").split(",") if e.strip()]
PROTECT_PREFIX = os.environ.get("PROTECT_PREFIX", "/p/hr-tool-box/")
BIND = os.environ.get("BIND", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8090"))
SESSION_HOURS = float(os.environ.get("SESSION_HOURS", "12"))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "1") != "0"
SECRET = os.environ.get("SESSION_SECRET", "").encode() or secrets.token_bytes(32)  # set it so restarts keep sessions
DEV_PRINT_CODES = os.environ.get("DEV_PRINT_CODES") == "1"         # testing only: print codes instead of emailing

CODE_TTL = 10 * 60          # a code is valid for 10 minutes
MAX_TRIES = 5               # wrong guesses allowed per code
RESEND_GAP = 60             # seconds between codes for one address
MAX_CODES_PER_HOUR = 6      # per address
MAX_SENDS_PER_IP_HOUR = 20
COOKIE = "hrtb_session"

_lock = threading.Lock()
_codes = {}                 # email -> {"hash", "salt", "exp", "tries"}
_sent = {}                  # email -> [timestamps]
_ip_sent = {}               # ip -> [timestamps]


# ---------- sessions: signed cookie "email|expiry|nonce|signature" ----------
def _sign(payload: str) -> str:
    return hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()


def make_session(email: str) -> str:
    payload = f"{email}|{int(time.time() + SESSION_HOURS * 3600)}|{secrets.token_hex(8)}"
    return payload + "|" + _sign(payload)


def session_email(value: str):
    try:
        email, exp, nonce, sig = value.split("|")
    except (AttributeError, ValueError):
        return None
    if not hmac.compare_digest(sig, _sign(f"{email}|{exp}|{nonce}")):
        return None
    if int(exp) < time.time() or email not in ALLOWED:
        return None
    return email


# ---------- one-time codes ----------
def _recent(stamps, window):
    now = time.time()
    return [t for t in stamps if now - t < window]


def issue_code(email: str, ip: str):
    """Returns (code, None) or (None, reason)."""
    now = time.time()
    with _lock:
        sent = _recent(_sent.get(email, []), 3600)
        ip_sent = _recent(_ip_sent.get(ip, []), 3600)
        if sent and now - sent[-1] < RESEND_GAP:
            return None, f"Please wait {max(1, round(RESEND_GAP - (now - sent[-1])))} seconds before asking for another code."
        if len(sent) >= MAX_CODES_PER_HOUR or len(ip_sent) >= MAX_SENDS_PER_IP_HOUR:
            return None, "Too many codes requested. Try again in an hour."
        code = f"{secrets.randbelow(10**6):06d}"
        salt = secrets.token_hex(8)
        _codes[email] = {"hash": hashlib.sha256((salt + code).encode()).hexdigest(), "salt": salt,
                         "exp": now + CODE_TTL, "tries": 0}
        _sent[email] = sent + [now]
        _ip_sent[ip] = ip_sent + [now]
    return code, None


def check_code(email: str, code: str):
    """Returns (True, None) or (False, reason)."""
    with _lock:
        rec = _codes.get(email)
        if not rec or rec["exp"] < time.time():
            _codes.pop(email, None)
            return False, "That code has expired or was already used. Ask for a new one."
        rec["tries"] += 1
        if rec["tries"] > MAX_TRIES:
            _codes.pop(email, None)
            return False, "Too many wrong tries. Ask for a new code."
        good = hmac.compare_digest(rec["hash"], hashlib.sha256((rec["salt"] + code).encode()).hexdigest())
        if good:
            _codes.pop(email, None)
            return True, None
        left = MAX_TRIES - rec["tries"]
        return False, f"Wrong code. {left} {'try' if left == 1 else 'tries'} left."


def send_code_email(to: str, code: str):
    if DEV_PRINT_CODES:
        print(f"[dev] code for {to}: {code}", flush=True)
        return
    msg = EmailMessage()
    msg["Subject"] = f"{code} is your Alcove HR Tool login code"
    msg["From"] = f"Alcove HR Tool <{GMAIL_USER}>"
    msg["To"] = to
    msg.set_content(f"Your Alcove HR Tool login code is {code}\n\nIt expires in 10 minutes. "
                    "If you didn't try to open the HR Tool, you can ignore this email.\n")
    msg.add_alternative(f"""<div style="font-family:Segoe UI,Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #e0e7f0;border-radius:12px">
<div style="color:#204768;font-weight:600;letter-spacing:.1em;font-size:12px;text-transform:uppercase">Alcove HR Tool</div>
<p style="color:#16304d;font-size:15px">Your login code is</p>
<div style="font-size:34px;font-weight:700;letter-spacing:.3em;color:#16304d;background:#f3f6fa;border-radius:10px;padding:14px 0;text-align:center">{code}</div>
<p style="color:#5d6e84;font-size:13px">It expires in 10 minutes. If you didn't try to open the HR Tool, you can ignore this email.</p></div>""",
                        subtype="html")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=20) as s:
        s.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        s.send_message(msg)


def mask(email: str) -> str:
    name, _, domain = email.partition("@")
    return (name[:2] + "•" * max(1, len(name) - 2)) + "@" + domain


# ---------- login page ----------
LOGIN_PAGE = """<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — Alcove HR Tool</title>
<style>
:root{--navy:#204768;--ink:#16304d;--muted:#5d6e84;--line:#e0e7f0;--bg:#f3f6fa;--card:#fff;--err:#b3261e;--ok:#1f7a3a;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--ink:#e3eaf3;--muted:#98a9bf;--line:#243a52;--bg:#0c1724;--card:#132233;--err:#f2867e;--ok:#6fcf8f;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 "Segoe UI",system-ui,Arial,sans-serif;padding:16px}
.card{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px;box-shadow:0 10px 30px rgba(16,40,70,.08)}
.bar{height:4px;border-radius:4px;background:linear-gradient(90deg,#204768,#EFCC25);margin:-28px -28px 22px;border-radius:16px 16px 0 0}
.k{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#b8862b;font-weight:600}
h1{font-size:22px;margin:6px 0 6px}p{margin:0 0 16px;color:var(--muted)}
label{display:block;font-size:13px;font-weight:600;margin-bottom:4px}
input{width:100%;font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink)}
input#code{font-size:26px;letter-spacing:.4em;text-align:center;font-weight:700}
input:focus{outline:2px solid #204768;outline-offset:1px}
button{width:100%;margin-top:14px;font:600 15px/1.2 "Segoe UI",system-ui,Arial,sans-serif;padding:12px;border-radius:9px;border:0;background:#204768;color:#fff;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}.link{background:none;color:var(--muted);font-weight:500;margin-top:8px;padding:6px}
#msg{min-height:22px;font-size:14px;margin-top:12px}#msg.err{color:var(--err)}#msg.ok{color:var(--ok)}
[hidden]{display:none!important}
</style></head><body><main class="card"><div class="bar"></div>
<div class="k">Alcove HR Tool</div><h1>Sign in</h1>
<form id="f1"><p>We'll email a 6-digit code to <b>__TARGET__</b>.</p>__EMAIL_FIELD__<button id="send" type="submit">Send code</button></form>
<form id="f2" hidden><p>Enter the code we sent to <b id="sentTo"></b>. It expires in 10 minutes.</p>
<label for="code">Code</label><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
<button id="go" type="submit">Open the HR Tool</button><button class="link" id="again" type="button">Send a new code</button></form>
<div id="msg" role="status" aria-live="polite"></div></main>
<script>
const $=id=>document.getElementById(id),NEXT=__NEXT__,FIXED=__FIXED__;
function say(t,c){$("msg").textContent=t;$("msg").className=c||"";}
async function post(u,b){const r=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b),credentials:"same-origin"});let j={};try{j=await r.json();}catch(e){}return{ok:r.ok,...j};}
const email=()=>FIXED||($("email")&&$("email").value.trim().toLowerCase());
async function send(){const b=$("send");b.disabled=true;$("again").disabled=true;say("Sending…");
  const r=await post("/auth/send",{email:email()});b.disabled=false;$("again").disabled=false;
  if(!r.ok){say(r.error||"Couldn't send the code.","err");return;}
  $("sentTo").textContent=r.to;$("f1").hidden=true;$("f2").hidden=false;$("code").value="";$("code").focus();say("Code sent — check your inbox.","ok");}
$("f1").onsubmit=e=>{e.preventDefault();send();};$("again").onclick=send;
$("code").addEventListener("input",()=>{$("code").value=$("code").value.replace(/\\D/g,"").slice(0,6);if($("code").value.length===6)$("f2").requestSubmit();});
$("f2").onsubmit=async e=>{e.preventDefault();const b=$("go");b.disabled=true;say("Checking…");
  const r=await post("/auth/verify",{email:email(),code:$("code").value});b.disabled=false;
  if(r.ok){say("Signed in.","ok");location.replace(NEXT);}else{say(r.error||"That code didn't work.","err");$("code").select();}};
</script></body></html>"""


def safe_next(n: str) -> str:
    # only allow going back into the protected portal on this site
    if n and n.startswith(PROTECT_PREFIX) and "//" not in n and "\\" not in n:
        return n
    return PROTECT_PREFIX


class Handler(BaseHTTPRequestHandler):
    server_version = "AlcoveOTP/1.0"

    def log_message(self, fmt, *args):  # keep logs short; codes are never logged
        print("%s %s" % (self.client_ip(), fmt % args), flush=True)

    def client_ip(self):
        fwd = self.headers.get("X-Forwarded-For", "") or self.headers.get("X-Real-IP", "")
        return fwd.split(",")[0].strip() or self.client_address[0]

    def cookie_email(self):
        c = cookies.SimpleCookie()
        try:
            c.load(self.headers.get("Cookie", ""))
        except cookies.CookieError:
            return None
        return session_email(c[COOKIE].value) if COOKIE in c else None

    def reply(self, status, body=b"", ctype="text/plain; charset=utf-8", headers=None):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def json(self, status, obj, headers=None):
        self.reply(status, json.dumps(obj), "application/json", headers)

    # ----- routes -----
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == "/auth/check":
            if self.cookie_email():
                return self.reply(204)
            # nginx auth_request wants 401; Caddy forward_auth passes this redirect straight to the browser
            if self.headers.get("X-Auth-Mode") == "nginx":
                return self.reply(401)
            orig = self.headers.get("X-Forwarded-Uri") or self.headers.get("X-Original-URI") or PROTECT_PREFIX
            return self.reply(302, headers={"Location": "/auth/login?next=" + quote(safe_next(orig), safe="")})
        if url.path == "/auth/login":
            nxt = safe_next(parse_qs(url.query).get("next", [PROTECT_PREFIX])[0])
            if self.cookie_email():
                return self.reply(302, headers={"Location": nxt})
            single = ALLOWED[0] if len(ALLOWED) == 1 else ""
            page = (LOGIN_PAGE
                    .replace("__TARGET__", html.escape(mask(single)) if single else "your work email")
                    .replace("__EMAIL_FIELD__", "" if single else
                             '<label for="email">Work email</label><input id="email" type="email" autocomplete="email" required>')
                    .replace("__NEXT__", json.dumps(nxt))
                    .replace("__FIXED__", json.dumps(single)))
            return self.reply(200, page, "text/html; charset=utf-8",
                              {"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'"})
        if url.path == "/auth/logout":
            return self.reply(302, headers={"Location": "/auth/login",
                                            "Set-Cookie": f"{COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" + ("; Secure" if COOKIE_SECURE else "")})
        if url.path == "/auth/health":
            return self.reply(200, "ok")
        return self.reply(404, "not found")

    def do_POST(self):
        url = urlsplit(self.path)
        origin = self.headers.get("Origin")
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host", "")
        if origin and urlsplit(origin).netloc != host:
            return self.json(403, {"error": "Request blocked."})
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 4096)
            data = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self.json(400, {"error": "Bad request."})
        email = str(data.get("email") or (ALLOWED[0] if len(ALLOWED) == 1 else "")).strip().lower()

        if url.path == "/auth/send":
            if email not in ALLOWED:
                return self.json(403, {"error": "This email address isn't allowed to open the HR Tool."})
            code, why = issue_code(email, self.client_ip())
            if not code:
                return self.json(429, {"error": why})
            try:
                send_code_email(email, code)
            except Exception as e:  # noqa: BLE001 - report mail problems without leaking details
                print("mail error:", type(e).__name__, e, flush=True)
                with _lock:
                    _codes.pop(email, None)
                return self.json(502, {"error": "Couldn't send the email. Please tell IT to check the Gmail settings."})
            return self.json(200, {"ok": True, "to": mask(email)})

        if url.path == "/auth/verify":
            code = "".join(ch for ch in str(data.get("code", "")) if ch.isdigit())
            if email not in ALLOWED or len(code) != 6:
                return self.json(400, {"error": "Enter the 6-digit code."})
            good, why = check_code(email, code)
            if not good:
                return self.json(401, {"error": why})
            cookie = (f"{COOKIE}={make_session(email)}; Path=/; Max-Age={int(SESSION_HOURS * 3600)}; HttpOnly; SameSite=Lax"
                      + ("; Secure" if COOKIE_SECURE else ""))
            return self.json(200, {"ok": True}, {"Set-Cookie": cookie})

        return self.json(404, {"error": "not found"})


def main():
    if not DEV_PRINT_CODES and not (GMAIL_USER and GMAIL_APP_PASSWORD):
        raise SystemExit("Set GMAIL_USER and GMAIL_APP_PASSWORD (see hr-otp-gate.env.example).")
    if not os.environ.get("SESSION_SECRET"):
        print("note: SESSION_SECRET not set - everyone is signed out whenever this service restarts", flush=True)
    print(f"OTP gate on http://{BIND}:{PORT} protecting {PROTECT_PREFIX} for {', '.join(ALLOWED)}", flush=True)
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
