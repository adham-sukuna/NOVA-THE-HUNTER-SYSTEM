import {
    getEffectiveStats,
    calculateDerivedStats
} from "./StatEngine.js";

import {
    getSkill,
    calculateSkillPower
} from "./SkillEngine.js";


const SIDES = [
    "hunter",
    "enemy"
];


const DAMAGE_TYPES = [
    "physical",
    "magic"
];


const BERSERKER_HP_THRESHOLD = 30;


// ==========================================
// GENERAL HELPERS
// ==========================================

function safeNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


function randomInt(min, max) {
    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}


function clamp(value, min, max) {
    return Math.min(
        max,
        Math.max(min, value)
    );
}


function normalizeStats(stats = {}) {
    return {
        STR: Math.max(0, safeNumber(stats.STR)),
        AGI: Math.max(0, safeNumber(stats.AGI)),
        INT: Math.max(0, safeNumber(stats.INT)),
        VIT: Math.max(0, safeNumber(stats.VIT)),
        LUK: Math.max(0, safeNumber(stats.LUK))
    };
}


// ==========================================
// CLASS HELPERS
// ==========================================

function getClassId(classValue) {
    if (!classValue) return null;

    if (typeof classValue === "string") {
        return classValue;
    }

    if (typeof classValue === "object") {
        return (
            classValue.id ||
            classValue.key ||
            classValue.classId ||
            null
        );
    }

    return null;
}


function isClassAllowed(hunterClass, skillClass) {
    if (!skillClass) return true;

    const hunterClassId = getClassId(hunterClass);

    if (!hunterClassId) return false;

    const allowedClasses = Array.isArray(skillClass)
        ? skillClass
        : [skillClass];

    return allowedClasses.some(classValue => {
        return getClassId(classValue) === hunterClassId;
    });
}


// ==========================================
// EQUIPMENT EFFECTS
// ==========================================

function normalizeEquipmentEffects(effects) {
    if (!Array.isArray(effects)) {
        return [];
    }

    return effects
        .filter(effect => {
            return (
                effect &&
                typeof effect.id === "string"
            );
        })
        .map(effect => ({
            id: effect.id,

            value: Math.max(
                0,
                safeNumber(effect.value)
            )
        }));
}


function getEquipmentEffectValue(combatant, effectId) {
    if (!Array.isArray(combatant?.equipmentEffects)) {
        return 0;
    }

    return combatant.equipmentEffects
        .filter(effect => effect.id === effectId)
        .reduce(
            (total, effect) => {
                return total + safeNumber(effect.value);
            },
            0
        );
}


// ==========================================
// BERSERKER
// ==========================================

function hasBerserkerEffect(combatant) {
    return (
        getEquipmentEffectValue(
            combatant,
            "berserker"
        ) > 0
    );
}


function isBerserkerActive(combatant) {
    if (!hasBerserkerEffect(combatant)) {
        return false;
    }

    if (combatant.maxHp <= 0) {
        return false;
    }

    const hpPercentage =
        (combatant.hp / combatant.maxHp) * 100;

    return hpPercentage <= BERSERKER_HP_THRESHOLD;
}


function getEquipmentDamageMultiplier(combatant) {
    if (!isBerserkerActive(combatant)) {
        return 1;
    }

    const berserker = getEquipmentEffectValue(
        combatant,
        "berserker"
    );

    return Math.max(
        1,
        1 + berserker / 100
    );
}


function getEquipmentCriticalBonus(combatant) {
    return getEquipmentEffectValue(
        combatant,
        "critical_boost"
    );
}


function getEquipmentCooldownMultiplier(combatant) {
    const reduction = clamp(
        getEquipmentEffectValue(
            combatant,
            "cooldown_reduction"
        ),
        0,
        90
    );

    return 1 - reduction / 100;
}


// ==========================================
// MONSTER DERIVED STATS
// ==========================================

function calculateEnemyDerivedStats(stats = {}) {
    const values = normalizeStats(stats);

    const physicalDamage = Math.floor(
        values.STR * 3 +
        values.AGI * 1.5
    );

    const magicDamage = Math.floor(
        values.INT * 4
    );

    const defense = Math.floor(
        values.VIT * 2 +
        values.STR * 0.5
    );

    const criticalRate = Math.min(
        75,
        Math.floor(
            values.LUK * 0.5 +
            values.AGI * 0.25
        )
    );

    const criticalDamage =
        150 + values.STR * 0.5;

    const speed = Math.floor(
        values.AGI * 2
    );

    const accuracy = Math.floor(
        values.AGI +
        values.LUK * 0.5
    );

    const evasion = Math.floor(
        values.AGI * 1.5 +
        values.LUK * 0.5
    );

    return {
        maxHp: Math.floor(
            100 + values.VIT * 20
        ),

        maxMp: Math.floor(
            50 + values.INT * 15
        ),

        physicalDamage,
        magicDamage,
        defense,
        criticalRate,
        criticalDamage,
        speed,
        accuracy,
        evasion
    };
}


// ==========================================
// COMBATANT CREATION
// ==========================================

function createCombatant(source, side) {
    if (!source || typeof source !== "object") {
        throw new Error("INVALID_COMBATANT");
    }

    const isHunter = side === "hunter";

    const effective = isHunter
        ? getEffectiveStats(source)
        : normalizeStats(
            source.effectiveStats || source.stats || {}
        );

    const derived = isHunter
        ? calculateDerivedStats(source)
        : {
            ...calculateEnemyDerivedStats(
                source.effectiveStats || source.stats || {}
            ),

            ...(source.derived || {})
        };

    if (!effective || !derived) {
        throw new Error("INVALID_COMBATANT_STATS");
    }

    const maxHp = Math.max(
        1,
        safeNumber(
            source.maxHp,
            safeNumber(derived.maxHp, 100)
        )
    );

    const maxMp = Math.max(
        0,
        safeNumber(
            source.maxMp,
            safeNumber(derived.maxMp, 0)
        )
    );

    const hp = clamp(
        safeNumber(source.hp, maxHp),
        0,
        maxHp
    );

    const mp = clamp(
        safeNumber(source.mp, maxMp),
        0,
        maxMp
    );

    return {
        id: source.id || side,

        name: source.name || (
            isHunter
                ? "الصياد"
                : "الوحش"
        ),

        side,

        level: Math.max(
            1,
            safeNumber(source.level, 1)
        ),

        rank: source.rank || "E",

        class: source.class || null,

        hp,
        maxHp,

        mp,
        maxMp,

        stats: normalizeStats(effective),

        derived: {
            physicalDamage: safeNumber(derived.physicalDamage),

            magicDamage: safeNumber(derived.magicDamage),

            defense: safeNumber(derived.defense),

            criticalRate: safeNumber(derived.criticalRate),

            criticalDamage: safeNumber(
                derived.criticalDamage,
                150
            ),

            speed: safeNumber(derived.speed),

            accuracy: safeNumber(derived.accuracy),

            evasion: safeNumber(derived.evasion)
        },

        equipmentEffects: isHunter
            ? normalizeEquipmentEffects(
                derived.equipmentEffects
            )
            : [],

        skills: isHunter && Array.isArray(source.skills)
            ? [...source.skills]
            : [],

        skillLevels: isHunter &&
            source.skillLevels &&
            typeof source.skillLevels === "object" &&
            !Array.isArray(source.skillLevels)
            ? { ...source.skillLevels }
            : {},

        statuses: [],

        cooldowns: {}
    };
}


// ==========================================
// GENERAL COMBAT HELPERS
// ==========================================

function getOpponentSide(side) {
    return side === "hunter"
        ? "enemy"
        : "hunter";
}


function getCombatant(battle, side) {
    if (!SIDES.includes(side)) {
        return null;
    }

    return battle?.[side] || null;
}


function getActiveStatus(combatant, type) {
    if (!Array.isArray(combatant?.statuses)) {
        return null;
    }

    return combatant.statuses.find(status => {
        return (
            status.type === type &&
            status.remainingTurns > 0
        );
    }) || null;
}


function addStatus(combatant, status) {
    if (!combatant || !status?.type) {
        return false;
    }

    if (!Array.isArray(combatant.statuses)) {
        combatant.statuses = [];
    }

    const duration = Math.max(
        1,
        Math.floor(
            safeNumber(status.duration, 1)
        )
    );

    const newStatus = {
        type: status.type,

        value: safeNumber(status.value),

        remainingTurns: duration,

        source: status.source || null
    };

    const existingIndex = combatant.statuses.findIndex(
        item => item.type === status.type
    );

    if (existingIndex !== -1) {
        combatant.statuses[existingIndex] = newStatus;
    } else {
        combatant.statuses.push(newStatus);
    }

    return true;
}


function getStatusValue(combatant, type) {
    const status = getActiveStatus(
        combatant,
        type
    );

    return status
        ? safeNumber(status.value)
        : 0;
}


// ==========================================
// DAMAGE CALCULATIONS
// ==========================================

function reduceDamageByDefense(damage, defense) {
    const safeDamage = Math.max(
        0,
        safeNumber(damage)
    );

    const safeDefense = Math.max(
        0,
        safeNumber(defense)
    );

    const reduction = safeDefense / (
        safeDefense + 100
    );

    return Math.max(
        1,
        Math.floor(
            safeDamage * (1 - reduction)
        )
    );
}


function calculateHitChance(attacker, defender) {
    const accuracy = attacker.derived.accuracy;

    const evasion = defender.derived.evasion;

    const evasionBonus = getStatusValue(
        defender,
        "evasion"
    );

    return clamp(
        85 +
        accuracy * 0.1 -
        evasion * 0.1 -
        evasionBonus,
        10,
        98
    );
}


function calculateCriticalChance(attacker) {
    const bonus = getStatusValue(
        attacker,
        "critical"
    );

    return clamp(
        attacker.derived.criticalRate + bonus,
        0,
        75
    );
}


function calculateDamage({
    attacker,
    defender,
    baseDamage,
    damageType = "physical",
    canCritical = true
}) {
    let damage = Math.max(
        1,
        safeNumber(baseDamage, 1)
    );

    // Berserker: يعمل فقط عند انخفاض الصحة.

    damage *= getEquipmentDamageMultiplier(
        attacker
    );

    const isCritical = (
        canCritical &&
        randomInt(1, 100) <= calculateCriticalChance(attacker)
    );

    if (isCritical) {
        const criticalBonus = getEquipmentCriticalBonus(
            attacker
        );

        const criticalMultiplier = (
            attacker.derived.criticalDamage +
            criticalBonus
        ) / 100;

        damage = Math.floor(
            damage * criticalMultiplier
        );
    }

    damage = reduceDamageByDefense(
        damage,
        defender.derived.defense
    );

    const reductionPercent = clamp(
        getStatusValue(
            defender,
            "damageReduction"
        ),
        0,
        90
    );

    damage = Math.floor(
        damage *
        (1 - reductionPercent / 100)
    );

    return {
        damage: Math.max(1, damage),

        critical: isCritical,

        damageType
    };
}


function applyDamage(target, damage) {
    const actualDamage = Math.min(
        target.hp,
        Math.max(0, Math.floor(damage))
    );

    target.hp = Math.max(
        0,
        target.hp - actualDamage
    );

    return {
        damage: actualDamage,

        remainingHp: target.hp,

        defeated: target.hp <= 0
    };
}


// ==========================================
// EQUIPMENT BATTLE EFFECTS
// ==========================================

function applyVampirism(attacker, damage) {
    const percentage = clamp(
        getEquipmentEffectValue(
            attacker,
            "vampirism"
        ),
        0,
        100
    );

    if (percentage <= 0 || damage <= 0) {
        return 0;
    }

    const restored = Math.floor(
        damage * percentage / 100
    );

    const previousHp = attacker.hp;

    attacker.hp = Math.min(
        attacker.maxHp,
        attacker.hp + restored
    );

    return attacker.hp - previousHp;
}


function applyManaRegeneration(attacker) {
    const percentage = clamp(
        getEquipmentEffectValue(
            attacker,
            "mana_regeneration"
        ),
        0,
        100
    );

    if (percentage <= 0 || attacker.maxMp <= 0) {
        return 0;
    }

    const restored = Math.max(
        1,
        Math.floor(
            attacker.maxMp * percentage / 100
        )
    );

    const previousMp = attacker.mp;

    attacker.mp = Math.min(
        attacker.maxMp,
        attacker.mp + restored
    );

    return attacker.mp - previousMp;
}


function applyDamageReflection(
    defender,
    attacker,
    receivedDamage
) {
    const percentage = clamp(
        getEquipmentEffectValue(
            defender,
            "damage_reflection"
        ),
        0,
        100
    );

    if (
        percentage <= 0 ||
        receivedDamage <= 0 ||
        attacker.hp <= 0
    ) {
        return 0;
    }

    const reflected = Math.floor(
        receivedDamage * percentage / 100
    );

    if (reflected <= 0) {
        return 0;
    }

    const result = applyDamage(
        attacker,
        reflected
    );

    return result.damage;
}


function applyEquipmentOnHit(
    battle,
    attacker,
    defender,
    damage
) {
    const result = {
        vampirism: 0,

        manaRegeneration: 0,

        reflectedDamage: 0
    };

    if (damage <= 0) {
        return result;
    }

    result.vampirism = applyVampirism(
        attacker,
        damage
    );

    result.manaRegeneration = applyManaRegeneration(
        attacker
    );

    result.reflectedDamage = applyDamageReflection(
        defender,
        attacker,
        damage
    );

    if (
        result.vampirism > 0 ||
        result.manaRegeneration > 0 ||
        result.reflectedDamage > 0
    ) {
        addBattleLog(battle, {
            type: "equipment_effect",

            attacker: attacker.name,

            defender: defender.name,

            effects: { ...result },

            message: "تم تفعيل تأثيرات المعدات."
        });
    }

    return result;
}


// ==========================================
// BATTLE STATE
// ==========================================

function checkBattleResult(battle) {
    const hunterDefeated = battle.hunter.hp <= 0;

    const enemyDefeated = battle.enemy.hp <= 0;

    // --------------------------------------
    // DRAW
    // --------------------------------------

    if (hunterDefeated && enemyDefeated) {
        battle.status = "draw";

        battle.winner = null;
    }

    // --------------------------------------
    // DEFEAT
    // --------------------------------------

    else if (hunterDefeated) {
        battle.status = "defeat";

        battle.winner = "enemy";
    }

    // --------------------------------------
    // VICTORY
    // --------------------------------------

    else if (enemyDefeated) {
        battle.status = "victory";

        battle.winner = "hunter";
    }

    // --------------------------------------
    // ONGOING
    // --------------------------------------

    else {
        battle.status = "ongoing";

        battle.winner = null;
    }

    return battle.status;
}


function addBattleLog(battle, entry) {
    if (!Array.isArray(battle.logs)) {
        battle.logs = [];
    }

    battle.logs.push({
        turn: battle.turn,

        timestamp: Date.now(),

        ...entry
    });

    if (battle.logs.length > 100) {
        battle.logs.shift();
    }
}


function consumeMana(combatant, amount) {
    const cost = Math.max(
        0,
        Math.floor(
            safeNumber(amount)
        )
    );

    if (combatant.mp < cost) {
        return {
            success: false,

            required: cost,

            available: combatant.mp
        };
    }

    combatant.mp -= cost;

    return {
        success: true,

        remainingMp: combatant.mp
    };
}


// ==========================================
// BATTLE CREATION
// ==========================================

export function createBattle(hunter, enemy) {
    if (!hunter || !enemy) {
        return {
            success: false,
            reason: "INVALID_COMBATANTS"
        };
    }

    let hunterCombatant;
    let enemyCombatant;

    try {
        hunterCombatant = createCombatant(
            hunter,
            "hunter"
        );

        enemyCombatant = createCombatant(
            enemy,
            "enemy"
        );
    } catch {
        return {
            success: false,
            reason: "COMBATANT_CREATION_FAILED"
        };
    }

    const battle = {
        id: `battle_${Date.now()}_${randomInt(1000, 9999)}`,

        status: "ongoing",

        winner: null,

        turn: 1,

        createdAt: Date.now(),

        hunter: hunterCombatant,

        enemy: enemyCombatant,

        logs: []
    };

    // التحقق من حالة المقاتلين عند البداية.

    checkBattleResult(battle);

    addBattleLog(battle, {
        type: "battle_start",

        message: "بدأت المعركة."
    });

    return {
        success: true,
        battle
    };
}


// ==========================================
// BASIC ATTACK
// ==========================================

export function performBasicAttack(
    battle,
    attackerSide = "hunter"
) {
    if (!battle || battle.status !== "ongoing") {
        return {
            success: false,
            reason: "BATTLE_NOT_ACTIVE"
        };
    }

    if (!SIDES.includes(attackerSide)) {
        return {
            success: false,
            reason: "INVALID_SIDE"
        };
    }

    const attacker = getCombatant(
        battle,
        attackerSide
    );

    const defender = getCombatant(
        battle,
        getOpponentSide(attackerSide)
    );

    if (
        !attacker ||
        !defender ||
        attacker.hp <= 0 ||
        defender.hp <= 0
    ) {
        return {
            success: false,
            reason: "INVALID_COMBATANT_STATE"
        };
    }

    const hitChance = calculateHitChance(
        attacker,
        defender
    );

    const hit = randomInt(1, 100) <= hitChance;

    if (!hit) {
        addBattleLog(battle, {
            type: "miss",

            attacker: attacker.name,

            defender: defender.name,

            message: `${attacker.name} أخفق في إصابة ${defender.name}.`
        });

        return {
            success: true,

            hit: false,

            damage: 0,

            battle
        };
    }

    const result = calculateDamage({
        attacker,

        defender,

        baseDamage: attacker.derived.physicalDamage,

        damageType: "physical"
    });

    const applied = applyDamage(
        defender,
        result.damage
    );

    const equipmentEffects = applyEquipmentOnHit(
        battle,
        attacker,
        defender,
        applied.damage
    );

    addBattleLog(battle, {
        type: "basic_attack",

        attacker: attacker.name,

        defender: defender.name,

        damage: applied.damage,

        critical: result.critical,

        equipmentEffects,

        message: result.critical
            ? `${attacker.name} نفذ ضربة حرجة بقوة ${applied.damage}.`
            : `${attacker.name} تسبب في ${applied.damage} ضرر.`
    });

    // فحص النتيجة بعد جميع تأثيرات المعدات،
    // بما فيها Damage Reflection.

    checkBattleResult(battle);

    return {
        success: true,

        hit: true,

        ...result,

        ...applied,

        equipmentEffects,

        battle
    };
}


// ==========================================
// SKILL HELPERS
// ==========================================

function getSkillDamageType(skill) {
    if (DAMAGE_TYPES.includes(skill.damageType)) {
        return skill.damageType;
    }

    const scalingStat = typeof skill.scaling === "string"
        ? skill.scaling
        : skill.scaling?.stat;

    return scalingStat === "INT"
        ? "magic"
        : "physical";
}


function getSkillScaling(skill) {
    const scalingStat = typeof skill.scaling === "string"
        ? skill.scaling
        : skill.scaling?.stat;

    const allowedStats = [
        "STR",
        "AGI",
        "INT",
        "VIT",
        "LUK"
    ];

    return {
        stat: allowedStats.includes(scalingStat)
            ? scalingStat
            : "STR",

        multiplier: typeof skill.scaling === "object"
            ? Math.max(
                0,
                safeNumber(
                    skill.scaling.multiplier,
                    1
                )
            )
            : 1
    };
}


// ==========================================
// COOLDOWN
// ==========================================

/**
 * حساب مدة الانتظار الفعلية.
 *
 * مثال:
 * Base Cooldown: 5
 * Reduction: 20%
 * Result: 4 turns
 *
 * يتم استخدام Math.ceil حتى لا يتم
 * تقليل مدة الانتظار بشكل مبالغ فيه.
 */
function getEffectiveCooldown(
    baseCooldown,
    combatant
) {
    const cooldown = Math.max(
        0,
        Math.floor(
            safeNumber(baseCooldown)
        )
    );

    const multiplier = getEquipmentCooldownMultiplier(
        combatant
    );

    return Math.max(
        0,
        Math.ceil(cooldown * multiplier)
    );
}


/**
 * حساب الأدوار المتبقية.
 *
 * لو استخدمت المهارة في الدور 1
 * ومدة الانتظار 5:
 *
 * تصبح متاحة في الدور 6.
 */
function getRemainingCooldown(
    combatant,
    skillId,
    currentTurn
) {
    const cooldownUntil = Math.max(
        0,
        Math.floor(
            safeNumber(
                combatant.cooldowns?.[skillId]
            )
        )
    );

    return Math.max(
        0,
        cooldownUntil - currentTurn
    );
}


// ==========================================
// USE HUNTER SKILL
// ==========================================

export function useHunterSkill(battle, skillId) {
    if (!battle || battle.status !== "ongoing") {
        return {
            success: false,
            reason: "BATTLE_NOT_ACTIVE"
        };
    }

    const hunter = battle.hunter;

    const enemy = battle.enemy;

    if (
        !hunter ||
        !enemy ||
        hunter.hp <= 0 ||
        enemy.hp <= 0
    ) {
        return {
            success: false,
            reason: "INVALID_COMBATANT_STATE"
        };
    }

    if (
        typeof skillId !== "string" ||
        !skillId.trim()
    ) {
        return {
            success: false,
            reason: "INVALID_SKILL_ID"
        };
    }

    if (
        !hunter.cooldowns ||
        typeof hunter.cooldowns !== "object"
    ) {
        hunter.cooldowns = {};
    }

    if (
        !hunter.skillLevels ||
        typeof hunter.skillLevels !== "object"
    ) {
        hunter.skillLevels = {};
    }

    if (!Array.isArray(hunter.skills)) {
        hunter.skills = [];
    }

    const skill = getSkill(skillId);

    if (!skill) {
        return {
            success: false,
            reason: "SKILL_NOT_FOUND"
        };
    }

    if (skill.type !== "active") {
        return {
            success: false,
            reason: "NOT_ACTIVE_SKILL"
        };
    }

    if (!hunter.skills.includes(skill.id)) {
        return {
            success: false,
            reason: "SKILL_NOT_LEARNED"
        };
    }

    if (!isClassAllowed(hunter.class, skill.class)) {
        return {
            success: false,
            reason: "CLASS_NOT_ALLOWED"
        };
    }

    // --------------------------------------
    // COOLDOWN CHECK
    // --------------------------------------

    const remainingCooldown = getRemainingCooldown(
        hunter,
        skill.id,
        battle.turn
    );

    if (remainingCooldown > 0) {
        return {
            success: false,

            reason: "SKILL_ON_COOLDOWN",

            remainingTurns: remainingCooldown
        };
    }

    // --------------------------------------
    // SKILL LEVEL
    // --------------------------------------

    const skillLevel = Math.max(
        1,
        safeNumber(
            hunter.skillLevels[skill.id],
            1
        )
    );

    const power = calculateSkillPower(
        skill.id,
        skillLevel
    );

    if (
        power === null ||
        !Number.isFinite(Number(power)) ||
        Number(power) < 0
    ) {
        return {
            success: false,
            reason: "INVALID_SKILL_POWER"
        };
    }

    // --------------------------------------
    // SKILL EFFECTS
    // --------------------------------------

    const effects = (
        skill.effects &&
        typeof skill.effects === "object" &&
        !Array.isArray(skill.effects)
    )
        ? skill.effects
        : {};

    // --------------------------------------
    // MANA CHECK
    // --------------------------------------

    const mpCost = Math.max(
        0,
        Math.floor(
            safeNumber(skill.mpCost)
        )
    );

    if (hunter.mp < mpCost) {
        return {
            success: false,

            reason: "NOT_ENOUGH_MP",

            required: mpCost,

            available: hunter.mp
        };
    }

    const mpResult = consumeMana(
        hunter,
        mpCost
    );

    if (!mpResult.success) {
        return {
            success: false,
            reason: "NOT_ENOUGH_MP"
        };
    }

    // --------------------------------------
    // APPLY COOLDOWN
    // --------------------------------------

    const baseCooldown = Math.max(
        0,
        safeNumber(skill.cooldown)
    );

    const effectiveCooldown = getEffectiveCooldown(
        baseCooldown,
        hunter
    );

    hunter.cooldowns[skill.id] =
        battle.turn + effectiveCooldown;

    // --------------------------------------
    // DEFENSIVE EFFECTS
    // --------------------------------------

    if (safeNumber(effects.damageReduction) > 0) {
        addStatus(hunter, {
            type: "damageReduction",

            value: effects.damageReduction,

            duration: effects.duration || 1,

            source: skill.id
        });
    }

    if (safeNumber(effects.evasionPercent) > 0) {
        addStatus(hunter, {
            type: "evasion",

            value: effects.evasionPercent,

            duration: effects.duration || 1,

            source: skill.id
        });
    }

    // --------------------------------------
    // DAMAGE
    // --------------------------------------

    let damageResult = null;

    let equipmentEffects = {
        vampirism: 0,

        manaRegeneration: 0,

        reflectedDamage: 0
    };

    if (Number(power) > 0) {
        const scaling = getSkillScaling(skill);

        const scalingValue = safeNumber(
            hunter.stats[scaling.stat]
        );

        const damageType = getSkillDamageType(skill);

        const derivedDamage = damageType === "magic"
            ? hunter.derived.magicDamage
            : hunter.derived.physicalDamage;

        const baseDamage = Math.floor(
            Number(power) +
            scalingValue * 2 * scaling.multiplier +
            derivedDamage * 0.5
        );

        const hitChance = calculateHitChance(
            hunter,
            enemy
        );

        const hit = randomInt(1, 100) <= hitChance;

        if (hit) {
            const result = calculateDamage({
                attacker: hunter,

                defender: enemy,

                baseDamage,

                damageType
            });

            const applied = applyDamage(
                enemy,
                result.damage
            );

            equipmentEffects = applyEquipmentOnHit(
                battle,
                hunter,
                enemy,
                applied.damage
            );

            damageResult = {
                ...result,

                ...applied,

                hit: true
            };
        } else {
            damageResult = {
                hit: false,

                damage: 0,

                critical: false
            };
        }
    }

    // --------------------------------------
    // LOG
    // --------------------------------------

    addBattleLog(battle, {
        type: "skill",

        skill: skill.id,

        attacker: hunter.name,

        damage: damageResult?.damage || 0,

        critical: damageResult?.critical || false,

        equipmentEffects,

        message: damageResult?.hit === false
            ? `${hunter.name} استخدم ${skill.nameAr || skill.name} لكن الهجوم لم يصب الهدف.`
            : `${hunter.name} استخدم ${skill.nameAr || skill.name}.`
    });

    // فحص النتيجة بعد الانعكاس وجميع التأثيرات.

    checkBattleResult(battle);

    return {
        success: true,

        skill,

        damage: damageResult?.damage || 0,

        critical: damageResult?.critical || false,

        hit: damageResult?.hit !== false,

        remainingMp: hunter.mp,

        cooldown: effectiveCooldown,

        remainingCooldown: getRemainingCooldown(
            hunter,
            skill.id,
            battle.turn
        ),

        equipmentEffects,

        battle
    };
}


// ==========================================
// ENEMY ATTACK
// ==========================================

export function performEnemyAttack(battle) {
    return performBasicAttack(
        battle,
        "enemy"
    );
}


// ==========================================
// TURN MANAGEMENT
// ==========================================

export function advanceBattleTurn(battle) {
    if (!battle || battle.status !== "ongoing") {
        return {
            success: false,
            reason: "BATTLE_NOT_ACTIVE"
        };
    }

    for (const side of SIDES) {
        const combatant = battle[side];

        if (!combatant) continue;

        if (!Array.isArray(combatant.statuses)) {
            combatant.statuses = [];

            continue;
        }

        combatant.statuses = combatant.statuses
            .map(status => ({
                ...status,

                remainingTurns:
                    Math.max(
                        0,
                        safeNumber(status.remainingTurns) - 1
                    )
            }))
            .filter(status => {
                return status.remainingTurns > 0;
            });
    }

    battle.turn += 1;

    return {
        success: true,

        turn: battle.turn,

        battle
    };
}


// ==========================================
// MANA
// ==========================================

export function restoreMana(
    battle,
    side = "hunter",
    amount = 10
) {
    if (!battle || battle.status !== "ongoing") {
        return {
            success: false,
            reason: "BATTLE_NOT_ACTIVE"
        };
    }

    if (!SIDES.includes(side)) {
        return {
            success: false,
            reason: "INVALID_SIDE"
        };
    }

    const combatant = battle[side];

    if (!combatant || combatant.hp <= 0) {
        return {
            success: false,
            reason: "INVALID_COMBATANT_STATE"
        };
    }

    const restored = Math.max(
        0,
        Math.floor(
            safeNumber(amount)
        )
    );

    const previousMp = combatant.mp;

    combatant.mp = Math.min(
        combatant.maxMp,
        combatant.mp + restored
    );

    const actualRestored = combatant.mp - previousMp;

    addBattleLog(battle, {
        type: "restore_mp",

        target: combatant.name,

        amount: actualRestored,

        message: `${combatant.name} استعاد ${actualRestored} مانا.`
    });

    return {
        success: true,

        restored: actualRestored,

        remainingMp: combatant.mp,

        battle
    };
}


// ==========================================
// BATTLE STATUS
// ==========================================

export function getBattleStatus(battle) {
    if (!battle) return null;

    return {
        id: battle.id,

        status: battle.status,

        winner: battle.winner,

        turn: battle.turn,

        hunter: {
            name: battle.hunter.name,

            hp: battle.hunter.hp,

            maxHp: battle.hunter.maxHp,

            mp: battle.hunter.mp,

            maxMp: battle.hunter.maxMp,

            statuses: battle.hunter.statuses
        },

        enemy: {
            name: battle.enemy.name,

            hp: battle.enemy.hp,

            maxHp: battle.enemy.maxHp,

            mp: battle.enemy.mp,

            maxMp: battle.enemy.maxMp,

            statuses: battle.enemy.statuses
        }
    };
}


// ==========================================
// BATTLE LOGS
// ==========================================

export function getBattleLogs(battle) {
    if (!battle || !Array.isArray(battle.logs)) {
        return [];
    }

    return [...battle.logs];
}
