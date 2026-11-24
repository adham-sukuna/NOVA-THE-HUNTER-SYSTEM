import {
    getHunters,
    saveHunters
} from "./storage.js";

import {
    getClass
} from "./ClassEngine.js";

import {
    calculatePassiveSkillEffects
} from "./SkillEngine.js";

import {
    calculateEquipmentStats
} from "./EquipmentEngine.js";


const STAT_NAMES = [
    "STR",
    "AGI",
    "INT",
    "VIT",
    "LUK"
];


const TALENT_BONUSES = {
    strong_body: {
        VIT: 3
    },

    quick_reflex: {
        AGI: 3
    },

    mana_sense: {
        INT: 3
    },

    lucky_fate: {
        LUK: 5
    },

    shadow_affinity: {
        INT: 2,
        LUK: 2
    }
};


// ==========================================
// BASIC HELPERS
// ==========================================

function getValidStats(stats = {}) {
    const result = {};

    for (const stat of STAT_NAMES) {
        const value = Number(stats[stat] ?? 0);

        result[stat] = Number.isFinite(value)
            ? Math.max(0, value)
            : 0;
    }

    return result;
}


function getSafeNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


function getTalentBonus(hunter) {
    const talentId = hunter?.talent?.id;

    return TALENT_BONUSES[talentId] || {};
}


function getClassBonus(hunter) {
    if (!hunter?.class) return {};

    const classData = getClass(hunter.class);

    return classData?.baseStats || {};
}


function getClassGrowth(hunter) {
    if (!hunter?.class) return {};

    const classData = getClass(hunter.class);

    return classData?.growth || {};
}


function getClassBonuses(hunter) {
    if (!hunter?.class) return {};

    const classData = getClass(hunter.class);

    return classData?.bonuses || {};
}


function getEquipmentBonuses(hunter) {
    if (!hunter?.id) {
        return {
            stats: {},
            percentages: {},
            specialEffects: []
        };
    }

    return calculateEquipmentStats(hunter.id);
}


function getPassiveBonuses(hunter) {
    return calculatePassiveSkillEffects(hunter) || {};
}


// ==========================================
// EFFECTIVE STATS
// ==========================================

/**
 * حساب الخصائص الفعلية باستخدام بيانات جاهزة.
 * الدالة الداخلية تمنع تكرار قراءة المعدات.
 */
function calculateEffectiveStats(
    hunter,
    equipment
) {
    const baseStats = getValidStats(hunter.stats);

    const classBonus = getValidStats(
        getClassBonus(hunter)
    );

    const talentBonus = getValidStats(
        getTalentBonus(hunter)
    );

    const growth = getValidStats(
        getClassGrowth(hunter)
    );

    const equipmentStats = getValidStats(
        equipment.stats
    );

    const level = Math.max(
        1,
        Math.floor(getSafeNumber(hunter.level, 1))
    );

    const effectiveStats = {};

    for (const stat of STAT_NAMES) {
        effectiveStats[stat] =
            baseStats[stat] +
            classBonus[stat] +
            talentBonus[stat] +
            growth[stat] * (level - 1) +
            equipmentStats[stat];
    }

    return effectiveStats;
}


/**
 * الخصائص الفعلية للصياد.
 *
 * Base Stats
 * Class Bonus
 * Talent Bonus
 * Level Growth
 * Equipment Stats
 */
export function getEffectiveStats(hunter) {
    if (!hunter) return null;

    const equipment = getEquipmentBonuses(hunter);

    return calculateEffectiveStats(
        hunter,
        equipment
    );
}


// ==========================================
// DERIVED STATS
// ==========================================

/**
 * حساب الخصائص الناتجة باستخدام بيانات جاهزة.
 */
function calculateDerivedStatsWithContext(
    hunter,
    equipment,
    passive
) {
    const stats = calculateEffectiveStats(
        hunter,
        equipment
    );

    const bonuses = getClassBonuses(hunter);

    const equipmentPercent = equipment.percentages || {};

    // نسب الصحة والمانا.
    const hpPercent =
        getSafeNumber(bonuses.hpPercent) +
        getSafeNumber(equipmentPercent.hpPercent);

    const mpPercent =
        getSafeNumber(bonuses.mpPercent) +
        getSafeNumber(passive.maxMpPercent) +
        getSafeNumber(equipmentPercent.mpPercent);

    // نسب الضرر.
    const physicalDamagePercent =
        getSafeNumber(bonuses.physicalDamage) +
        getSafeNumber(passive.physicalDamagePercent) +
        getSafeNumber(equipmentPercent.physicalDamagePercent);

    const magicDamagePercent =
        getSafeNumber(bonuses.magicDamage) +
        getSafeNumber(passive.magicDamagePercent) +
        getSafeNumber(equipmentPercent.magicDamagePercent);

    // الدفاع.
    const defensePercent =
        getSafeNumber(passive.defensePercent) +
        getSafeNumber(equipmentPercent.defensePercent);

    // السرعة.
    const speedPercent =
        getSafeNumber(passive.speedPercent) +
        getSafeNumber(equipmentPercent.speedPercent);

    // الصحة القصوى.
    const maxHp = Math.floor(
        (100 + stats.VIT * 20) *
        (1 + hpPercent / 100)
    );

    // المانا القصوى.
    const maxMp = Math.floor(
        (50 + stats.INT * 15) *
        (1 + mpPercent / 100)
    );

    // الضرر الجسدي.
    const basePhysicalDamage = Math.floor(
        stats.STR * 3 +
        stats.AGI * 1.5
    );

    // الضرر السحري.
    const baseMagicDamage = Math.floor(
        stats.INT * 4
    );

    // الدفاع.
    const baseDefense = Math.floor(
        stats.VIT * 2 +
        stats.STR * 0.5 +
        getSafeNumber(bonuses.defense)
    );

    // الضربات الحرجة.
    const criticalRate = Math.min(
        75,
        Math.max(
            0,
            Math.floor(
                stats.LUK * 0.5 +
                stats.AGI * 0.25 +
                getSafeNumber(bonuses.criticalRate) +
                getSafeNumber(passive.criticalRate) +
                getSafeNumber(equipmentPercent.criticalRate)
            )
        )
    );

    const criticalDamage =
        150 +
        stats.STR * 0.5 +
        getSafeNumber(bonuses.criticalDamage) +
        getSafeNumber(equipmentPercent.criticalDamage);

    // السرعة.
    const baseSpeed = Math.floor(
        stats.AGI * 2
    );

    // الدقة.
    const accuracy = Math.floor(
        stats.AGI +
        stats.LUK * 0.5 +
        getSafeNumber(passive.accuracy)
    );

    // المراوغة.
    const evasion = Math.floor(
        stats.AGI * 1.5 +
        stats.LUK * 0.5
    );

    return {
        maxHp,
        maxMp,

        physicalDamage: Math.floor(
            basePhysicalDamage *
            (1 + physicalDamagePercent / 100)
        ),

        magicDamage: Math.floor(
            baseMagicDamage *
            (1 + magicDamagePercent / 100)
        ),

        defense: Math.floor(
            baseDefense *
            (1 + defensePercent / 100)
        ),

        criticalRate,
        criticalDamage,

        speed: Math.floor(
            baseSpeed *
            (1 + speedPercent / 100)
        ),

        accuracy,
        evasion,

        equipmentEffects: Array.isArray(
            equipment.specialEffects
        )
            ? structuredClone(equipment.specialEffects)
            : []
    };
}


/**
 * حساب الخصائص الناتجة.
 */
export function calculateDerivedStats(hunter) {
    if (!hunter) return null;

    const equipment = getEquipmentBonuses(hunter);

    const passive = getPassiveBonuses(hunter);

    return calculateDerivedStatsWithContext(
        hunter,
        equipment,
        passive
    );
}


// ==========================================
// HUNTER VITALS
// ==========================================

/**
 * تحديث الصحة والمانا.
 */
export function updateHunterVitals(
    hunter,
    refill = false
) {
    if (!hunter) return null;

    const oldHp = getSafeNumber(hunter.hp);
    const oldMp = getSafeNumber(hunter.mp);

    const derived = calculateDerivedStats(hunter);

    hunter.maxHp = derived.maxHp;
    hunter.maxMp = derived.maxMp;

    if (refill) {
        hunter.hp = hunter.maxHp;
        hunter.mp = hunter.maxMp;
    } else {
        hunter.hp = Math.min(
            oldHp,
            hunter.maxHp
        );

        hunter.mp = Math.min(
            oldMp,
            hunter.maxMp
        );
    }

    return {
        hp: hunter.hp,
        maxHp: hunter.maxHp,
        mp: hunter.mp,
        maxMp: hunter.maxMp
    };
}


// ==========================================
// STAT SUMMARY
// ==========================================

/**
 * ملخص الخصائص.
 */
export function getStatSummary(hunter) {
    if (!hunter) return null;

    const equipment = getEquipmentBonuses(hunter);

    const passive = getPassiveBonuses(hunter);

    const effective = calculateEffectiveStats(
        hunter,
        equipment
    );

    const derived = calculateDerivedStatsWithContext(
        hunter,
        equipment,
        passive
    );

    return {
        base: getValidStats(hunter.stats),

        effective,

        derived,

        passiveEffects: passive,

        equipment,

        availablePoints: Math.max(
            0,
            getSafeNumber(hunter.statPoints)
        )
    };
}


// ==========================================
// STAT ALLOCATION
// ==========================================

/**
 * توزيع نقاط الخصائص.
 */
export function allocateStats(
    hunterId,
    allocations = {}
) {
    if (
        !hunterId ||
        !allocations ||
        typeof allocations !== "object" ||
        Array.isArray(allocations)
    ) {
        return {
            success: false,
            reason: "INVALID_ARGUMENTS"
        };
    }

    const hunters = getHunters();

    const hunter = hunters[hunterId] ||
        Object.values(hunters).find(
            item => item?.id === hunterId
        );

    if (!hunter) {
        return {
            success: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    if (!hunter.stats) {
        hunter.stats = {
            STR: 5,
            AGI: 5,
            INT: 5,
            VIT: 5,
            LUK: 5
        };
    }

    let totalPoints = 0;

    const normalized = {};

    for (
        const [stat, rawValue]
        of Object.entries(allocations)
    ) {
        if (!STAT_NAMES.includes(stat)) {
            return {
                success: false,
                reason: "INVALID_STAT",
                stat
            };
        }

        const value = Number(rawValue);

        if (
            !Number.isSafeInteger(value) ||
            value <= 0
        ) {
            return {
                success: false,
                reason: "INVALID_AMOUNT",
                stat
            };
        }

        normalized[stat] = value;

        totalPoints += value;
    }

    if (totalPoints === 0) {
        return {
            success: false,
            reason: "NO_POINTS"
        };
    }

    const availablePoints = Math.max(
        0,
        Math.floor(
            getSafeNumber(hunter.statPoints)
        )
    );

    if (totalPoints > availablePoints) {
        return {
            success: false,
            reason: "NOT_ENOUGH_POINTS",
            available: availablePoints,
            required: totalPoints
        };
    }

    for (
        const [stat, value]
        of Object.entries(normalized)
    ) {
        hunter.stats[stat] =
            getSafeNumber(hunter.stats[stat]) + value;
    }

    hunter.statPoints = availablePoints - totalPoints;

    hunter.lastActive = Date.now();

    updateHunterVitals(hunter, false);

    saveHunters(hunters);

    return {
        success: true,

        hunter,

        allocated: normalized,

        remainingPoints: hunter.statPoints,

        summary: getStatSummary(hunter)
    };
}


// ==========================================
// STAT DEFINITIONS
// ==========================================

/**
 * تعريفات الخصائص.
 */
export function getStatDefinitions() {
    return {
        STR: {
            name: "القوة",
            description: "ترفع الضرر الجسدي."
        },

        AGI: {
            name: "الرشاقة",
            description: "ترفع السرعة والدقة والمراوغة."
        },

        INT: {
            name: "الذكاء",
            description: "يرفع قوة السحر والمانا."
        },

        VIT: {
            name: "الحيوية",
            description: "ترفع نقاط الصحة والدفاع."
        },

        LUK: {
            name: "الحظ",
            description: "يرفع فرص الضربات الحرجة والمراوغة."
        }
    };
}
