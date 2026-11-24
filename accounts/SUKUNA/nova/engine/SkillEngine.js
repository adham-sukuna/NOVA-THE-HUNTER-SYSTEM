import path from "path";
import { fileURLToPath } from "url";

import {
    readData,
    getHunters,
    saveHunters
} from "./storage.js";

import {
    getRankOrder
} from "./ClassEngine.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SKILLS_FILE = path.resolve(
    __dirname,
    "../database/skills.json"
);

const MAX_EQUIPPED_SKILLS = 4;

const DEFAULT_SKILLS = {};


/**
 * قراءة قاعدة بيانات المهارات.
 */
export function getSkills() {
    const skills = readData(
        SKILLS_FILE,
        DEFAULT_SKILLS
    );

    if (
        !skills ||
        typeof skills !== "object" ||
        Array.isArray(skills)
    ) {
        throw new Error(
            "NOVA SKILLS: Invalid skills database."
        );
    }

    return skills;
}


/**
 * الحصول على مهارة معينة.
 */
export function getSkill(skillId) {
    if (!skillId || typeof skillId !== "string") {
        return null;
    }

    const id = skillId.trim().toLowerCase();

    const skills = getSkills();

    return skills[id] || null;
}


/**
 * البحث عن مهارة بالاسم أو المعرف.
 */
export function findSkill(query) {
    if (!query || typeof query !== "string") {
        return null;
    }

    const value = query.trim().toLowerCase();

    const skills = getSkills();

    return Object.values(skills).find(skill => {
        return (
            skill.id?.toLowerCase() === value ||
            skill.name?.toLowerCase() === value ||
            skill.nameAr?.toLowerCase() === value
        );
    }) || null;
}


/**
 * الحصول على الصياد من قاعدة البيانات.
 */
function findHunter(hunters, hunterId) {
    if (!hunterId) return null;

    if (hunters[hunterId]) {
        return hunters[hunterId];
    }

    return Object.values(hunters).find(
        hunter => hunter?.id === hunterId
    ) || null;
}


/**
 * الحصول على مستوى المهارة.
 */
function getSkillLevel(hunter, skillId) {
    if (
        !hunter.skillLevels ||
        typeof hunter.skillLevels !== "object" ||
        Array.isArray(hunter.skillLevels)
    ) {
        hunter.skillLevels = {};
    }

    const level = Number(
        hunter.skillLevels[skillId] || 1
    );

    return Number.isSafeInteger(level) && level >= 1
        ? level
        : 1;
}


/**
 * تجهيز بيانات المهارات القديمة.
 */
function prepareHunterSkills(hunter) {
    if (!Array.isArray(hunter.skills)) {
        hunter.skills = [];
    }

    if (
        !hunter.skillLevels ||
        typeof hunter.skillLevels !== "object" ||
        Array.isArray(hunter.skillLevels)
    ) {
        hunter.skillLevels = {};
    }

    if (!Array.isArray(hunter.equippedSkills)) {
        hunter.equippedSkills = [];
    }

    hunter.skillPoints = Math.max(
        0,
        Math.floor(Number(hunter.skillPoints) || 0)
    );

    hunter.skills = [
        ...new Set(
            hunter.skills.filter(
                skillId => typeof skillId === "string"
            )
        )
    ];

    hunter.equippedSkills = [
        ...new Set(
            hunter.equippedSkills.filter(
                skillId => typeof skillId === "string"
            )
        )
    ];

    hunter.equippedSkills = hunter.equippedSkills.filter(
        skillId => {
            const skill = getSkill(skillId);

            return (
                skill &&
                skill.type === "active" &&
                hunter.skills.includes(skillId)
            );
        }
    );

    for (const skillId of hunter.skills) {
        if (!Number.isInteger(Number(hunter.skillLevels[skillId]))) {
            hunter.skillLevels[skillId] = 1;
        }
    }

    return hunter;
}


/**
 * التحقق من رتبة الصياد.
 */
function hasRequiredRank(hunter, requiredRank = "E") {
    const ranks = getRankOrder();

    const currentIndex = ranks.indexOf(
        hunter.rank || "E"
    );

    const requiredIndex = ranks.indexOf(
        requiredRank
    );

    if (currentIndex === -1 || requiredIndex === -1) {
        return false;
    }

    return currentIndex >= requiredIndex;
}


/**
 * التحقق من شروط فتح المهارة.
 */
export function canLearnSkill(hunter, skillId) {
    if (!hunter) {
        return {
            success: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    const skill = getSkill(skillId);

    if (!skill) {
        return {
            success: false,
            reason: "SKILL_NOT_FOUND"
        };
    }

    if (!["active", "passive"].includes(skill.type)) {
        return {
            success: false,
            reason: "INVALID_SKILL_TYPE"
        };
    }

    if (hunter.skills?.includes(skill.id)) {
        return {
            success: false,
            reason: "SKILL_ALREADY_LEARNED"
        };
    }

    if (
        skill.class &&
        hunter.class !== skill.class
    ) {
        return {
            success: false,
            reason: "CLASS_NOT_ALLOWED"
        };
    }

    const requiredLevel = Number(
        skill.unlockLevel ?? 1
    );

    if (
        !Number.isSafeInteger(requiredLevel) ||
        requiredLevel < 1
    ) {
        return {
            success: false,
            reason: "INVALID_SKILL_CONFIGURATION"
        };
    }

    if (Number(hunter.level || 1) < requiredLevel) {
        return {
            success: false,
            reason: "LEVEL_TOO_LOW",
            required: requiredLevel
        };
    }

    const requiredRank = skill.unlockRank || "E";

    if (!hasRequiredRank(hunter, requiredRank)) {
        return {
            success: false,
            reason: "RANK_TOO_LOW",
            required: requiredRank
        };
    }

    return {
        success: true,
        skill
    };
}


/**
 * تعلم مهارة جديدة.
 */
export function learnSkill(hunterId, skillId) {
    if (!hunterId || !skillId) {
        return {
            success: false,
            reason: "INVALID_ARGUMENTS"
        };
    }

    const hunters = getHunters();

    const hunter = findHunter(hunters, hunterId);

    if (!hunter) {
        return {
            success: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    prepareHunterSkills(hunter);

    const validation = canLearnSkill(
        hunter,
        skillId
    );

    if (!validation.success) {
        return validation;
    }

    const skill = validation.skill;

    const cost = Math.max(
        0,
        Math.floor(Number(skill.skillPointCost) || 0)
    );

    if (hunter.skillPoints < cost) {
        return {
            success: false,
            reason: "NOT_ENOUGH_SKILL_POINTS",
            required: cost,
            available: hunter.skillPoints
        };
    }

    hunter.skillPoints -= cost;

    hunter.skills.push(skill.id);

    hunter.skillLevels[skill.id] = 1;

    hunter.lastActive = Date.now();

    saveHunters(hunters);

    return {
        success: true,
        skill,
        hunter,
        pointsSpent: cost,
        remainingPoints: hunter.skillPoints
    };
}


/**
 * ترقية مهارة.
 */
export function upgradeSkill(hunterId, skillId) {
    if (!hunterId || !skillId) {
        return {
            success: false,
            reason: "INVALID_ARGUMENTS"
        };
    }

    const hunters = getHunters();

    const hunter = findHunter(hunters, hunterId);

    if (!hunter) {
        return {
            success: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    prepareHunterSkills(hunter);

    const skill = getSkill(skillId);

    if (!skill) {
        return {
            success: false,
            reason: "SKILL_NOT_FOUND"
        };
    }

    if (!hunter.skills.includes(skill.id)) {
        return {
            success: false,
            reason: "SKILL_NOT_LEARNED"
        };
    }

    const currentLevel = getSkillLevel(
        hunter,
        skill.id
    );

    const maxLevel = Math.max(
        1,
        Math.floor(Number(skill.maxLevel) || 1)
    );

    if (currentLevel >= maxLevel) {
        return {
            success: false,
            reason: "MAX_SKILL_LEVEL",
            currentLevel,
            maxLevel
        };
    }

    const baseCost = Math.max(
        1,
        Math.floor(Number(skill.skillPointCost) || 1)
    );

    const cost = baseCost * currentLevel;

    if (hunter.skillPoints < cost) {
        return {
            success: false,
            reason: "NOT_ENOUGH_SKILL_POINTS",
            required: cost,
            available: hunter.skillPoints
        };
    }

    hunter.skillPoints -= cost;

    hunter.skillLevels[skill.id] = currentLevel + 1;

    hunter.lastActive = Date.now();

    saveHunters(hunters);

    return {
        success: true,
        skill,
        hunter,
        previousLevel: currentLevel,
        currentLevel: currentLevel + 1,
        pointsSpent: cost,
        remainingPoints: hunter.skillPoints
    };
}


/**
 * تجهيز مهارة نشطة.
 */
export function equipSkill(hunterId, skillId) {
    if (!hunterId || !skillId) {
        return {
            success: false,
            reason: "INVALID_ARGUMENTS"
        };
    }

    const hunters = getHunters();

    const hunter = findHunter(hunters, hunterId);

    if (!hunter) {
        return {
            success: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    prepareHunterSkills(hunter);

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
            reason: "PASSIVE_CANNOT_BE_EQUIPPED"
        };
    }

    if (!hunter.skills.includes(skill.id)) {
        return {
            success: false,
            reason: "SKILL_NOT_LEARNED"
        };
    }

    if (hunter.equippedSkills.includes(skill.id)) {
        return {
            success: false,
            reason: "SKILL_ALREADY_EQUIPPED"
        };
    }

    if (hunter.equippedSkills.length >= MAX_EQUIPPED_SKILLS) {
        return {
            success: false,
            reason: "MAX_EQUIPPED_SKILLS",
            maximum: MAX_EQUIPPED_SKILLS
        };
    }

    hunter.equippedSkills.push(skill.id);

    hunter.lastActive = Date.now();

    saveHunters(hunters);

    return {
        success: true,
        skill,
        hunter,
        equippedSkills: hunter.equippedSkills
    };
}


/**
 * إزالة مهارة من التجهيز.
 */
export function unequipSkill(hunterId, skillId) {
    if (!hunterId || !skillId) {
        return {
            success: false,
            reason: "INVALID_ARGUMENTS"
        };
    }

    const hunters = getHunters();

    const hunter = findHunter(hunters, hunterId);

    if (!hunter) {
        return {
            success: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    prepareHunterSkills(hunter);

    const skill = getSkill(skillId);

    if (!skill) {
        return {
            success: false,
            reason: "SKILL_NOT_FOUND"
        };
    }

    if (!hunter.equippedSkills.includes(skill.id)) {
        return {
            success: false,
            reason: "SKILL_NOT_EQUIPPED"
        };
    }

    hunter.equippedSkills =
        hunter.equippedSkills.filter(
            id => id !== skill.id
        );

    hunter.lastActive = Date.now();

    saveHunters(hunters);

    return {
        success: true,
        skill,
        hunter,
        equippedSkills: hunter.equippedSkills
    };
}


/**
 * الحصول على جميع مهارات الصياد.
 */
export function getHunterSkills(hunterId) {
    const hunters = getHunters();

    const hunter = findHunter(hunters, hunterId);

    if (!hunter) return null;

    prepareHunterSkills(hunter);

    const database = getSkills();

    const learned = hunter.skills
        .map(skillId => {
            const skill = database[skillId];

            if (!skill) return null;

            return {
                ...skill,

                level: getSkillLevel(hunter, skillId),

                learned: true,

                equipped: hunter.equippedSkills.includes(skillId)
            };
        })
        .filter(Boolean);

    // عرض المهارات التي يستطيع الصياد تعلمها فقط.
    const available = Object.values(database)
        .filter(skill => {
            return canLearnSkill(
                hunter,
                skill.id
            ).success;
        });

    return {
        learned,

        available,

        equipped: learned.filter(
            skill => skill.equipped
        ),

        skillPoints: hunter.skillPoints,

        maxEquipped: MAX_EQUIPPED_SKILLS
    };
}


/**
 * حساب تأثيرات المهارات السلبية.
 *
 * المهارات السلبية المتعلمة فقط هي التي تعمل.
 * كل مستوى إضافي يزيد التأثير بنسبة 15%.
 */
export function calculatePassiveSkillEffects(hunter) {
    if (!hunter) return {};

    const database = getSkills();

    const effects = {};

    for (const skillId of hunter.skills || []) {
        const skill = database[skillId];

        if (!skill || skill.type !== "passive") {
            continue;
        }

        const level = getSkillLevel(
            hunter,
            skillId
        );

        const multiplier = 1 + ((level - 1) * 0.15);

        for (const [effectName, value] of Object.entries(
            skill.effects || {}
        )) {
            const amount = Number(value);

            if (!Number.isFinite(amount)) {
                continue;
            }

            effects[effectName] =
                (effects[effectName] || 0) +
                amount * multiplier;
        }
    }

    return effects;
}


/**
 * حساب قوة المهارة حسب مستواها.
 */
export function calculateSkillPower(skillId, level = 1) {
    const skill = getSkill(skillId);

    if (!skill) return null;

    const basePower = Number(skill.power || 0);

    const safeLevel = Math.max(
        1,
        Math.floor(Number(level) || 1)
    );

    const maxLevel = Math.max(
        1,
        Math.floor(Number(skill.maxLevel) || 1)
    );

    if (safeLevel > maxLevel) {
        return null;
    }

    return Math.floor(
        basePower * (1 + ((safeLevel - 1) * 0.15))
    );
}


/**
 * قائمة المهارات.
 */
export function getSkillList() {
    return Object.values(getSkills()).map(skill => ({
        id: skill.id,
        name: skill.name,
        nameAr: skill.nameAr,
        description: skill.description,
        type: skill.type,
        class: skill.class,
        rarity: skill.rarity,
        unlockLevel: skill.unlockLevel,
        unlockRank: skill.unlockRank,
        maxLevel: skill.maxLevel,
        mpCost: skill.mpCost || 0,
        cooldown: skill.cooldown || 0,
        skillPointCost: skill.skillPointCost || 0
    }));
}
