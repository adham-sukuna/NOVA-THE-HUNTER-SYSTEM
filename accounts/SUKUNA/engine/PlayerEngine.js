import {
    getHunters,
    saveHunters
} from "./storage.js";

import {
    calculateDerivedStats
} from "./StatEngine.js";


const TALENTS = [
    {
        id: "strong_body",
        name: "الجسد القوي",
        rarity: "Common",
        description: "زيادة التحمل الأساسي."
    },
    {
        id: "quick_reflex",
        name: "رد الفعل السريع",
        rarity: "Common",
        description: "زيادة الرشاقة الأساسية."
    },
    {
        id: "mana_sense",
        name: "الإحساس بالمانا",
        rarity: "Rare",
        description: "زيادة الذكاء الأساسي."
    },
    {
        id: "lucky_fate",
        name: "الحظ الأسطوري",
        rarity: "Epic",
        description: "موهبة نادرة مرتبطة بالحظ."
    },
    {
        id: "shadow_affinity",
        name: "التوافق مع الظلال",
        rarity: "Legendary",
        description: "استعداد فطري لقوى الظلال."
    }
];


const VALID_ID_SUFFIXES = [
    "@s.whatsapp.net",
    "@lid"
];


function normalizeIdentity(id) {
    if (!id || typeof id !== "string") {
        return null;
    }

    const clean = id.trim().split(":")[0];

    if (!clean || clean === "BOT") {
        return null;
    }

    const isValid = VALID_ID_SUFFIXES.some(
        suffix => clean.endsWith(suffix)
    );

    if (isValid) {
        return clean;
    }

    if (/^\d+$/.test(clean)) {
        return `${clean}@s.whatsapp.net`;
    }

    return null;
}


function createTalent() {
    const roll = Math.random() * 100;

    if (roll < 1) return { ...TALENTS[4] };
    if (roll < 6) return { ...TALENTS[3] };
    if (roll < 21) return { ...TALENTS[2] };
    if (roll < 51) return { ...TALENTS[1] };

    return { ...TALENTS[0] };
}


/**
 * استخراج هويات اللاعب من رسالة واتساب.
 */
export function resolveHunterIdentity({ msg, sender } = {}) {
    const remoteJid = msg?.key?.remoteJid;
    const participant = msg?.key?.participant;

    const isGroup =
        typeof remoteJid === "string" &&
        remoteJid.endsWith("@g.us");

    const pn = normalizeIdentity(
        sender?.pn ||
        (
            typeof participant === "string" &&
            participant.endsWith("@s.whatsapp.net")
                ? participant
                : null
        ) ||
        (
            !isGroup &&
            typeof remoteJid === "string" &&
            remoteJid.endsWith("@s.whatsapp.net")
                ? remoteJid
                : null
        )
    );

    const lid = normalizeIdentity(
        sender?.lid ||
        (
            typeof participant === "string" &&
            participant.endsWith("@lid")
                ? participant
                : null
        ) ||
        (
            !isGroup &&
            typeof remoteJid === "string" &&
            remoteJid.endsWith("@lid")
                ? remoteJid
                : null
        )
    );

    return {
        pn,
        lid,
        primary: pn || lid
    };
}


/**
 * توافق مع الدالة القديمة.
 */
export function getHunterId(msg) {
    return resolveHunterIdentity({ msg }).primary;
}


/**
 * تحويل أي مدخل إلى قائمة هويات موحدة.
 */
function normalizeIdentityList(identity) {
    const identities = Array.isArray(identity)
        ? identity
        : [identity];

    return [
        ...new Set(
            identities
                .map(normalizeIdentity)
                .filter(Boolean)
        )
    ];
}


/**
 * البحث داخل مجموعة بيانات محددة.
 *
 * مهم:
 * الدالة دي لا تقرأ ملف JSON بنفسها،
 * وده بيضمن إن التعديل والحفظ يتموا على نفس البيانات.
 */
function findHuntersInCollection(hunters, identity) {
    const normalized = normalizeIdentityList(identity);

    if (!normalized.length) {
        return [];
    }

    const matches = new Set();

    // البحث المباشر باستخدام مفاتيح قاعدة البيانات.
    for (const id of normalized) {
        if (hunters[id]) {
            matches.add(hunters[id]);
        }
    }

    // البحث باستخدام الهويات المخزنة داخل الشخصية.
    for (const hunter of Object.values(hunters)) {
        if (!hunter || typeof hunter !== "object") {
            continue;
        }

        const stored = [
            hunter.id,
            hunter.identities?.pn,
            hunter.identities?.lid
        ]
            .map(normalizeIdentity)
            .filter(Boolean);

        if (normalized.some(id => stored.includes(id))) {
            matches.add(hunter);
        }
    }

    return [...matches];
}


/**
 * البحث عن صياد باستخدام أي هوية مرتبطة به.
 */
export function getHunterByIdentity(identity) {
    const hunters = getHunters();

    const matches = findHuntersInCollection(
        hunters,
        identity
    );

    return matches[0] || null;
}


/**
 * ربط هويات PN وLID بالشخصية.
 *
 * هذه الدالة تعدّل كائن الصياد فقط.
 * حفظ التعديلات يتم بواسطة الدالة المستدعية.
 */
export function linkHunterIdentities(hunter, identity) {
    if (!hunter || !identity) {
        return false;
    }

    const pn = normalizeIdentity(identity.pn);
    const lid = normalizeIdentity(identity.lid);

    if (!pn && !lid) {
        return false;
    }

    hunter.identities ??= {
        pn: null,
        lid: null
    };

    if (pn) {
        hunter.identities.pn = pn;
    }

    if (lid) {
        hunter.identities.lid = lid;
    }

    return true;
}


/**
 * البحث عن شخصية الصياد.
 */
export function getHunter(id) {
    return getHunterByIdentity(id);
}


/**
 * تحديث الصحة والمانا.
 */
export function refreshHunterVitals(hunter, options = {}) {
    if (!hunter) {
        return null;
    }

    const {
        refill = false
    } = options;

    const oldHp = Number(hunter.hp || 0);
    const oldMp = Number(hunter.mp || 0);

    const derived = calculateDerivedStats(hunter);

    if (!derived) {
        return null;
    }

    hunter.maxHp = derived.maxHp;
    hunter.maxMp = derived.maxMp;

    if (refill) {
        hunter.hp = hunter.maxHp;
        hunter.mp = hunter.maxMp;
    } else {
        hunter.hp = Math.min(oldHp, hunter.maxHp);
        hunter.mp = Math.min(oldMp, hunter.maxMp);
    }

    return {
        hp: hunter.hp,
        maxHp: hunter.maxHp,
        mp: hunter.mp,
        maxMp: hunter.maxMp
    };
}


/**
 * إنشاء شخصية صياد.
 */
export function createHunter(identity, name = "Unknown Hunter") {
    let identities;

    if (typeof identity === "string") {
        const normalized = normalizeIdentity(identity);

        identities = {
            pn: normalized?.endsWith("@s.whatsapp.net")
                ? normalized
                : null,

            lid: normalized?.endsWith("@lid")
                ? normalized
                : null
        };
    } else {
        identities = {
            pn: normalizeIdentity(identity?.pn),
            lid: normalizeIdentity(identity?.lid)
        };
    }

    const primaryId = identities.pn || identities.lid;

    if (!primaryId) {
        throw new Error("Invalid hunter identity");
    }

    // قراءة واحدة فقط، واستخدام نفس البيانات حتى الحفظ.
    const hunters = getHunters();

    const existingMatches = findHuntersInCollection(
        hunters,
        [
            identities.pn,
            identities.lid
        ]
    );

    // لو PN وLID مرتبطين بشخصيتين مختلفتين،
    // نوقف العملية بدل ربط هويتين بشخصية خاطئة.
    if (existingMatches.length > 1) {
        throw new Error("HUNTER_IDENTITY_CONFLICT");
    }

    // الشخصية موجودة بالفعل.
    if (existingMatches.length === 1) {
        const existingHunter = existingMatches[0];

        linkHunterIdentities(
            existingHunter,
            identities
        );

        existingHunter.lastActive = Date.now();

        saveHunters(hunters);

        return null;
    }

    const now = Date.now();

    const hunter = {
        id: primaryId,

        identities,

        name,

        createdAt: now,
        lastActive: now,

        level: 1,
        rank: "E",

        xp: 0,
        xpRequired: 100,

        class: null,
        talent: createTalent(),

        hp: 100,
        maxHp: 100,

        mp: 50,
        maxMp: 50,

        gold: 500,
        gems: 0,

        skillPoints: 0,
        statPoints: 0,

        stats: {
            STR: 5,
            AGI: 5,
            INT: 5,
            VIT: 5,
            LUK: 5
        },

        equipment: {
            weapon: null,
            helmet: null,
            armor: null,
            gloves: null,
            boots: null,
            ring: null,
            necklace: null
        },

        inventory: [],

        skills: [],
        shadows: [],
        achievements: []
    };

    refreshHunterVitals(hunter, {
        refill: true
    });

    hunters[primaryId] = hunter;

    saveHunters(hunters);

    return hunter;
}


/**
 * حساب الخبرة المطلوبة.
 */
export function getXPRequired(level) {
    const safeLevel = Math.max(
        1,
        Math.floor(Number(level) || 1)
    );

    return Math.floor(
        100 * Math.pow(safeLevel, 1.5)
    );
}


/**
 * إضافة الخبرة واحتساب المستويات.
 */
export function addXP(id, amount) {
    // قراءة واحدة فقط.
    const hunters = getHunters();

    // البحث داخل نفس المجموعة التي سيتم حفظها.
    const matches = findHuntersInCollection(
        hunters,
        id
    );

    if (!matches.length) {
        return {
            success: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    if (matches.length > 1) {
        return {
            success: false,
            reason: "HUNTER_IDENTITY_CONFLICT"
        };
    }

    const hunter = matches[0];

    const xpAmount = Number(amount);

    if (!Number.isFinite(xpAmount) || xpAmount <= 0) {
        return {
            success: false,
            reason: "INVALID_XP_AMOUNT"
        };
    }

    hunter.xp = Number(hunter.xp || 0);

    hunter.level = Math.max(
        1,
        Math.floor(Number(hunter.level) || 1)
    );

    hunter.xpRequired =
        Number(hunter.xpRequired) > 0
            ? Number(hunter.xpRequired)
            : getXPRequired(hunter.level);

    hunter.statPoints = Number(hunter.statPoints || 0);
    hunter.skillPoints = Number(hunter.skillPoints || 0);

    const previousLevel = hunter.level;

    hunter.xp += xpAmount;

    let levelsGained = 0;

    while (hunter.xp >= hunter.xpRequired) {
        hunter.xp -= hunter.xpRequired;

        hunter.level++;

        hunter.statPoints += 5;
        hunter.skillPoints += 1;

        hunter.xpRequired = getXPRequired(
            hunter.level
        );

        levelsGained++;
    }

    refreshHunterVitals(hunter, {
        refill: levelsGained > 0
    });

    hunter.lastActive = Date.now();

    saveHunters(hunters);

    return {
        success: true,

        hunter,

        xpGained: xpAmount,

        previousLevel,
        currentLevel: hunter.level,

        levelsGained,

        remainingXP: hunter.xp,
        xpRequired: hunter.xpRequired,

        statPointsGained: levelsGained * 5,
        skillPointsGained: levelsGained
    };
}


/**
 * قائمة المواهب.
 */
export function getTalentList() {
    return TALENTS.map(talent => ({
        ...talent
    }));
}
