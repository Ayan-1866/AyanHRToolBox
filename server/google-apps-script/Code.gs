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

// Employee list for the portal (Birthday Cards etc.): the "HR Master Data [NEW]" sheet, tab gid 833875499.
// hr@alcoverealty.in needs view access to it. Only signed-in, HR-approved users get the list.
const EMPLOYEE_SHEET_ID = "1I1vJJy5vXDMysBvXkXREImNZORr6ko1OMvPoNo984RI";
const EMPLOYEE_TAB_GID = 833875499;

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
    if (req.action === "employees") {
      if (!checkSession(String(req.session || "")).ok) return out({ error: "Sign in again to load the employee list." });
      return out(employees());
    }
    if (req.action === "cvsearch" || req.action === "cvfile") {
      if (!checkSession(String(req.session || "")).ok) return out({ error: "Sign in again to read the HR mailbox." });
      if (req.action === "cvsearch") return out(cvSearch(String(req.q || ""), Number(req.start) || 0, Math.min(25, Number(req.max) || 25)));
      return out(cvFile(String(req.id || ""), Number(req.i), String(req.name || "")));
    }
    if (req.action === "master") {
      if (!checkSession(String(req.session || "")).ok) return out({ error: "Sign in again to open the Employee Master." });
      return out(master());
    }
    // a new joiner submits their Joining Kit from the public page (no sign-in)
    if (req.action === "submit") return out(submitKit(req));
    if (["subs", "subdata", "subpdf", "substatus"].indexOf(req.action) >= 0) {
      if (!checkSession(String(req.session || "")).ok) return out({ error: "Sign in again to see joining kit submissions." });
      if (req.action === "subs") return out(subList());
      if (req.action === "subdata") return out(subData(String(req.id || "")));
      if (req.action === "subpdf") return out(subPdf(String(req.id || "")));
      return out(subStatus(String(req.id || ""), String(req.status || "")));
    }
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

/* ---------- employee list ---------- */
const COLS = {
  name: /^((new |employee |emp |staff |full |candidate )?name|name of (the )?employee|employee full name)$/,
  code: /^((new )?emp(loyee)? ?(no|code|id|number)|emp code|staff (no|id)|e code)$/,
  desig: /^(designation|desig|job title|position)$/,
  dept: /^(department|dept)$/,
  loc: /^(location|work location|site|project|office)$/,
  dob: /^(dob|d o b|date of birth|birth ?date|birthday)$/,
  status: /^(status|employee status|emp status|active status)$/,
  doj: /^(doj|d o j|date of joining|joining date|date of join)$/,
  dol: /^(dol|d o l|date of leaving|leaving date|last working (day|date)|lwd|relieving date|date of exit|exit date|date of relieving)$/,
  addr: /^(address|present address|current address|residential address|correspondence address)$/,
  paddr: /^(permanent address)$/,
  emailO: /^(official email|official email id|official mail|office email|work email)$/,
  email: /^(email|e mail|email id|mail id|email address|personal email|personal email id)$/,
  phone: /^(phone|mobile|mobile no|mobile number|contact|contact no|contact number|phone no|phone number|whatsapp|whatsapp no)$/,
  mgr: /^(reporting manager|reporting to|manager|reporting head|reporting authority|reports to)$/,
  company: /^(company|company name|entity|organisation|organization|employer|legal entity)$/,
  gender: /^(gender|sex)$/
};
const INACTIVE = /inactive|left|resign|exit|abscond|terminat|relieved|separated/i;
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function headerKey(h) { return String(h).toLowerCase().replace(/[_.\-]+/g, " ").replace(/\s+/g, " ").trim(); }
function pad2(n) { return ("0" + n).slice(-2); }
function monthDay(v, tz) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz, "MM-dd");
  const s = String(v || "").trim(); let m;
  const ok = function (mo, d) { mo = +mo; d = +d; return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? pad2(mo) + "-" + pad2(d) : ""; };
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return ok(m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/))) return ok(m[2], m[1]);              // day first (Indian order)
  if ((m = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3,})[\s\-,]+\d{2,4}/))) return ok(MON.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, m[1]);
  return "";
}
function isoDate(v, tz) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz, "yyyy-MM-dd");
  const s = String(v || "").trim(); let m;
  const ok = function (y, mo, d) { y = +y; if (y < 100) y += y > 40 ? 1900 : 2000; mo = +mo; d = +d;
    return y > 1900 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? y + "-" + pad2(mo) + "-" + pad2(d) : ""; };
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return ok(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/))) return ok(m[3], m[2], m[1]);           // day first (Indian order)
  if ((m = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3,})[\s\-,]+(\d{2,4})/))) return ok(m[3], MON.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, m[1]);
  return "";
}
function employeeTab() {
  const ss = SpreadsheetApp.openById(EMPLOYEE_SHEET_ID);
  const tab = ss.getSheets().filter(function (s) { return s.getSheetId() === EMPLOYEE_TAB_GID; })[0];
  if (!tab) throw new Error("The employee tab wasn't found in HR Master Data.");
  return { ss: ss, tab: tab };
}
// the heading row is the first of the top 15 rows that has a name column
function findColumns(values) {
  for (let r = 0; r < Math.min(15, values.length); r++) {
    const cols = {};
    values[r].forEach(function (h, i) { const k = headerKey(h); Object.keys(COLS).forEach(function (f) { if (cols[f] === undefined && COLS[f].test(k)) cols[f] = i; }); });
    if (cols.name !== undefined) return { row: r, cols: cols };
  }
  throw new Error("Couldn't find a Name column in the employee tab.");
}
function employees() {
  const t = employeeTab(), tz = t.ss.getSpreadsheetTimeZone(), values = t.tab.getDataRange().getValues();
  const h = findColumns(values), c = h.cols, get = function (row, f) { return c[f] === undefined ? "" : String(row[c[f]] instanceof Date ? "" : row[c[f]]).trim(); };
  const date = function (row, f) { return c[f] === undefined ? "" : isoDate(row[c[f]], tz); };
  const list = []; let skipped = 0;
  for (let r = h.row + 1; r < values.length; r++) {
    const row = values[r], n = get(row, "name").replace(/\s+/g, " ");
    if (!n) continue;
    const st = get(row, "status"), active = !(c.status !== undefined && INACTIVE.test(st)) && !date(row, "dol");
    if (!active) skipped++;
    list.push({ n: n, c: get(row, "code"), g: get(row, "desig"), dept: get(row, "dept"), loc: get(row, "loc"), co: get(row, "company"),
      d: c.dob === undefined ? "" : monthDay(row[c.dob], tz), dob: date(row, "dob"), doj: date(row, "doj"), dol: date(row, "dol"),
      addr: (get(row, "addr") || get(row, "paddr")).replace(/\s*\n\s*/g, ", "), email: get(row, "emailO") || get(row, "email"),
      phone: get(row, "phone").replace(/\.0$/, ""), mgr: get(row, "mgr"), sex: get(row, "gender"), st: st, a: active });
  }
  return { ok: true, at: Date.now(), source: t.ss.getName() + " › " + t.tab.getName(), list: list, skipped: skipped,
    hasDob: c.dob !== undefined };
}
/* ---------- CV Inbox: reads the HR mailbox (this script runs as hr@alcoverealty.in), so it's always connected ---------- */
const CV_FILE = /\.(pdf|docx?|rtf)$/i;
function cvSearch(q, start, max) {
  if (!q) throw new Error("No search given.");
  const threads = GmailApp.search(q, start, max), list = [];
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      const atts = [];
      m.getAttachments({ includeInlineImages: false }).forEach(function (a, i) {
        if (CV_FILE.test(a.getName())) atts.push({ i: i, name: a.getName(), mime: a.getContentType(), size: a.getSize() });
      });
      if (!atts.length) return;
      list.push({ id: m.getId(), threadId: t.getId(), date: m.getDate().getTime(), from: m.getFrom(), subject: m.getSubject(),
        body: String(m.getPlainBody() || "").slice(0, 4000), atts: atts });
    });
  });
  return { ok: true, list: list, threads: threads.length, more: threads.length === max };
}
function cvFile(id, i, name) {
  const m = id && GmailApp.getMessageById(id);
  if (!m) throw new Error("That email wasn't found in the HR mailbox.");
  const all = m.getAttachments({ includeInlineImages: false });
  const a = (i >= 0 && all[i] && (!name || all[i].getName() === name)) ? all[i] : all.filter(function (x) { return x.getName() === name; })[0];
  if (!a) throw new Error("That attachment wasn't found.");
  if (a.getSize() > 15e6) throw new Error("This file is too large to open here — open it in Gmail.");
  return { ok: true, name: a.getName(), mime: a.getContentType(), data: Utilities.base64Encode(a.getBytes()) };
}
/* Run once from the editor to give the script read access to the HR mailbox (shows only a count). */
function testGmail() {
  const n = GmailApp.search("has:attachment newer_than:30d", 0, 50).length;
  Logger.log("HR mailbox readable: " + n + " email threads with attachments in the last 30 days (first 50 counted).");
}

/* Every column of the employee tab, as shown in the sheet, for the portal's Employee Master page. */
function master() {
  const t = employeeTab(), range = t.tab.getDataRange(), values = range.getValues(), shown = range.getDisplayValues();
  const tz = t.ss.getSpreadsheetTimeZone(), h = findColumns(values), c = h.cols;
  const width = shown[h.row].length, rows = [], active = [];
  for (let r = h.row + 1; r < shown.length; r++) {
    if (!String(shown[r][c.name] || "").trim()) continue;
    rows.push(shown[r].map(function (v) { return String(v).trim(); }));
    const st = c.status === undefined ? "" : String(values[r][c.status]);
    active.push(!(c.status !== undefined && INACTIVE.test(st)) && !(c.dol !== undefined && isoDate(values[r][c.dol], tz)));
  }
  // keep columns that have a heading or any data
  const keep = [];
  for (let i = 0; i < width; i++) {
    if (String(shown[h.row][i]).trim() || rows.some(function (row) { return row[i]; })) keep.push(i);
  }
  const map = {}; Object.keys(c).forEach(function (f) { const k = keep.indexOf(c[f]); if (k >= 0) map[f] = k; });
  return { ok: true, at: Date.now(), source: t.ss.getName() + " › " + t.tab.getName(),
    headers: keep.map(function (i) { return String(shown[h.row][i]).trim() || "Column " + (i + 1); }),
    rows: rows.map(function (row) { return keep.map(function (i) { return row[i]; }); }), active: active, cols: map };
}

/* ---------- Joining Kit submissions ----------
 * New joiners submit their kit from the public join.html page. Each one is saved in hr@'s Google Drive
 * (folder "Alcove Joining Kit Submissions": the PDF + the typed details as JSON), listed in the
 * "Joining Kit Submissions" sheet in that folder, and emailed to HR with the PDF attached.
 */
const SUB_FOLDER = "Alcove Joining Kit Submissions";
const SUB_MAX_MB = 30;          // largest kit accepted
const SUB_PER_HOUR = 40;        // overall cap, against abuse of the public form
const SUB_COLS = ["Received", "Name", "Mobile", "Email", "Date of joining", "Employee ID", "Status", "PDF", "ID", "PDF file", "Data file"];
function subStore() {
  const p = PropertiesService.getScriptProperties();
  let folder = null, ss = null;
  try { if (p.getProperty("SUB_FOLDER")) folder = DriveApp.getFolderById(p.getProperty("SUB_FOLDER")); } catch (x) { folder = null; }
  if (!folder) { folder = DriveApp.createFolder(SUB_FOLDER); p.setProperty("SUB_FOLDER", folder.getId()); }
  try { if (p.getProperty("SUB_SHEET")) ss = SpreadsheetApp.openById(p.getProperty("SUB_SHEET")); } catch (x) { ss = null; }
  if (!ss) {
    ss = SpreadsheetApp.create("Joining Kit Submissions");
    const sh = ss.getSheets()[0];
    sh.setName("Submissions"); sh.appendRow(SUB_COLS); sh.setFrozenRows(1); sh.getRange(1, 1, 1, SUB_COLS.length).setFontWeight("bold");
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    p.setProperty("SUB_SHEET", ss.getId());
  }
  return { folder: folder, sheet: ss.getSheetByName("Submissions") || ss.getSheets()[0] };
}
// text typed by the public goes into the sheet as plain text, never as a formula
function cell(v) { v = String(v == null ? "" : v).slice(0, 300); return /^[=+\-@]/.test(v) ? "'" + v : v; }
function submitKit(req) {
  if (req.website) return { ok: true, ref: "—" };   // spam trap: a hidden field people never fill
  const d = (req.data && typeof req.data === "object") ? req.data : {};
  const name = String(d.NAME || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return { error: "Please enter your name before submitting." };
  if (typeof req.pdf !== "string" || !req.pdf) return { error: "The joining kit PDF is missing. Please try again." };
  if (req.pdf.length > SUB_MAX_MB * 1.37e6) return { error: "Your kit is larger than " + SUB_MAX_MB + " MB. Attach smaller photos or fewer pages, then submit again." };
  const cache = CacheService.getScriptCache(), n = Number(cache.get("subs:hour") || 0);
  if (n >= SUB_PER_HOUR) return { error: "Too many submissions right now. Please try again in an hour." };
  cache.put("subs:hour", String(n + 1), 3600);
  const bytes = Utilities.base64Decode(req.pdf);
  if (Utilities.newBlob(bytes.slice(0, 5)).getDataAsString() !== "%PDF-") return { error: "That file isn't a PDF. Please try again." };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let ref, pdf, s;
  try {
    s = subStore();
    ref = Utilities.getUuid().replace(/-/g, "").slice(0, 8).toUpperCase();
    const stamp = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HHmm");
    const base = "Joining Kit - " + name.replace(/[\\/:*?"<>|]+/g, " ") + " - " + stamp;
    pdf = s.folder.createFile(Utilities.newBlob(bytes, "application/pdf", base + ".pdf"));
    const json = s.folder.createFile(Utilities.newBlob(JSON.stringify(d), "application/json", base + ".json"));
    s.sheet.appendRow([new Date(), cell(name), cell(d.MOBILE), cell(d.EMAIL), cell(d.DOJ), cell(d.EMPID), "New", pdf.getUrl(), ref, pdf.getId(), json.getId()]);
  } finally {
    lock.releaseLock();
  }
  const when = Utilities.formatDate(new Date(), "Asia/Kolkata", "d MMM yyyy, h:mm a");
  const lines = [["Name", name], ["Mobile", d.MOBILE], ["Email", d.EMAIL], ["Date of joining", d.DOJ], ["Reference", ref]].filter(function (x) { return x[1]; });
  const mail = {
    to: HR_EMAIL, name: "Alcove HR Tool", subject: "New joining kit: " + name + " (" + ref + ")",
    body: name + " submitted their joining kit (" + when + ").\n\n" + lines.map(function (x) { return x[0] + ": " + x[1]; }).join("\n") +
      "\n\nOpen it in the HR Tool → Joining Kit → Received from joiners, or in Drive: " + pdf.getUrl(),
    htmlBody: '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;padding:22px;border:1px solid #e0e7f0;border-radius:12px">' +
      '<div style="color:#204768;font-weight:600;letter-spacing:.1em;font-size:12px;text-transform:uppercase">Alcove HR Tool · Joining kit received</div>' +
      '<p style="color:#16304d;font-size:15px"><b>' + esc(name) + '</b> submitted their joining kit<br><span style="color:#5d6e84;font-size:13px">' + when + '</span></p>' +
      '<table style="font-size:14px;color:#16304d;border-collapse:collapse">' + lines.map(function (x) { return '<tr><td style="padding:2px 14px 2px 0;color:#5d6e84">' + esc(x[0]) + '</td><td>' + esc(x[1]) + '</td></tr>'; }).join("") + '</table>' +
      '<p style="color:#5d6e84;font-size:13px">The PDF is attached. It is also in the HR Tool under Joining Kit → Received from joiners, and in Drive (' + esc(SUB_FOLDER) + ').</p></div>'
  };
  if (bytes.length < 20e6) mail.attachments = [pdf.getBlob()];
  MailApp.sendEmail(mail);
  return { ok: true, ref: ref };
}
function subRows() {
  const s = subStore(), v = s.sheet.getDataRange().getValues();
  return { s: s, rows: v.slice(1).map(function (r, i) { return { row: i + 2, r: r }; }).filter(function (x) { return x.r[8]; }) };
}
function subFind(id) {
  const x = subRows().rows.filter(function (y) { return String(y.r[8]) === id; })[0];
  if (!x) throw new Error("That submission wasn't found.");
  return x;
}
function subList() {
  const list = subRows().rows.map(function (x) {
    const r = x.r;
    return { id: String(r[8]), at: r[0] instanceof Date ? r[0].getTime() : Date.parse(r[0]) || 0, name: String(r[1]), mobile: String(r[2]), email: String(r[3]),
      doj: String(r[4]), empid: String(r[5]), status: String(r[6] || "New"), url: String(r[7]) };
  }).sort(function (a, b) { return b.at - a.at; });
  return { ok: true, list: list };
}
function subData(id) {
  const x = subFind(id);
  return { ok: true, data: JSON.parse(DriveApp.getFileById(String(x.r[10])).getBlob().getDataAsString()) };
}
function subPdf(id) {
  const x = subFind(id), f = DriveApp.getFileById(String(x.r[9]));
  return { ok: true, name: f.getName(), data: Utilities.base64Encode(f.getBlob().getBytes()) };
}
function subStatus(id, status) {
  if (["New", "Seen", "Done"].indexOf(status) < 0) throw new Error("Unknown status.");
  const x = subFind(id), s = subStore();
  s.sheet.getRange(x.row, 7).setValue(status);
  return { ok: true };
}
/* Run once from the editor (select it → Run) to grant Drive access and create the submissions folder and sheet. */
function testSubmissions() {
  const s = subStore();
  Logger.log("Submissions folder: " + s.folder.getUrl() + " | sheet rows: " + (s.sheet.getLastRow() - 1));
}

/* Run once from the editor to grant Sheets access and see which columns were found (no employee data is shown). */
function testEmployees() {
  const t = employeeTab(), values = t.tab.getDataRange().getValues(), h = findColumns(values), r = employees();
  const found = Object.keys(h.cols).map(function (f) { return f + " = \"" + values[h.row][h.cols[f]] + "\""; }).join(", ");
  Logger.log("Tab: " + t.tab.getName() + " | heading row " + (h.row + 1) + " | columns: " + found +
    " | employees: " + r.list.length + " (inactive: " + r.skipped + ") | with birthday: " + r.list.filter(function (p) { return p.d; }).length);
}

/* Run this once from the editor (select it → Run) to grant the email permission and test sending. */
function testEmail() {
  MailApp.sendEmail(HR_EMAIL, "HR Tool login codes are set up", "This is a test from the HR Tool login service.");
}
