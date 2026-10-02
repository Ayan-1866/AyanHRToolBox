/**
 * Alcove HR Tool — login approval by email code (OTP).
 *
 * Anyone who signs in to the HR Tool with Google gets a 6-digit code emailed to HR_EMAIL.
 * They can only open the portal after HR gives them that code.
 *
 * Deploy (as hr@alcoverealty.in): Deploy → New deployment → Web app
 *   Execute as: Me    Who has access: Anyone
 * Then paste the Web app URL into build/otp-api.txt and rebuild the portal.
 */
const HR_EMAIL = "hr@alcoverealty.in";
const CLIENT_ID = "806459433972-nu3ab2cje78au731potll9bfu8pdv0pb.apps.googleusercontent.com";
const CODE_MINUTES = 10;   // a code works for 10 minutes
const MAX_TRIES = 5;       // wrong guesses allowed per code
const SESSION_HOURS = 12;  // how long a sign-in lasts

function doGet() {
  return out({ ok: true, service: "alcove-hr-otp" });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return out({ error: "Bad request." }); }
  try {
    if (req.action === "request") return out(requestCode(req.idToken));
    if (req.action === "verify") return out(verifyCode(req.idToken, String(req.code || "")));
    if (req.action === "check") return out(checkSession(String(req.session || "")));
    return out({ error: "Unknown request." });
  } catch (err) {
    return out({ error: String((err && err.message) || err) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* Google checks the sign-in token for us: right app, verified email, not expired. */
function identity(idToken) {
  if (!idToken) throw new Error("Sign in with Google first.");
  const r = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
    { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error("Your Google sign-in has expired. Sign in again.");
  const t = JSON.parse(r.getContentText());
  if (t.aud !== CLIENT_ID || String(t.email_verified) !== "true" || Number(t.exp) * 1000 < Date.now()) {
    throw new Error("That Google sign-in couldn't be verified. Sign in again.");
  }
  return { email: String(t.email).toLowerCase(), name: t.name || "" };
}

function secret() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty("SECRET");
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty("SECRET", s); }
  return s;
}
function hex(bytes) { return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, "0"); }).join(""); }
function sha(s) { return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)); }
function sign(s) { return hex(Utilities.computeHmacSha256Signature(s, secret())); }

function requestCode(idToken) {
  const who = identity(idToken);
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let code;
  try {
    if (cache.get("gap:" + who.email)) return { error: "A code was just sent to HR. Wait a minute before asking again." };
    const n = Number(cache.get("hour:" + who.email) || 0);
    if (n >= 6) return { error: "Too many requests. Try again in an hour." };
    code = String(parseInt(Utilities.getUuid().replace(/-/g, "").slice(0, 12), 16) % 1000000).padStart(6, "0");
    const salt = Utilities.getUuid();
    cache.put("otp:" + who.email, JSON.stringify({ h: sha(salt + code), s: salt, t: 0 }), CODE_MINUTES * 60);
    cache.put("gap:" + who.email, "1", 60);
    cache.put("hour:" + who.email, String(n + 1), 3600);
  } finally {
    lock.releaseLock();
  }
  const when = Utilities.formatDate(new Date(), "Asia/Kolkata", "d MMM yyyy, h:mm a");
  const person = (who.name ? who.name + " (" + who.email + ")" : who.email);
  MailApp.sendEmail({
    to: HR_EMAIL,
    name: "Alcove HR Tool",
    subject: "HR Tool login code " + code + " — " + who.email,
    body: person + " wants to open the Alcove HR Tool (" + when + ").\n\nTheir login code: " + code +
      "\n\nOnly give them this code if you approve. It expires in " + CODE_MINUTES + " minutes.\n" +
      "If you don't recognise this request, ignore this email — they can't get in without the code.",
    htmlBody: '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:460px;padding:22px;border:1px solid #e0e7f0;border-radius:12px">' +
      '<div style="color:#204768;font-weight:600;letter-spacing:.1em;font-size:12px;text-transform:uppercase">Alcove HR Tool · Login request</div>' +
      '<p style="color:#16304d;font-size:15px"><b>' + esc(person) + '</b> wants to open the HR Tool<br><span style="color:#5d6e84;font-size:13px">' + when + '</span></p>' +
      '<p style="color:#16304d;font-size:14px;margin:0 0 6px">Their login code:</p>' +
      '<div style="font-size:32px;font-weight:700;letter-spacing:.3em;color:#16304d;background:#f3f6fa;border-radius:10px;padding:12px 0;text-align:center">' + code + '</div>' +
      '<p style="color:#5d6e84;font-size:13px">Only give them this code if you approve. It expires in ' + CODE_MINUTES + ' minutes. ' +
      "If you don't recognise this request, ignore this email — they can't get in without the code.</p></div>"
  });
  return { ok: true, to: HR_EMAIL };
}

function verifyCode(idToken, code) {
  const who = identity(idToken);
  code = code.replace(/\D/g, "");
  if (code.length !== 6) return { error: "Enter the 6-digit code." };
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const raw = cache.get("otp:" + who.email);
    if (!raw) return { error: "That code has expired or was already used. Ask for a new one." };
    const rec = JSON.parse(raw);
    rec.t += 1;
    if (rec.t > MAX_TRIES) { cache.remove("otp:" + who.email); return { error: "Too many wrong tries. Ask for a new code." }; }
    if (sha(rec.s + code) !== rec.h) {
      cache.put("otp:" + who.email, JSON.stringify(rec), CODE_MINUTES * 60);
      const left = MAX_TRIES - rec.t;
      return { error: "Wrong code. " + left + (left === 1 ? " try" : " tries") + " left." };
    }
    cache.remove("otp:" + who.email);
  } finally {
    lock.releaseLock();
  }
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = who.email + "|" + exp;
  return { ok: true, session: payload + "|" + sign(payload), email: who.email, exp: exp };
}

function checkSession(session) {
  const parts = session.split("|");
  if (parts.length !== 3) return { ok: false };
  const payload = parts[0] + "|" + parts[1];
  if (sign(payload) !== parts[2] || Number(parts[1]) < Date.now()) return { ok: false };
  return { ok: true, email: parts[0], exp: Number(parts[1]) };
}

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

/* Run this once from the editor (select it → Run) to grant the email permission and test sending. */
function testEmail() {
  MailApp.sendEmail(HR_EMAIL, "HR Tool login codes are set up", "This is a test from the HR Tool login service.");
}
