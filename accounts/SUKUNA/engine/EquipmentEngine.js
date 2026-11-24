import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";

import {
    readData,
    writeData,
    getDataDirectory
} from "./storage.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const CONFIG_PATH = path.resolve(
    __dirname,
    "../database/equipment_system.json"
);

const ITEMS_PATH = path.resolve(
    __dirname,
    "../database/items.json"
);

const INVENTORY_PATH = path.join(
    getDataDirectory(),
    "inventories.json"
);


const VALID_STATS = [
    "STR",
    "AGI",
    "INT",
    "VIT",
    "LUK"
];


const EQUIPMENT_SLOTS = [
    "weapon",
    "armor",
    "helmet",
    "boots",
    "gloves",
    "accessory"
];


// ==========================================
// BASIC HELPERS
// ==========================================

function clone(data) {
    return structuredClone(data);
}


function safeNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


function isPlainObject(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}


function randomInt(min, max) {
    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}


function randomFloat(min, max) {
    return Math.random() * (max - min) + min;
}


function roundNumber(value, decimals = 2) {
    return Number(
        safeNumber(value).toFixed(decimals)
    );
}


function validateHunterId(hunterId) {
    if (
        typeof hunterId !== "string" ||
        !hunterId.trim()
    ) {
        throw new Error("INVALID_HUNTER_ID");
    }
}


function isValidEquipmentSlot(slot) {
    return EQUIPMENT_SLOTS.includes(slot);
}


// ==========================================
// DATABASE
// ==========================================

function getConfig() {
    const config = readData(
        CONFIG_PATH,
        null
    );

    if (
        !isPlainObject(config) ||
        !isPlainObject(config.metadata) ||
        !isPlainObject(config.rarities) ||
        !Array.isArray(config.affixes) ||
        !Array.isArray(config.specialEffects) ||
        !isPlainObject(config.enhancement) ||
        !isPlainObject(config.enhancement.milestones || {})
    ) {
        throw new Error(
            "NOVA EQUIPMENT: Invalid configuration."
        );
    }

    return config;
}


function getItemDatabase() {
    const database = readData(
        ITEMS_PATH,
        null
    );

    if (
        !isPlainObject(database) ||
        !isPlainObject(database.items)
    ) {
        throw new Error(
            "NOVA EQUIPMENT: Invalid items database."
        );
    }

    return database;
}


function getInventoryDatabase() {
    const database = readData(
        INVENTORY_PATH,
        {}
    );

    if (!isPlainObject(database)) {
        throw new Error(
            "NOVA EQUIPMENT: Invalid inventory data."
        );
    }

    return database;
}


function saveInventory(database) {
    writeData(
        INVENTORY_PATH,
        database
    );
}


function getMaximumEnhancement(config = getConfig()) {
    const configuredMaximum = Number(
        config.metadata.maxEnhancement
    );

    if (
        !Number.isSafeInteger(configuredMaximum) ||
        configuredMaximum < 0
    ) {
        return 15;
    }

    return configuredMaximum;
}


// ==========================================
// VALIDATION
// ==========================================

function isValidAffix(affix) {
    if (
        !isPlainObject(affix) ||
        typeof affix.id !== "string" ||
        !affix.id.trim()
    ) {
        return false;
    }

    if (affix.type === "stat") {
        return VALID_STATS.includes(affix.stat);
    }

    if (affix.type === "percentage") {
        return (
            typeof affix.effect === "string" &&
            affix.effect.trim().length > 0
        );
    }

    return false;
}


function validateInventory(inventory) {
    return (
        isPlainObject(inventory) &&
        Array.isArray(inventory.items) &&
        isPlainObject(inventory.equipment)
    );
}


// ==========================================
// INVENTORY
// ==========================================

function createEmptyInventory() {
    return {
        capacity: 30,

        items: [],

        equipment: {
            weapon: null,
            armor: null,
            helmet: null,
            boots: null,
            gloves: null,
            accessory: null
        }
    };
}


function getInventory(hunterId, database) {
    validateHunterId(hunterId);

    const inventory = database[hunterId];

    if (!inventory) {
        return createEmptyInventory();
    }

    if (!validateInventory(inventory)) {
        throw new Error(
            "NOVA EQUIPMENT: Invalid hunter inventory."
        );
    }

    return inventory;
}


function findEquipment(inventory, selector) {
    if (
        typeof selector !== "string" ||
        !selector.trim()
    ) {
        return {
            entry: null,
            reason: "ITEM_NOT_FOUND"
        };
    }

    const byUID = inventory.items.find(
        item => item?.uid === selector
    );

    if (byUID) {
        return {
            entry: byUID,
            reason: null
        };
    }

    const matches = inventory.items.filter(
        item => item?.itemId === selector
    );

    if (matches.length === 0) {
        return {
            entry: null,
            reason: "ITEM_NOT_FOUND"
        };
    }

    if (matches.length > 1) {
        return {
            entry: null,
            reason: "ITEM_AMBIGUOUS"
        };
    }

    return {
        entry: matches[0],
        reason: null
    };
}


// ==========================================
// ITEM DATABASE HELPERS
// ==========================================

function getTemplate(itemId) {
    const database = getItemDatabase();

    return database.items[itemId] || null;
}


function isEquipment(item) {
    return Boolean(
        item &&
        isValidEquipmentSlot(item.type) &&
        item.slot === item.type
    );
}


function getEquippedUIDs(inventory) {
    return new Set(
        EQUIPMENT_SLOTS
            .map(slot => inventory.equipment[slot])
            .filter(uid =>
                typeof uid === "string" &&
                uid.length > 0
            )
    );
}


function getItemProperties(entry, template) {
    return {
        uid: entry.uid,

        itemId: entry.itemId,

        name: template.name,

        nameAr: template.nameAr,

        rarity: template.rarity || "Common",

        enhancement: Math.max(
            0,
            safeNumber(entry.enhancement)
        ),

        affixes: Array.isArray(entry.affixes)
            ? clone(entry.affixes)
            : [],

        specialEffects: Array.isArray(entry.specialEffects)
            ? clone(entry.specialEffects)
            : []
    };
}


// ==========================================
// EQUIPMENT INITIALIZATION
// ==========================================

export function initializeEquipment(
    hunterId,
    selector
) {
    validateHunterId(hunterId);

    const database = getInventoryDatabase();

    const inventory = getInventory(
        hunterId,
        database
    );

    const resolved = findEquipment(
        inventory,
        selector
    );

    if (!resolved.entry) {
        return {
            success: false,
            reason: resolved.reason
        };
    }

    const entry = resolved.entry;

    const template = getTemplate(
        entry.itemId
    );

    if (
        !template ||
        !isEquipment(template)
    ) {
        return {
            success: false,
            reason: "NOT_EQUIPMENT"
        };
    }

    if (entry.equipmentInitialized === true) {
        return {
            success: false,
            reason: "ALREADY_INITIALIZED"
        };
    }

    const rarity = template.rarity || "Common";

    const config = getConfig();

    const rarityConfig = config.rarities[rarity];

    if (!isPlainObject(rarityConfig)) {
        return {
            success: false,
            reason: "INVALID_RARITY"
        };
    }

    const availableAffixes = config.affixes.filter(
        isValidAffix
    );

    const affixes = [];

    const maxAffixes = Math.max(
        0,
        Math.floor(
            safeNumber(rarityConfig.maxAffixes)
        )
    );

    const affixPower = Math.max(
        0,
        safeNumber(rarityConfig.affixPower, 1)
    );

    for (
        let i = 0;
        i < maxAffixes &&
        availableAffixes.length > 0;
        i++
    ) {
        const index = randomInt(
            0,
            availableAffixes.length - 1
        );

        const affix = availableAffixes.splice(
            index,
            1
        )[0];

        const min = safeNumber(affix.min);

        const max = Math.max(
            min,
            safeNumber(affix.max, min)
        );

        const value = roundNumber(
            randomFloat(min, max) * affixPower
        );

        affixes.push({
            id: affix.id,
            type: affix.type,
            stat: affix.stat || null,
            effect: affix.effect || null,
            value
        });
    }

    // --------------------------------------
    // SPECIAL EFFECT
    // --------------------------------------

    let specialEffects = [];

    const effectChance = Math.min(
        100,
        Math.max(
            0,
            safeNumber(
                rarityConfig.specialEffectChance
            )
        )
    );

    if (
        randomFloat(0, 100) < effectChance &&
        config.specialEffects.length > 0
    ) {
        const possibleEffects = config.specialEffects.filter(
            effect => {
                return (
                    isPlainObject(effect) &&
                    typeof effect.id === "string" &&
                    Number.isFinite(Number(effect.value))
                );
            }
        );

        if (possibleEffects.length > 0) {
            const effect = possibleEffects[
                randomInt(
                    0,
                    possibleEffects.length - 1
                )
            ];

            specialEffects = [
                {
                    id: effect.id,
                    value: safeNumber(effect.value)
                }
            ];
        }
    }

    // --------------------------------------
    // SAVE
    // --------------------------------------

    const maxEnhancement = getMaximumEnhancement(config);

    const currentEnhancement = Number.isSafeInteger(
        entry.enhancement
    )
        ? entry.enhancement
        : 0;

    entry.enhancement = Math.max(
        0,
        Math.min(
            maxEnhancement,
            currentEnhancement
        )
    );

    entry.affixes = affixes;

    entry.specialEffects = specialEffects;

    entry.equipmentInitialized = true;

    saveInventory(database);

    return {
        success: true,

        equipment: getItemProperties(
            entry,
            template
        )
    };
}


// ==========================================
// ENHANCEMENT
// ==========================================

export function enhanceEquipment(
    hunterId,
    selector
) {
    validateHunterId(hunterId);

    const database = getInventoryDatabase();

    const inventory = getInventory(
        hunterId,
        database
    );

    const resolved = findEquipment(
        inventory,
        selector
    );

    if (!resolved.entry) {
        return {
            success: false,
            reason: resolved.reason
        };
    }

    const entry = resolved.entry;

    const template = getTemplate(
        entry.itemId
    );

    if (
        !template ||
        !isEquipment(template)
    ) {
        return {
            success: false,
            reason: "NOT_EQUIPMENT"
        };
    }

    if (entry.equipmentInitialized !== true) {
        return {
            success: false,
            reason: "EQUIPMENT_NOT_INITIALIZED"
        };
    }

    const config = getConfig();

    const maxEnhancement = getMaximumEnhancement(config);

    const currentLevel = Math.max(
        0,
        Math.floor(
            safeNumber(entry.enhancement)
        )
    );

    if (currentLevel >= maxEnhancement) {
        return {
            success: false,
            reason: "MAX_ENHANCEMENT_REACHED"
        };
    }

    const nextLevel = currentLevel + 1;

    entry.enhancement = nextLevel;

    saveInventory(database);

    return {
        success: true,

        itemId: entry.itemId,

        previousLevel: currentLevel,

        enhancement: nextLevel,

        maxEnhancement,

        message: `Equipment upgraded to +${nextLevel}.`
    };
}


// ==========================================
// EQUIPMENT STAT CALCULATION
// ==========================================

export function calculateEquipmentStats(hunterId) {
    validateHunterId(hunterId);

    const database = getInventoryDatabase();

    const inventory = getInventory(
        hunterId,
        database
    );

    const templates = getItemDatabase().items;

    const config = getConfig();

    const maxEnhancement = getMaximumEnhancement(config);

    const stats = {
        STR: 0,
        AGI: 0,
        INT: 0,
        VIT: 0,
        LUK: 0
    };

    const percentages = {
        physicalDamagePercent: 0,
        magicDamagePercent: 0,
        defensePercent: 0,
        criticalRate: 0,
        criticalDamage: 0,
        speedPercent: 0,
        hpPercent: 0,
        mpPercent: 0
    };

    const specialEffects = [];

    for (const slot of EQUIPMENT_SLOTS) {
        const uid = inventory.equipment[slot];

        if (typeof uid !== "string" || !uid) {
            continue;
        }

        const entry = inventory.items.find(
            item => item?.uid === uid
        );

        if (!entry) {
            continue;
        }

        const template = templates[entry.itemId];

        if (
            !template ||
            !isEquipment(template) ||
            template.slot !== slot
        ) {
            continue;
        }

        // ----------------------------------
        // ENHANCEMENT MULTIPLIER
        // ----------------------------------

        const enhancement = Math.max(
            0,
            Math.min(
                maxEnhancement,
                Math.floor(
                    safeNumber(entry.enhancement)
                )
            )
        );

        const enhancementConfig = config.enhancement;

        let enhancementMultiplier =
            1 +
            enhancement *
            Math.max(
                0,
                safeNumber(
                    enhancementConfig.baseBonusPerLevel
                )
            );

        const milestones = enhancementConfig.milestones || {};

        for (
            const [level, bonus]
            of Object.entries(milestones)
        ) {
            const milestoneLevel = Number(level);

            if (
                Number.isSafeInteger(milestoneLevel) &&
                milestoneLevel > 0 &&
                enhancement >= milestoneLevel
            ) {
                enhancementMultiplier += Math.max(
                    0,
                    safeNumber(bonus)
                );
            }
        }

        // ----------------------------------
        // BASE STATS
        // ----------------------------------

        for (const stat of VALID_STATS) {
            const baseValue = safeNumber(
                template.stats?.[stat]
            );

            stats[stat] +=
                baseValue * enhancementMultiplier;
        }

        // ----------------------------------
        // AFFIXES
        // ----------------------------------

        const affixes = Array.isArray(entry.affixes)
            ? entry.affixes
            : [];

        for (const affix of affixes) {
            if (
                !isValidAffix(affix) ||
                !Number.isFinite(Number(affix.value))
            ) {
                continue;
            }

            const value = safeNumber(
                affix.value
            );

            if (affix.type === "stat") {
                stats[affix.stat] += value;
            }

            if (
                affix.type === "percentage" &&
                Object.hasOwn(
                    percentages,
                    affix.effect
                )
            ) {
                percentages[affix.effect] += value;
            }
        }

        // ----------------------------------
        // SPECIAL EFFECTS
        // ----------------------------------

        const effects = Array.isArray(entry.specialEffects)
            ? entry.specialEffects
            : [];

        for (const effect of effects) {
            if (
                !isPlainObject(effect) ||
                typeof effect.id !== "string"
            ) {
                continue;
            }

            const effectTemplate = config.specialEffects.find(
                item => item?.id === effect.id
            );

            if (!effectTemplate) {
                continue;
            }

            const effectValue = Number(
                effect.value
            );

            specialEffects.push({
                id: effect.id,

                value: Number.isFinite(effectValue)
                    ? effectValue
                    : safeNumber(effectTemplate.value)
            });
        }
    }

    // ======================================
    // ROUNDING
    // ======================================

    for (const stat of VALID_STATS) {
        stats[stat] = roundNumber(
            stats[stat]
        );
    }

    for (const key of Object.keys(percentages)) {
        percentages[key] = roundNumber(
            percentages[key]
        );
    }

    return {
        stats,
        percentages,
        specialEffects
    };
}


// ==========================================
// EQUIPMENT INFORMATION
// ==========================================

export function getEquipmentDetails(
    hunterId,
    selector
) {
    validateHunterId(hunterId);

    const database = getInventoryDatabase();

    const inventory = getInventory(
        hunterId,
        database
    );

    const resolved = findEquipment(
        inventory,
        selector
    );

    if (!resolved.entry) {
        return null;
    }

    const entry = resolved.entry;

    const template = getTemplate(
        entry.itemId
    );

    if (
        !template ||
        !isEquipment(template)
    ) {
        return null;
    }

    const config = getConfig();

    const entryAffixes = Array.isArray(entry.affixes)
        ? entry.affixes
        : [];

    const entryEffects = Array.isArray(entry.specialEffects)
        ? entry.specialEffects
        : [];

    const affixes = entryAffixes.map(affix => {
        const definition = config.affixes.find(
            item => item?.id === affix?.id
        );

        return {
            ...clone(affix),

            name: definition?.name || affix.id,

            nameAr: definition?.nameAr || affix.id
        };
    });

    const specialEffects = entryEffects.map(effect => {
        const definition = config.specialEffects.find(
            item => item?.id === effect?.id
        );

        return {
            ...clone(effect),

            name: definition?.name || effect.id,

            nameAr: definition?.nameAr || effect.id,

            description: definition?.description || ""
        };
    });

    return {
        ...getItemProperties(
            entry,
            template
        ),

        description: template.description || "",

        baseStats: clone(
            template.stats || {}
        ),

        affixes,

        specialEffects
    };
}


// ==========================================
// EQUIPMENT CONFIGURATION INFO
// ==========================================

export function getEnhancementInfo() {
    const config = getConfig();

    return {
        maxLevel: getMaximumEnhancement(config),

        ...clone(config.enhancement)
    };
}


export function getEquipmentRarities() {
    const config = getConfig();

    return clone(config.rarities);
}


export function getEquipmentAffixes() {
    const config = getConfig();

    return clone(config.affixes);
}


export function getEquipmentSpecialEffects() {
    const config = getConfig();

    return clone(config.specialEffects);
}
