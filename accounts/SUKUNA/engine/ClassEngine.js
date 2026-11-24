import path from "path";
import { fileURLToPath } from "url";

import {
    readData,
    getHunters,
    saveHunters
} from "./storage.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLASSES_FILE = path.resolve(
    __dirname,
    "../database/classes.json"
);


const RANK_ORDER = [
    "E",
    "D",
    "C",
    "B",
    "A",
    "S",
    "SS",
    "SSS",
    "NATIONAL"
];


const DEFAULT_CLASSES = {};


function normalizeClassId(classId) {
    return String(classId || "")
        .trim()
        .toLowerCase();
}


function findHunter(hunters, hunterId) {
    if (!hunterId) return null;

    if (hunters[hunterId]) {
        return hunters[hunterId];
    }

    return Object.values(hunters).find(
        hunter => hunter?.id === hunterId
    ) || null;
}


// ==========================================
// CLASS DATABASE
// ==========================================

export function getClasses() {
    const classes = readData(
        CLASSES_FILE,
        DEFAULT_CLASSES
    );

    if (
        !classes ||
        typeof classes !== "object" ||
        Array.isArray(classes)
    ) {
        throw new Error(
            "NOVA CLASSES: Invalid classes database."
        );
    }

    return classes;
}


export function getClass(classId) {
    const id = normalizeClassId(classId);

    if (!id) return null;

    const classes = getClasses();

    return classes[id] || null;
}


export function getHunterClass(hunter) {
    if (!hunter?.class) return null;

    return getClass(hunter.class);
}


export function getClassList() {
    const classes = getClasses();

    return Object.values(classes).map(classData => ({
        id: classData.id,
        name: classData.name,
        nameAr: classData.nameAr,
        description: classData.description,
        role: classData.role,
        icon: classData.icon,
        rarity: classData.rarity,
        unlockLevel: classData.unlockLevel,
        unlockRank: classData.unlockRank,
        specializations: classData.specializations || []
    }));
}


// ==========================================
// CLASS REQUIREMENTS
// ==========================================

export function canChooseClass(hunter, classId) {
    if (!hunter) {
        return {
            success: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    const classData = getClass(classId);

    if (!classData) {
        return {
            success: false,
            reason: "CLASS_NOT_FOUND"
        };
    }

    if (hunter.class) {
        return {
            success: false,
            reason: "CLASS_ALREADY_SELECTED"
        };
    }

    const requiredLevel = Number(
        classData.unlockLevel ?? 1
    );

    if (
        !Number.isSafeInteger(requiredLevel) ||
        requiredLevel < 1
    ) {
        return {
            success: false,
            reason: "INVALID_CLASS_CONFIGURATION"
        };
    }

    if ((Number(hunter.level) || 1) < requiredLevel) {
        return {
            success: false,
            reason: "LEVEL_TOO_LOW",
            required: requiredLevel
        };
    }

    const hunterRank = RANK_ORDER.indexOf(hunter.rank);

    const requiredRank = RANK_ORDER.indexOf(
        classData.unlockRank || "E"
    );

    if (
        hunterRank === -1 ||
        requiredRank === -1 ||
        hunterRank < requiredRank
    ) {
        return {
            success: false,
            reason: "RANK_TOO_LOW",
            required: classData.unlockRank || "E"
        };
    }

    return {
        success: true,
        classData
    };
}


// ==========================================
// CHOOSE CLASS
// ==========================================

export function chooseClass(hunterId, classId) {
    if (!hunterId || !classId) {
        return {
            success: false,
            reason: "INVALID_ARGUMENTS"
        };
    }

    const hunters = getHunters();

    // البحث بالمفتاح أو بمعرف الصياد الداخلي.
    const hunter = findHunter(
        hunters,
        hunterId
    );

    const validation = canChooseClass(
        hunter,
        classId
    );

    if (!validation.success) {
        return validation;
    }

    const classData = validation.classData;

    const now = Date.now();

    hunter.class = classData.id;

    hunter.classSelectedAt = now;

    hunter.classHistory = Array.isArray(
        hunter.classHistory
    )
        ? hunter.classHistory
        : [];

    hunter.classHistory.push({
        classId: classData.id,
        selectedAt: now
    });

    hunter.skills = Array.isArray(hunter.skills)
        ? hunter.skills
        : [];

    const addedSkills = [];

    for (const skillId of classData.passiveSkills || []) {
        if (
            typeof skillId === "string" &&
            !hunter.skills.includes(skillId)
        ) {
            hunter.skills.push(skillId);

            addedSkills.push(skillId);
        }
    }

    hunter.lastActive = now;

    saveHunters(hunters);

    return {
        success: true,
        hunter,
        classData,
        addedSkills
    };
}


// ==========================================
// SPECIALIZATIONS
// ==========================================

export function getClassSpecializations(classId) {
    const classData = getClass(classId);

    if (!classData) return [];

    return Array.isArray(classData.specializations)
        ? classData.specializations
        : [];
}


// ==========================================
// WEAPONS
// ==========================================

export function isWeaponAllowed(classId, weaponType) {
    const classData = getClass(classId);

    if (!classData || !weaponType) return false;

    return (
        Array.isArray(classData.allowedWeapons) &&
        classData.allowedWeapons.includes(weaponType)
    );
}


// ==========================================
// RANKS
// ==========================================

export function getRankOrder() {
    return [...RANK_ORDER];
}


// ==========================================
// REQUIREMENTS
// ==========================================

export function getClassRequirements(classId) {
    const classData = getClass(classId);

    if (!classData) return null;

    return {
        level: classData.unlockLevel ?? 1,
        rank: classData.unlockRank ?? "E"
    };
}
