import fs from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { S_WHATSAPP_NET, getBinaryNodeChild } from "@whiskeysockets/baileys";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NovaUltra = {
    command: "صيد",
    description: "بوت صيد اليوزرات (فردي + تطقيم + تثبيت بالرقم)",
    elite: "off",
    group: false,
    prv: false,
    lock: "off",
};

/* ───────────── الإعدادات ───────────── */
const botDir = join(__dirname, "../../");
const dataDir = join(botDir, "nova", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const failedPath    = join(dataDir, "hunt_failed.json");
const availablePath = join(dataDir, "hunt_available.json");

const QUERY_ID = "27134626522840286";
const MAX_ATTEMPTS = 6000;
const MAX_FOUND    = 6;
const BATCH_SIZE   = 20;
const DELAY_MS     = 1500;
const PROGRESS_EVERY_MS = 4000;
const MAX_FAIL_STREAK   = 8;
const FAILED_TTL = 3 * 24 * 60 * 60 * 1000;
const AVAIL_TTL  = 3 * 24 * 60 * 60 * 1000;

/* ───────────── الحروف المتاحة (كابتل + سمول لاتيني + أرقام + . _ ) ─────────────
   الكابتل والسمول بيتعاملوا كحروف مختلفة (A غير a).
*/
const LOWER      = "abcdefghijklmnopqrstuvwxyz";
const UPPER      = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LETTERS    = LOWER + UPPER;
const DIGITS     = "0123456789";
const SEPARATORS = "._";
const REAL       = LETTERS + DIGITS;          // الحروف الحقيقية (بدون فواصل)
const ALL        = LETTERS + DIGITS + SEPARATORS;

const activeSessions = new Map();
const sleep = ms => new Promise(res => setTimeout(res, ms));

const FRAME_TOP = "✧━── ❝ 𝐇𝐔𝐍𝐓 𝐔𝐒𝐄𝐑𝐒 ❞ ──━✧";
const FRAME_BOT = "✧━── ❝ 𝐀𝐧𝐚𝐬𝐭𝐚𝐬𝐢𝐚 𝐯𝟒 ❞ ──━✧";
const frame = body => `${FRAME_TOP}\n\n${body}\n\n${FRAME_BOT}`;

/* ───────────── أنواع اليوزرات ─────────────
   normal      : حروف/أرقام بس (بدون _ أو .)               مثال: Jsh , sjdk
   semi        : "شبه" = فيه _ أو . ، و reals = عدد الحروف/الأرقام الحقيقية
                 sg_  (ثلاثي شبه ثنائي) | hd_e (رباعي شبه ثلاثي) | g_.1 (رباعي شبه ثنائي)
   special     : "مميز" = حرف أو رقم متكرر مرتين              مثال: fgfk , sg6g
   semispecial : "شبه مميز" = فيه _ أو . + حرف متكرر          مثال: e_eb
*/
const TYPES = [
    { label: "ثلاثي",                len: 3, kind: "normal" },
    { label: "ثلاثي شبه ثنائي",      len: 3, kind: "semi",        reals: 2 },

    { label: "رباعي مميز",           len: 4, kind: "special" },
    { label: "رباعي شبه مميز",       len: 4, kind: "semispecial" },

    { label: "رباعي",                len: 4, kind: "normal" },
    { label: "رباعي شبه احادي",      len: 4, kind: "semi",        reals: 1 },
    { label: "رباعي شبه ثنائي",      len: 4, kind: "semi",        reals: 2 },
    { label: "رباعي شبه ثلاثي",      len: 4, kind: "semi",        reals: 3 },

    { label: "خماسي",                len: 5, kind: "normal" },
    { label: "خماسي شبه احادي",      len: 5, kind: "semi",        reals: 1 },
    { label: "خماسي شبه ثنائي",      len: 5, kind: "semi",        reals: 2 },
    { label: "خماسي شبه ثلاثي",      len: 5, kind: "semi",        reals: 3 },
    { label: "خماسي شبه رباعي",      len: 5, kind: "semi",        reals: 4 },

    { label: "سداسي",                len: 6, kind: "normal" },
    { label: "سداسي شبه احادي",      len: 6, kind: "semi",        reals: 1 },
    { label: "سداسي شبه ثنائي",      len: 6, kind: "semi",        reals: 2 },
    { label: "سداسي شبه ثلاثي",      len: 6, kind: "semi",        reals: 3 },
    { label: "سداسي شبه رباعي",      len: 6, kind: "semi",        reals: 4 },
    { label: "سداسي شبه خماسي",      len: 6, kind: "semi",        reals: 5 },
];

const LEN_NAMES = { 3: "ثلاثي", 4: "رباعي", 5: "خماسي", 6: "سداسي" };
const NUM_NAMES = { 1: "احادي", 2: "ثنائي", 3: "ثلاثي", 4: "رباعي", 5: "خماسي" };

const MODES = { 1: "فردي 🔥", 2: "تطقيم 👥", 3: "تثبيت بالرقم 🤖" };

const METHODS = {
    1: "عشوائي بالكامل",
    2: "تخصيص أحرف وترتيب عشوائي",
    3: "تخصيص أحرف متتالية (نمط #)",
};

/* ───────────── أدوات مساعدة ───────────── */
function normalizeDigits(str) {
    return str
        .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
        .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
}

const rnd = n => Math.floor(Math.random() * n);
const pick = str => str[rnd(str.length)];
const randLetter = () => pick(LETTERS);
const randLower  = () => pick(LOWER);
const randDigit  = () => pick(DIGITS);
const randSep    = () => pick(SEPARATORS);
// حرف حقيقي: غالباً حرف، أحياناً رقم
const randReal   = () => Math.random() < 0.7 ? randLetter() : randDigit();
const randAny    = () => {
    const r = Math.random();
    if (r < 0.55) return randLetter();
    if (r < 0.80) return randDigit();
    return randSep();
};
const randSpecial = () => Math.random() < 0.35 ? randSep() : randDigit();

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = rnd(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// distinct (حساس للحالة: A و a مختلفين)
const distinctCount = s => new Set(s.split("")).size;

// يوزر صالح: حرف أو _ في الأول، والباقي حروف/أرقام/._ ، مفيش .. ولا . في الآخر، وفيه حرف على الأقل
const validUsername = s =>
    !!s &&
    s.length >= 3 && s.length <= 35 &&
    /^[A-Za-z_][A-Za-z0-9._]*$/.test(s) &&
    !s.endsWith(".") &&
    !s.includes("..") &&
    /[A-Za-z]/.test(s);

// يبدأ بحرف؟
const startsWithLetter = s => /^[A-Za-z]/.test(s);

// تحليل اليوزر: عدد الفواصل / الحروف الحقيقية / المختلف منها
function analyze(u) {
    const chars = u.split("");
    const realArr = chars.filter(c => !SEPARATORS.includes(c));
    return {
        sep: chars.length - realArr.length,
        realCount: realArr.length,
        realDistinct: new Set(realArr).size,
    };
}

// هل اليوزر مطابق لنوع معين؟
function validFor(type, u) {
    if (!validUsername(u) || u.length !== type.len) return false;
    const a = analyze(u);
    switch (type.kind) {
        case "normal":      return a.sep === 0;
        case "semi":        return a.sep === type.len - type.reals && a.realCount === type.reals;
        case "special":     return a.sep === 0 && a.realDistinct === type.len - 1;
        case "semispecial": return a.sep === 1 && a.realCount === type.len - 1 && a.realDistinct === type.len - 2;
        default:            return true;
    }
}

/* ───────────── ملف الفاشلين ───────────── */
function loadFailed() {
    try {
        const obj = JSON.parse(fs.readFileSync(failedPath, "utf8")) || {};
        const now = Date.now();
        const filtered = {};
        for (const [k, v] of Object.entries(obj)) {
            if (now - v < FAILED_TTL) filtered[k] = v;
        }
        return filtered;
    } catch (e) { return {}; }
}

let failedCache = loadFailed();
let lastFailedSave = 0;

function saveFailed() {
    const now = Date.now();
    const cutoff = now - FAILED_TTL;
    for (const k of Object.keys(failedCache)) {
        if (failedCache[k] < cutoff) delete failedCache[k];
    }
    try { fs.writeFileSync(failedPath, JSON.stringify(failedCache), "utf8"); } catch (e) {}
}

function markFailed(usernames) {
    if (!usernames || usernames.length === 0) return;
    const now = Date.now();
    for (const u of usernames) if (u) failedCache[u] = now;
    if (now - lastFailedSave > 3000) {
        lastFailedSave = now;
        saveFailed();
    }
}

function isFailed(u) { return !!(u && failedCache[u]); }

/* ───────────── ملف المتوفرين ───────────── */
function loadAvailable() {
    try {
        const obj = JSON.parse(fs.readFileSync(availablePath, "utf8")) || {};
        const now = Date.now();
        const filtered = {};
        for (const [k, v] of Object.entries(obj)) {
            if (now - v < AVAIL_TTL) filtered[k] = v;
        }
        return filtered;
    } catch (e) { return {}; }
}

let availableCache = loadAvailable();
let lastAvailSave = 0;

function saveAvailable() {
    const now = Date.now();
    const cutoff = now - AVAIL_TTL;
    for (const k of Object.keys(availableCache)) {
        if (availableCache[k] < cutoff) delete availableCache[k];
    }
    try { fs.writeFileSync(availablePath, JSON.stringify(availableCache), "utf8"); } catch (e) {}
}

function markAvailable(username) {
    if (!username) return;
    availableCache[username] = Date.now();
    const now = Date.now();
    if (now - lastAvailSave > 3000) {
        lastAvailSave = now;
        saveAvailable();
    }
}

function availCount() {
    const now = Date.now();
    let c = 0;
    for (const t of Object.values(availableCache)) {
        if (now - t < AVAIL_TTL) c++;
    }
    return c;
}

/* ───────────── توليد اليوزرات ───────────── */

// حرف تعبئة حسب نوع اليوزر
function randFill(type) {
    if (type.kind === "normal" || type.kind === "special") return randReal();
    return randAny();
}

// عادي: حروف وأرقام بس (بدون _ أو .)  مثال: Jsh , sjdk
function genNormal(type) {
    const { len } = type;
    for (let t = 0; t < 100; t++) {
        let s = randLetter();
        for (let i = 1; i < len; i++) s += randReal();
        if (validFor(type, s)) return s;
    }
    return null;
}

// مميز: حرف أو رقم متكرر مرتين والباقي مختلف  مثال: fgfk , sg6g , c7cw , D3pD
function genSpecial(type) {
    const { len } = type;
    for (let t = 0; t < 200; t++) {
        const pool = [];
        let guard = 0;
        while (pool.length < len - 1 && guard++ < 300) {
            const c = randReal();
            if (!pool.includes(c)) pool.push(c);
        }
        if (pool.length < len - 1) continue;
        const arr = [...pool, pool[rnd(pool.length)]];
        shuffle(arr);
        const s = arr.join("");
        if (validFor(type, s)) return s;
    }
    return null;
}

// شبه مميز: فاصل واحد (_ أو .) + حرف متكرر  مثال: e_eb
function genSemiSpecial(type) {
    const { len } = type;
    const reals = len - 1;
    for (let t = 0; t < 300; t++) {
        const pool = [];
        let guard = 0;
        while (pool.length < reals - 1 && guard++ < 300) {
            const c = randReal();
            if (!pool.includes(c)) pool.push(c);
        }
        if (pool.length < reals - 1) continue;
        const arr = [...pool, pool[rnd(pool.length)]];
        shuffle(arr);
        arr.splice(rnd(len), 0, randSep());
        const s = arr.join("");
        if (validFor(type, s)) return s;
    }
    return null;
}

// شبه N: فيه _ أو . ، وعدد الحروف/الأرقام الحقيقية = N (الباقي فواصل)
//   sg_ | hd_e | jhg.j | g_.1 (لو حرفين حقيقيين والفواصل 2 أو أكتر: الفواصل بينهم)
function genSemi(type) {
    const { len, reals } = type;
    const k = len - reals;
    for (let t = 0; t < 400; t++) {
        const arr = new Array(len).fill(null);

        let sepPos;
        if (reals === 2 && k >= 2) {
            // حرفين حقيقيين في الأطراف والفواصل بينهم
            sepPos = [];
            for (let i = 1; i <= len - 2; i++) sepPos.push(i);
        } else {
            const all = [];
            for (let i = 0; i < len; i++) all.push(i);
            sepPos = shuffle(all).slice(0, k);
        }

        for (const p of sepPos) arr[p] = randSep();
        for (let i = 0; i < len; i++) if (arr[i] === null) arr[i] = randReal();

        const s = arr.join("");
        if (validFor(type, s)) return s;
    }
    return null;
}

// مولد أساسي حسب النوع
function genByKind(type) {
    switch (type.kind) {
        case "special":     return genSpecial(type);
        case "semispecial": return genSemiSpecial(type);
        case "semi":        return genSemi(type);
        default:            return genNormal(type);
    }
}

// تخصيص أحرف (كل الحروف المخصصة موجودة + ترتيب عشوائي)
function genCustomLetters(type, custom) {
    const { len } = type;
    const base = custom.split("");
    if (base.length > len) return null;

    const seed = genByKind(type);
    if (!seed) return null;

    const arr = seed.split("");
    const positions = shuffle(Array.from({ length: len }, (_, i) => i)).slice(0, base.length);
    positions.forEach((p, i) => { arr[p] = base[i]; });
    return arr.join("");
}

// نمط متتالي (# عشوائي)
function genPattern(type, pattern) {
    return pattern.split("").map(c => (c === "#" ? randFill(type) : c)).join("");
}

// تثبيت جزء + الباقي عشوائي
function genPinned(type, pin) {
    const free = type.len - pin.length;
    if (free < 0) return null;
    const at = rnd(free + 1);
    let left = "", right = "";
    for (let i = 0; i < at; i++) left += randFill(type);
    for (let i = 0; i < free - at; i++) right += randFill(type);
    return left + pin + right;
}

function generateUsername(cfg) {
    for (let i = 0; i < 800; i++) {
        let u;
        if (cfg.mode === 3) u = genPinned(cfg.type, cfg.pin);
        else if (cfg.method === 2) u = genCustomLetters(cfg.type, cfg.custom);
        else if (cfg.method === 3) u = genPattern(cfg.type, cfg.pattern);
        else u = genByKind(cfg.type);

        if (!u) continue;
        if (!validFor(cfg.type, u)) continue;
        if (isFailed(u)) continue;
        return u;
    }
    return null;
}

/* ───────────── تطقيم ─────────────
   زوج متشابه: نفس اليوزر بتغيير آخر حرف (adh2 , adh3)
   أو تبديل حرفين (ahd2 , adh2)
*/
function generatePair(cfg) {
    for (let t = 0; t < 300; t++) {
        const base = generateUsername(cfg);
        if (!base || isFailed(base)) continue;

        const candidates = [];

        // 1) تغيير آخر حرف (رقم/حرف/فاصل)
        const last = base[base.length - 1];
        const stem = base.slice(0, -1);
        let pool;
        if (/[0-9]/.test(last)) pool = DIGITS.replace(last, "");
        else if (last === ".") pool = SEPARATORS.replace(".", "") + DIGITS;
        else if (last === "_") pool = SEPARATORS.replace("_", "") + DIGITS;
        else pool = LETTERS.replace(last, "").replace(last.toLowerCase(), "").replace(last.toUpperCase(), "");

        for (const c of pool) {
            const cand = stem + c;
            if (cand === base) continue;
            if (!validFor(cfg.type, cand)) continue;
            if (isFailed(cand)) continue;
            candidates.push(cand);
        }

        // 2) تبديل حرفين مختلفين (حروف/أرقام حقيقية)
        const arr = base.split("");
        const idxs = arr.map((c, i) => SEPARATORS.includes(c) ? -1 : i).filter(i => i >= 0);
        for (let a = 0; a < idxs.length; a++) {
            for (let b = a + 1; b < idxs.length; b++) {
                const i = idxs[a], j = idxs[b];
                if (arr[i] === arr[j]) continue;
                const copy = [...arr];
                [copy[i], copy[j]] = [copy[j], copy[i]];
                const cand = copy.join("");
                if (cand === base) continue;
                if (!validFor(cfg.type, cand)) continue;
                if (isFailed(cand)) continue;
                candidates.push(cand);
            }
        }

        if (candidates.length > 0) {
            return [base, pick(candidates)];
        }
    }
    return null;
}

/* ───────────── فحص اليوزرات ─────────────
   بيرجع 3 مجموعات:
   - available : الرد قال SUCCESS صراحة
   - taken     : الرد قال صراحة إنه مستخدم
   - unknown   : أي حاجة تانية (مش موجود في الرد / كود غير معروف / rate limit داخلي ...)
   الـ unknown بيتحسب محاولة بس مبيتسجلش كـ "مستخدم" ومبيتحذفش من المتوفرين.
*/
let debugLogged = false;
const codeStats = {};
const TAKEN_RE = /TAKEN|IN_USE|UNAVAILABLE|NOT_AVAILABLE|ALREADY|EXIST|USED|DUPLICATE|CONFLICT/i;

async function checkUsernames(sock, usernames) {
    const result = await sock.query({
        tag: "iq",
        attrs: { id: sock.generateMessageTag(), type: "get", to: S_WHATSAPP_NET, xmlns: "w:mex" },
        content: [{
            tag: "query",
            attrs: { query_id: QUERY_ID },
            content: Buffer.from(JSON.stringify({ variables: { usernames } }), "utf-8"),
        }],
    });

    const child = getBinaryNodeChild(result, "result");
    if (!child?.content) {
        const err = new Error("فشل التحقق من اليوزرات (رد فاضي)");
        err.statusCode = 400;
        throw err;
    }

    const data = JSON.parse(child.content.toString());
    if (data.errors?.length) {
        const err = new Error(data.errors[0].message || "GraphQL error");
        err.statusCode = data.errors[0].extensions?.error_code || 400;
        throw err;
    }

    const res = data?.data?.xwa2_username_check_multi;
    if (!debugLogged) {
        debugLogged = true;
        console.log("[Hunt] أول رد من الفحص:", JSON.stringify(res)?.slice(0, 600));
    }

    // مطابقة الاسم: بالظبط أول، وبعدين بدون حساسية للحالة (لو مفيش تعارض)
    const exact = new Set(usernames);
    const lowerMap = new Map();
    for (const u of usernames) {
        const k = u.toLowerCase();
        if (!lowerMap.has(k)) lowerMap.set(k, []);
        lowerMap.get(k).push(u);
    }

    const available = new Set();
    const taken = new Set();
    const unknown = new Set();
    const seen = new Set();

    for (const r of res?.results || []) {
        const raw = r?.username ? String(r.username) : null;
        if (!raw) continue;

        let orig = null;
        if (exact.has(raw)) orig = raw;
        else {
            const arr = lowerMap.get(raw.toLowerCase());
            if (arr && arr.length === 1) orig = arr[0];
        }
        if (!orig) continue;

        const code = String(r?.response?.result ?? "NONE");
        codeStats[code] = (codeStats[code] || 0) + 1;
        seen.add(orig);

        if (code === "SUCCESS") available.add(orig);
        else if (TAKEN_RE.test(code)) taken.add(orig);
        else unknown.add(orig);
    }

    for (const u of usernames) if (!seen.has(u)) unknown.add(u);

    return { available, taken, unknown };
}

/* ───────────── تصنيف يوزر (للعرض) ───────────── */
function classifyUsername(u) {
    const len = u.length;
    const a = analyze(u);
    const lenName = LEN_NAMES[len] || String(len);
    let label;
    if (a.sep > 0) {
        if (len === 4 && a.sep === 1 && a.realDistinct === a.realCount - 1) label = "رباعي شبه مميز";
        else label = `${lenName} شبه ${NUM_NAMES[a.realCount] || a.realCount}`;
    } else {
        if (len === 4 && a.realDistinct === a.realCount - 1) label = "رباعي مميز";
        else label = lenName;
    }
    return { len, label, real: a.realCount };
}

/* ───────────── النصوص ───────────── */
const buildMainMenu = () => frame(
    `*اهلاً بك في بوت صيد اليوزرات 🎯.*\n\n` +
    `──────────────\n\n` +
    `*1*\n\`🔥 صيد فردي (عادي).\`\n\n` +
    `*2*\n\`👥 صيد تطقيم (ثنائي).\`\n\n` +
    `*3*\n\`🤖 صيد وتثبيت بالرقم (تلقائي).\`\n\n` +
    `*4*\n\`📦 اليوزرات المتاحة من صيدات سابقة (${availCount()}).\`\n\n` +
    `⚙️ *ارسل الرقم لاختيار نوع الصيد.*\n` +
    `🛑 *للخروج اكتب* \`وقف\``
);

const buildTypeMenu = mode => {
    const names = { 1: "الصيد الفردي", 2: "صيد التطقيم", 3: "الصيد والتثبيت بالرقم" };
    return frame(
        `✅ *تم اختيار وضع :* ${names[mode]}\n\n` +
        `*اختر الفئة وطول اليوزر بإرسال رقم الخيار :*\n\n` +
        TYPES.map((t, i) => `*${i + 1}.* ${t.label}`).join("\n") +
        `\n\n🔙 *رجوع*`
    );
};

const buildMethodMenu = type => frame(
    `✅ *لقد اخترت :* ${type.label}\n\n` +
    `⚙️ *كيف تريد طريقة الصيد؟*\n\n` +
    Object.entries(METHODS).map(([k, v]) => `- *${k}*\n\`${v}\``).join("\n\n") +
    `\n\n🔙 *رجوع*`
);

const buildConfirm = cfg => {
    const patternTxt = cfg.mode === 3 ? `${cfg.pin} (تثبيت)` : (cfg.method === 3 ? cfg.pattern : "بدون تثبيت");
    const customTxt  = cfg.method === 2 ? cfg.custom.split("").join(" ") : "لا يوجد";
    const fillTxt    = cfg.mode === 3 || cfg.method === 2 || cfg.method === 3 ? "عشوائي للباقي" : "عشوائي عام";
    return frame(
        `✅ *تم تجهيز الإعدادات النهائية :*\n\n` +
        `🏷️ *النوع :* ${cfg.type.label} (${MODES[cfg.mode]})\n` +
        `🎯 *النمط :* ${patternTxt}\n` +
        `🔤 *الأحرف المخصصة :* ${customTxt}\n` +
        `🔒 *وضع التعبئة :* ${fillTxt}\n\n` +
        `❓ *هل تريد بدء الصيد الآن؟*\n` +
        `\`نعم / اجل / تم\`\n` +
        `🔙 *رجوع*`
    );
};

const buildStartText = cfg => {
    const patternTxt = cfg.mode === 3 ? cfg.pin : (cfg.method === 3 ? cfg.pattern : "بدون");
    const customTxt  = cfg.method === 2 ? cfg.custom.split("").join(" ") : "لا يوجد";
    return frame(
        `🚀 *بدأ صيد اليوزرات...*\n\n` +
        `🏷️ *النمط :* ${cfg.type.label}\n` +
        `🎯 *التثبيت :* ${patternTxt}\n` +
        `🔤 *المخصص :* ${customTxt}\n\n` +
        `🛑 *لإيقاف الصيد اكتب* \`وقف\``
    );
};

const buildScanning = () => `⏳ *جاري فحص اليوزرات...*`;

const buildProgress = (attempts, found) =>
    `🔄 *عملية الصيد مستمرة...*\n\n` +
    `📈 *إجمالي الفحص :* ${attempts}\n` +
    `✅ *الناجح :* ${found} / ${MAX_FOUND}\n\n` +
    `🛑 *للإيقاف اكتب :* وقف`;

const buildFoundSingle = (u, no) =>
    `✨ *تم صيد يوزر متاح بنجاح!* ✨\n\n📌 *اليوزر:* \`@${u}\`\n🎯 *المحاولة رقم:* ${no}`;

const buildFoundPair = (u1, u2, no) =>
    `✨ *تم صيد تطقيم متاح بنجاح!* ✨\n\n📌 *الأول:* \`@${u1}\`\n📌 *الثاني:* \`@${u2}\`\n🎯 *المحاولة رقم:* ${no}`;

/* ───────────── إظهار المتوفرين من الصيدات السابقة ─────────────
   يجمع كل اليوزرات، يفحصها مرة واحدة، يعرضها في مجموعات حسب النوع
*/
async function showSavedAvailable(sock, chatId, msg, say) {
    const entries = Object.entries(availableCache).filter(([u, t]) => Date.now() - t < AVAIL_TTL);
    if (entries.length === 0) {
        await say(frame("📭 *لا توجد يوزرات محفوظة من صيدات سابقة.*"));
        return;
    }

    entries.sort((a, b) => b[1] - a[1]);
    const capped = entries.length > 300;
    const valid = entries.slice(0, 300).map(([u]) => u);
    const total = valid.length;

    const progressMsg = await say(frame(
        `⏳ *جاري فحص ${total} يوزر محفوظ...*\n` +
        (capped ? `\`تم فحص أحدث 300 فقط من إجمالي ${entries.length}\`` : "")
    ));
    const editProgress = async (text) => {
        if (!progressMsg?.key) return;
        try { await sock.sendMessage(chatId, { text, edit: progressMsg.key }); } catch (e) {}
    };

    const stillAvailable = [];
    const nowTaken = [];
    const unsure = [];

    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
        const batch = valid.slice(i, i + BATCH_SIZE);
        try {
            const r = await checkUsernames(sock, batch);
            for (const u of batch) {
                if (r.available.has(u)) stillAvailable.push(u);
                else if (r.taken.has(u)) nowTaken.push(u);
                else unsure.push(u);
            }
        } catch (e) {
            console.log("[ShowAvailable] batch error:", e?.message);
            for (const u of batch) unsure.push(u);
        }
        if (i % (BATCH_SIZE * 3) === 0) {
            await editProgress(frame(
                `⏳ *جاري الفحص...* ${Math.min(i + BATCH_SIZE, total)}/${total}\n` +
                `✅ متاح: ${stillAvailable.length}\n❌ مستخدم: ${nowTaken.length}\n⚠️ غير مؤكد: ${unsure.length}`
            ));
        }
        await sleep(DELAY_MS);
    }

    // تحديث الكاش (المستخدم بس هو اللي بيتحذف، وغير المؤكد بيفضل)
    const now = Date.now();
    for (const u of stillAvailable) availableCache[u] = now;
    for (const u of nowTaken) delete availableCache[u];
    saveAvailable();
    if (nowTaken.length > 0) markFailed(nowTaken);
    console.log("[ShowAvailable] رموز الرد:", JSON.stringify(codeStats));

    // تجميع حسب النوع
    const groups = new Map();
    for (const u of stillAvailable) {
        const info = classifyUsername(u);
        if (!groups.has(info.label)) {
            groups.set(info.label, { info, list: [] });
        }
        groups.get(info.label).list.push(u);
    }

    // ترتيب المجموعات: من أصغر طول لأكبر
    const sortedGroups = [...groups.values()].sort((a, b) => {
        if (a.info.len !== b.info.len) return a.info.len - b.info.len;
        return a.info.label.localeCompare(b.info.label);
    });

    let body = `📦 *نتائج الفحص:*\n\n`;
    body += `✅ *متاح (${stillAvailable.length}):*\n\n`;

    if (sortedGroups.length === 0) {
        body += "_لا يوجد_\n\n";
    } else {
        for (const g of sortedGroups) {
            body += `*─ ${g.info.label} (${g.list.length}):*\n`;
            body += g.list.map(u => `\`${u}\``).join("\n") + "\n\n";
        }
    }

    body += `❌ *تم استخدامها (${nowTaken.length}):*\n`;
    body += nowTaken.length > 0 ? nowTaken.map(u => `\`${u}\``).join("\n") : "_لا يوجد_";

    if (unsure.length > 0) {
        body += `\n\n⚠️ *غير مؤكد (${unsure.length}):*\n`;
        body += unsure.map(u => `\`${u}\``).join("\n");
        body += `\n_مفيش رد واضح من واتساب عنهم، فضلوا محفوظين._`;
    }

    // لو الرسالة طويلة، نقسمها
    const finalText = frame(body);
    if (finalText.length > 3500) {
        await editProgress(frame(`✅ *متاح (${stillAvailable.length}) - سنرسل التفاصيل على أجزاء...*`));
        const chunks = [];
        let cur = "";
        for (const line of body.split("\n")) {
            if ((cur + line).length > 3000) {
                chunks.push(cur);
                cur = "";
            }
            cur += line + "\n";
        }
        if (cur) chunks.push(cur);
        for (const c of chunks) await say(frame(c));
    } else {
        await editProgress(finalText);
    }
}

/* ───────────── التنفيذ ───────────── */
async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const sender = msg.key.participant || chatId;

    if (activeSessions.has(chatId)) {
        const prev = activeSessions.get(chatId);
        prev.stop?.();
        sock.ev.off("messages.upsert", prev.listener);
        clearTimeout(prev.timeout);
        activeSessions.delete(chatId);
    }

    const sentMsg = await sock.sendMessage(chatId, { text: buildMainMenu() }, { quoted: msg });
    const menuKey = sentMsg.key;

    let state = "MAIN";
    let hunting = false;
    let stopRequested = false;
    const cfg = { mode: 0, type: null, method: 0, custom: "", pattern: "", pin: "" };

    const editMenu = async (text) => {
        try { await sock.sendMessage(chatId, { text, edit: menuKey }); } catch (e) {}
    };
    const say = async (text) => {
        try { return await sock.sendMessage(chatId, { text }, { quoted: msg }); } catch (e) { return null; }
    };
    const react = async (key, emoji) => {
        try { await sock.sendMessage(chatId, { react: { text: emoji, key } }); } catch (e) {}
    };

    const endSession = () => {
        sock.ev.off("messages.upsert", listener);
        const s = activeSessions.get(chatId);
        if (s) clearTimeout(s.timeout);
        activeSessions.delete(chatId);
        saveAvailable();
        saveFailed();
    };

    /* ───── حلقة الصيد ───── */
    const startHunt = async () => {
        hunting = true;
        stopRequested = false;
        const sess = activeSessions.get(chatId);
        if (sess) clearTimeout(sess.timeout);

        await say(buildStartText(cfg));
        await sleep(800);
        const scanMsg = await say(buildScanning());
        const scanKey = scanMsg?.key;

        const editScan = async (text) => {
            if (!scanKey) return;
            try { await sock.sendMessage(chatId, { text, edit: scanKey }); } catch (e) {}
        };

        const tried = new Set();
        let found = 0;
        let attempts = 0;
        let failStreak = 0;
        let rateLimitHits = 0;
        let lastProgress = 0;
        let reason = "none";

        const buildBatch = (size) => {
            const list = [];
            let guard = 0;
            if (cfg.mode === 2) {
                while (list.length + 2 <= size && guard++ < size * 30) {
                    const pair = generatePair(cfg);
                    if (!pair) break;
                    const [a, b] = pair;
                    if (tried.has(a) || tried.has(b)) continue;
                    tried.add(a); tried.add(b);
                    list.push(a, b);
                }
            } else {
                while (list.length < size && guard++ < size * 30) {
                    const u = generateUsername(cfg);
                    if (!u) break;
                    if (tried.has(u)) continue;
                    tried.add(u);
                    list.push(u);
                }
            }
            return list;
        };

        while (!stopRequested && found < MAX_FOUND) {
            const remaining = MAX_ATTEMPTS - attempts;
            if (remaining <= 0 || (cfg.mode === 2 && remaining < 2)) { reason = "limit"; break; }
            if (failStreak >= MAX_FAIL_STREAK) { reason = "errors"; break; }

            const list = buildBatch(Math.min(BATCH_SIZE, remaining));
            if (!list.length) { reason = "nogen"; break; }

            const base = attempts;
            attempts += list.length;

            let available;
            try {
                const r = await checkUsernames(sock, list);
                available = r.available;
                failStreak = 0;
                rateLimitHits = 0;

                // المستخدم صراحة بس هو اللي بيتسجل في ملف الفاشلين
                if (r.taken.size > 0) markFailed([...r.taken]);
                for (const u of available) markAvailable(u);
            } catch (e) {
                const isRate = /rate|429|too many/i.test(e?.message || "") || e?.statusCode === 429;
                if (isRate) {
                    rateLimitHits++;
                    console.log(`[Hunt] rate limit (${rateLimitHits}/3)...`);
                    if (rateLimitHits > 3) { reason = "ratelimit"; break; }
                    await sleep(30000);
                    failStreak = 0;
                    attempts -= list.length;
                    for (const u of list) tried.delete(u);
                    continue;
                }
                failStreak++;
                console.log("[Hunt] خطأ في الفحص:", e?.message || e);
                attempts -= list.length;
                for (const u of list) tried.delete(u);
                await sleep(2000);
                continue;
            }

            if (cfg.mode === 2) {
                for (let i = 0; i + 1 < list.length && found < MAX_FOUND; i += 2) {
                    if (available.has(list[i]) && available.has(list[i + 1])) {
                        found++;
                        const no = base + i + 2;
                        if (found >= MAX_FOUND) attempts = no;
                        await say(buildFoundPair(list[i], list[i + 1], no));
                    }
                }
            } else {
                for (let i = 0; i < list.length && found < MAX_FOUND; i++) {
                    if (available.has(list[i])) {
                        found++;
                        const no = base + i + 1;
                        if (found >= MAX_FOUND) attempts = no;
                        await say(buildFoundSingle(list[i], no));
                    }
                }
            }

            const now = Date.now();
            if (now - lastProgress > PROGRESS_EVERY_MS) {
                lastProgress = now;
                await editScan(buildProgress(attempts, found));
            }
            await sleep(DELAY_MS);
        }

        if (found >= MAX_FOUND) reason = "full";
        hunting = false;
        saveAvailable();
        saveFailed();
        console.log("[Hunt] رموز الرد:", JSON.stringify(codeStats));

        await editScan(buildProgress(attempts, found));

        let endText;
        if (stopRequested) {
            endText = `🛑 *تم إيقاف الصيد.*\n\n📈 *إجمالي الفحص :* ${attempts}\n✅ *الناجح :* ${found} / ${MAX_FOUND}`;
        } else if (reason === "full") {
            endText = `🏁 *اكتمل الصيد بنجاح!*\n\n✅ *صيد ${found} / ${MAX_FOUND} يوزرات*\n📈 *إجمالي المحاولات :* ${attempts}`;
        } else if (reason === "limit") {
            endText = found > 0
                ? `⚠️ *انتهت المحاولات (${MAX_ATTEMPTS}).*\n\n✅ *الناجح :* ${found} / ${MAX_FOUND}\n📈 *إجمالي المحاولات :* ${attempts}`
                : `😔 *مفيش يوزر متاح خلال ${MAX_ATTEMPTS} محاولة.*\n\n📈 *إجمالي المحاولات :* ${attempts}\n\`جرّب نمط أو فئة تانية.\``;
        } else if (reason === "ratelimit") {
            endText = `⚠️ *توقف بسبب rate limit متكرر.*\n\`حاول تاني بعد شوية.\`\n\n✅ *الناجح :* ${found} / ${MAX_FOUND}\n📈 *إجمالي المحاولات :* ${attempts}`;
        } else if (reason === "errors") {
            endText = `❌ *توقف بسبب أخطاء متتالية.*\n\n📈 *إجمالي المحاولات :* ${attempts}`;
        } else {
            endText = `⚠️ *انتهت كل الاحتمالات الممكنة.*\n\n✅ *الناجح :* ${found} / ${MAX_FOUND}\n📈 *إجمالي المحاولات :* ${attempts}`;
        }

        await say(endText);
        endSession();
    };

    /* ───── مستمع الرسائل ───── */
    const listener = async ({ messages }) => {
        const newMsg = messages[0];
        if (!newMsg?.message || newMsg.key.remoteJid !== chatId) return;
        const newSender = newMsg.key.participant || newMsg.key.remoteJid;
        if (newSender !== sender) return;

        const rawText = newMsg.message?.conversation || newMsg.message?.extendedTextMessage?.text || "";
        if (!rawText) return;
        const input = normalizeDigits(rawText.trim());

        if (hunting) {
            if (input === "وقف") {
                stopRequested = true;
                await react(newMsg.key, "🛑");
            }
            return;
        }

        if (input === "وقف") {
            await say("🛑 *تم الخروج من بوت الصيد.*");
            endSession();
            return;
        }

        if (state === "MAIN") {
            if (input === "4") {
                state = "SHOW_AVAILABLE";
                const s = activeSessions.get(chatId);
                if (s) clearTimeout(s.timeout);
                try {
                    await showSavedAvailable(sock, chatId, msg, say);
                } catch (e) {
                    console.error("[ShowAvailable] error:", e);
                    await say(`❌ حدث خطأ: ${e.message}`);
                }
                state = "MAIN";
                await editMenu(buildMainMenu());
                if (s) {
                    s.timeout = setTimeout(() => {
                        sock.ev.off("messages.upsert", listener);
                        activeSessions.delete(chatId);
                    }, 300_000);
                }
                return;
            }
            if (["1", "2", "3"].includes(input)) {
                cfg.mode = Number(input);
                await editMenu(buildTypeMenu(cfg.mode));
                state = "TYPE";
            }
            return;
        }

        if (state === "TYPE") {
            if (input === "رجوع") { await editMenu(buildMainMenu()); state = "MAIN"; return; }
            const n = parseInt(input);
            if (!n || n < 1 || n > TYPES.length) return;
            cfg.type = TYPES[n - 1];

            if (cfg.mode === 3) {
                await say(frame(
                    `✅ *لقد اخترت :* ${cfg.type.label}\n\n` +
                    `🤖 *ارسل الرقم او الاحرف المراد تثبيتها بشكل متتالي.*\n` +
                    `\`مثال : 77 او x9\`\n` +
                    `\`الطول لازم يكون أقل من ${cfg.type.len}\`\n\n` +
                    `🔙 *رجوع*`
                ));
                state = "PIN";
                return;
            }
            await editMenu(buildMethodMenu(cfg.type));
            state = "METHOD";
            return;
        }

        if (state === "METHOD") {
            if (input === "رجوع") { await editMenu(buildTypeMenu(cfg.mode)); state = "TYPE"; return; }
            if (!["1", "2", "3"].includes(input)) return;
            cfg.method = Number(input);

            if (cfg.method === 1) {
                await say(buildConfirm(cfg));
                state = "CONFIRM";
            } else if (cfg.method === 2) {
                await say(frame(
                    `🔤 *ارسل الاحرف/الارقام المخصصة.*\n` +
                    `\`مثال : 212 او Abz\`\n` +
                    `\`الحد الاقصى : ${cfg.type.len} احرف\`\n\n🔙 *رجوع*`
                ));
                state = "CUSTOM";
            } else {
                await say(frame(
                    `🎯 *ارسل النمط بطول ${cfg.type.len}* (استخدم # لأي حرف عشوائي).\n` +
                    `\`مثال : a#${"#".repeat(Math.max(cfg.type.len - 2, 0))}\`\n\n🔙 *رجوع*`
                ));
                state = "PATTERN";
            }
            return;
        }

        if (state === "CUSTOM") {
            if (input === "رجوع") { await editMenu(buildMethodMenu(cfg.type)); state = "METHOD"; return; }
            const v = input.replace(/\s+/g, "");
            if (!/^[A-Za-z0-9._]+$/.test(v) || v.length > cfg.type.len) {
                await react(newMsg.key, "❌");
                return;
            }
            cfg.custom = v;
            await say(buildConfirm(cfg));
            state = "CONFIRM";
            return;
        }

        if (state === "PATTERN") {
            if (input === "رجوع") { await editMenu(buildMethodMenu(cfg.type)); state = "METHOD"; return; }
            const v = input.replace(/\s+/g, "");
            if (!/^[A-Za-z0-9._#]+$/.test(v) || v.length !== cfg.type.len || !/^[A-Za-z_#]/.test(v)) {
                await react(newMsg.key, "❌");
                return;
            }
            cfg.pattern = v;
            await say(buildConfirm(cfg));
            state = "CONFIRM";
            return;
        }

        if (state === "PIN") {
            if (input === "رجوع") { await editMenu(buildTypeMenu(cfg.mode)); state = "TYPE"; return; }
            const v = input.replace(/\s+/g, "");
            if (!/^[A-Za-z0-9._]+$/.test(v) || v.length >= cfg.type.len) {
                await react(newMsg.key, "❌");
                return;
            }
            cfg.pin = v;
            cfg.method = 1;
            await say(buildConfirm(cfg));
            state = "CONFIRM";
            return;
        }

        if (state === "CONFIRM") {
            if (input === "رجوع") {
                if (cfg.mode === 3) { await editMenu(buildTypeMenu(cfg.mode)); state = "TYPE"; }
                else { await editMenu(buildMethodMenu(cfg.type)); state = "METHOD"; }
                return;
            }
            if (["نعم", "اجل", "أجل", "تم"].includes(input)) {
                state = "HUNTING";
                startHunt().catch(async (e) => {
                    console.error("Hunt Error:", e);
                    hunting = false;
                    await say(`❌ حدث خطأ غير متوقع: ${e.message}`);
                    endSession();
                });
            }
            return;
        }
    };

    sock.ev.on("messages.upsert", listener);

    const timeoutId = setTimeout(() => {
        sock.ev.off("messages.upsert", listener);
        activeSessions.delete(chatId);
    }, 300_000);

    activeSessions.set(chatId, { listener, timeout: timeoutId, stop: () => { stopRequested = true; } });
}

export default { NovaUltra, execute };
