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

const DATABASE_PATH = path.resolve(
    __dirname,
    "../database/items.json"
);

const INVENTORY_PATH = path.join(
    getDataDirectory(),
    "inventories.json"
);


const DEFAULT_CAPACITY = 30;

const EQUIPMENT_SLOTS = [
    "weapon",
    "armor",
    "helmet",
    "boots",
    "gloves",
    "accessory"
];

const VALID_STATS = [
    "STR",
    "AGI",
    "INT",
    "VIT",
    "LUK"
];

const EMPTY_EQUIPMENT = {
    weapon: null,
    armor: null,
    helmet: null,
    boots: null,
    gloves: null,
    accessory: null
};


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


function validateHunterId(hunterId) {
    if (
        typeof hunterId !== "string" ||
        !hunterId.trim()
    ) {
        throw new Error("INVALID_HUNTER_ID");
    }
}


function isValidQuantity(quantity) {
    return (
        Number.isSafeInteger(quantity) &&
        quantity > 0
    );
}


// ==========================================
// DATABASE
// ==========================================

function getDatabase() {
    const database = readData(DATABASE_PATH, null);

    if (
        !isPlainObject(database) ||
        !isPlainObject(database.items)
    ) {
        throw new Error(
            "NOVA INVENTORY: Invalid items database."
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
            "NOVA INVENTORY: Invalid inventory database."
        );
    }

    return database;
}


function saveInventoryDatabase(database) {
    writeData(
        INVENTORY_PATH,
        database
    );
}


function getTemplate(itemId) {
    if (
        typeof itemId !== "string" ||
        !itemId.trim()
    ) {
        return null;
    }

    const database = getDatabase();

    return database.items[itemId] || null;
}


// ==========================================
// INVENTORY STRUCTURE
// ==========================================

function createEmptyInventory() {
    const now = Date.now();

    return {
        capacity: DEFAULT_CAPACITY,
        items: [],
        equipment: clone(EMPTY_EQUIPMENT),
        createdAt: now,
        updatedAt: now
    };
}


function normalizeInventory(inventory) {
    let changed = false;

    if (!isPlainObject(inventory)) {
        return {
            inventory: createEmptyInventory(),
            changed: true
        };
    }

    if (!Array.isArray(inventory.items)) {
        inventory.items = [];
        changed = true;
    }

    if (!isPlainObject(inventory.equipment)) {
        inventory.equipment = clone(EMPTY_EQUIPMENT);
        changed = true;
    }

    for (const slot of EQUIPMENT_SLOTS) {
        if (!(slot in inventory.equipment)) {
            inventory.equipment[slot] = null;
            changed = true;
        }
    }

    for (const slot of Object.keys(inventory.equipment)) {
        if (!EQUIPMENT_SLOTS.includes(slot)) {
            delete inventory.equipment[slot];
            changed = true;
        }
    }

    if (
        !Number.isSafeInteger(inventory.capacity) ||
        inventory.capacity < 1
    ) {
        inventory.capacity = DEFAULT_CAPACITY;
        changed = true;
    }

    const usedUIDs = new Set();

    for (const item of inventory.items) {
        if (!isPlainObject(item)) {
            continue;
        }

        if (
            typeof item.uid !== "string" ||
            !item.uid.trim() ||
            usedUIDs.has(item.uid)
        ) {
            item.uid = randomUUID();
            changed = true;
        }

        usedUIDs.add(item.uid);

        if (
            !Number.isSafeInteger(item.quantity) ||
            item.quantity < 1
        ) {
            item.quantity = 1;
            changed = true;
        }
    }

    if (!Number.isFinite(inventory.createdAt)) {
        inventory.createdAt = Date.now();
        changed = true;
    }

    if (!Number.isFinite(inventory.updatedAt)) {
        inventory.updatedAt = Date.now();
        changed = true;
    }

    return {
        inventory,
        changed
    };
}


function getInventoryInternal(hunterId, database) {
    validateHunterId(hunterId);

    let changed = false;

    if (!Object.hasOwn(database, hunterId)) {
        database[hunterId] = createEmptyInventory();
        changed = true;
    }

    const normalized = normalizeInventory(
        database[hunterId]
    );

    database[hunterId] = normalized.inventory;

    changed ||= normalized.changed;

    return {
        inventory: database[hunterId],
        changed
    };
}


function saveUpdatedInventory(database, inventory) {
    inventory.updatedAt = Date.now();

    saveInventoryDatabase(database);
}


function getInventoryForMutation(hunterId, database) {
    const result = getInventoryInternal(
        hunterId,
        database
    );

    return result.inventory;
}


// ==========================================
// ITEM VALIDATION
// ==========================================

function validateItemTemplate(item) {
    if (!isPlainObject(item)) {
        return false;
    }

    if (
        typeof item.id !== "string" ||
        !item.id.trim() ||
        typeof item.type !== "string" ||
        !item.type.trim()
    ) {
        return false;
    }

    if (
        item.allowedClasses !== undefined &&
        !Array.isArray(item.allowedClasses)
    ) {
        return false;
    }

    if (
        item.stats !== undefined &&
        !isPlainObject(item.stats)
    ) {
        return false;
    }

    if (item.stats) {
        for (const [stat, value] of Object.entries(item.stats)) {
            if (
                !VALID_STATS.includes(stat) ||
                !Number.isFinite(Number(value))
            ) {
                return false;
            }
        }
    }

    if (item.stackable === true) {
        if (
            !Number.isSafeInteger(item.maxStack) ||
            item.maxStack < 1
        ) {
            return false;
        }
    }

    if (
        item.stackable !== undefined &&
        typeof item.stackable !== "boolean"
    ) {
        return false;
    }

    if (
        item.slot !== undefined &&
        typeof item.slot !== "string"
    ) {
        return false;
    }

    return true;
}


// ==========================================
// EQUIPMENT HELPERS
// ==========================================

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


function resolveInventoryItem(inventory, selector) {
    if (
        typeof selector !== "string" ||
        !selector.trim()
    ) {
        return {
            item: null,
            reason: "ITEM_NOT_FOUND"
        };
    }

    const byUID = inventory.items.find(
        item => item?.uid === selector
    );

    if (byUID) {
        return {
            item: byUID,
            reason: null
        };
    }

    const matches = inventory.items.filter(
        item => item?.itemId === selector
    );

    if (matches.length === 0) {
        return {
            item: null,
            reason: "ITEM_NOT_FOUND"
        };
    }

    if (matches.length > 1) {
        return {
            item: null,
            reason: "ITEM_AMBIGUOUS"
        };
    }

    return {
        item: matches[0],
        reason: null
    };
}


function getHunterClassId(hunter) {
    if (!hunter?.class) {
        return null;
    }

    if (typeof hunter.class === "string") {
        return hunter.class;
    }

    if (isPlainObject(hunter.class)) {
        return (
            hunter.class.id ||
            hunter.class.classId ||
            hunter.class.name ||
            null
        );
    }

    return null;
}


function checkItemRequirements(item, hunter) {
    if (!item || !hunter) {
        return {
            success: false,
            reason: "INVALID_DATA"
        };
    }

    const hunterLevel = Math.max(
        1,
        safeNumber(hunter.level, 1)
    );

    const requiredLevel = Math.max(
        1,
        safeNumber(item.levelRequired, 1)
    );

    if (hunterLevel < requiredLevel) {
        return {
            success: false,
            reason: "LEVEL_TOO_LOW",
            requiredLevel
        };
    }

    const allowedClasses = Array.isArray(item.allowedClasses)
        ? item.allowedClasses
        : [];

    if (allowedClasses.length > 0) {
        const hunterClass = getHunterClassId(hunter);

        if (
            !hunterClass ||
            !allowedClasses.includes(hunterClass)
        ) {
            return {
                success: false,
                reason: "CLASS_NOT_ALLOWED",
                allowedClasses
            };
        }
    }

    return {
        success: true
    };
}


function getItemQuantityFromInventory(inventory, itemId) {
    return inventory.items
        .filter(item => item?.itemId === itemId)
        .reduce(
            (sum, item) => sum + safeNumber(item.quantity),
            0
        );
}


// ==========================================
// ITEM DATABASE APIs
// ==========================================

export function getItemTemplates() {
    const database = getDatabase();

    return clone(database.items);
}


export function getItem(itemId) {
    const item = getTemplate(itemId);

    return item
        ? clone(item)
        : null;
}


export function getItemsByType(type) {
    if (typeof type !== "string") {
        return [];
    }

    const database = getDatabase();

    return Object.values(database.items)
        .filter(item => item?.type === type)
        .map(item => clone(item));
}


export function getItemsByRarity(rarity) {
    if (typeof rarity !== "string") {
        return [];
    }

    const database = getDatabase();

    return Object.values(database.items)
        .filter(item => item?.rarity === rarity)
        .map(item => clone(item));
}


// ==========================================
// INVENTORY ACCESS
// ==========================================

export function getInventory(hunterId) {
    validateHunterId(hunterId);

    const database = getInventoryDatabase();

    const result = getInventoryInternal(
        hunterId,
        database
    );

    // Save only when inventory was created or normalized.
    if (result.changed) {
        saveUpdatedInventory(
            database,
            result.inventory
        );
    }

    return clone(result.inventory);
}


export function getEquipment(hunterId) {
    const inventory = getInventory(hunterId);

    const result = {};

    for (const slot of EQUIPMENT_SLOTS) {
        const uid = inventory.equipment[slot];

        if (!uid) {
            result[slot] = null;
            continue;
        }

        const item = inventory.items.find(
            entry => entry?.uid === uid
        );

        result[slot] = item
            ? {
                ...clone(item),
                template: getItem(item.itemId)
            }
            : null;
    }

    return result;
}


export function getInventoryCapacity(hunterId) {
    const inventory = getInventory(hunterId);

    return {
        used: inventory.items.length,
        capacity: inventory.capacity,
        remaining: Math.max(
            0,
            inventory.capacity - inventory.items.length
        )
    };
}


export function hasItem(hunterId, itemId, quantity = 1) {
    if (
        typeof itemId !== "string" ||
        !isValidQuantity(quantity)
    ) {
        return false;
    }

    const inventory = getInventory(hunterId);

    return (
        getItemQuantityFromInventory(
            inventory,
            itemId
        ) >= quantity
    );
}


export function getItemQuantity(hunterId, itemId) {
    if (typeof itemId !== "string") {
        return 0;
    }

    const inventory = getInventory(hunterId);

    return getItemQuantityFromInventory(
        inventory,
        itemId
    );
}


// ==========================================
// ADD ITEMS
// ==========================================

export function addItem(
    hunterId,
    itemId,
    quantity = 1,
    options = {}
) {
    validateHunterId(hunterId);

    if (!isValidQuantity(quantity)) {
        return {
            success: false,
            reason: "INVALID_QUANTITY"
        };
    }

    const template = getTemplate(itemId);

    if (!template) {
        return {
            success: false,
            reason: "ITEM_NOT_FOUND"
        };
    }

    if (!validateItemTemplate(template)) {
        return {
            success: false,
            reason: "INVALID_ITEM_TEMPLATE"
        };
    }

    const database = getInventoryDatabase();

    const inventory = getInventoryForMutation(
        hunterId,
        database
    );

    let remaining = quantity;
    let added = 0;

    if (template.stackable === true) {
        const maxStack = template.maxStack;

        for (const entry of inventory.items) {
            if (
                entry.itemId !== itemId ||
                entry.quantity >= maxStack
            ) {
                continue;
            }

            const available = maxStack - entry.quantity;

            const amount = Math.min(
                remaining,
                available
            );

            entry.quantity += amount;

            remaining -= amount;
            added += amount;

            if (remaining === 0) {
                break;
            }
        }
    }

    while (remaining > 0) {
        if (inventory.items.length >= inventory.capacity) {
            break;
        }

        const amount = template.stackable === true
            ? Math.min(remaining, template.maxStack)
            : 1;

        inventory.items.push({
            uid: randomUUID(),
            itemId,
            quantity: amount,
            enhancement: 0,
            acquiredAt: Date.now(),
            source: (
                typeof options.source === "string"
                    ? options.source
                    : "unknown"
            )
        });

        remaining -= amount;
        added += amount;
    }

    saveUpdatedInventory(
        database,
        inventory
    );

    return {
        success: added > 0,
        itemId,
        requested: quantity,
        added,
        remaining,
        inventoryFull: remaining > 0
    };
}


// ==========================================
// REMOVE ITEMS
// ==========================================

export function removeItem(
    hunterId,
    itemId,
    quantity = 1
) {
    validateHunterId(hunterId);

    if (
        typeof itemId !== "string" ||
        !isValidQuantity(quantity)
    ) {
        return {
            success: false,
            reason: "INVALID_QUANTITY"
        };
    }

    const database = getInventoryDatabase();

    const inventory = getInventoryForMutation(
        hunterId,
        database
    );

    const equippedUIDs = getEquippedUIDs(inventory);

    const availableItems = inventory.items.filter(item =>
        item?.itemId === itemId &&
        !equippedUIDs.has(item.uid)
    );

    const availableQuantity = availableItems.reduce(
        (sum, item) => sum + safeNumber(item.quantity),
        0
    );

    if (availableQuantity < quantity) {
        return {
            success: false,
            reason: "NOT_ENOUGH_ITEMS",
            available: availableQuantity
        };
    }

    let remaining = quantity;

    for (const item of availableItems) {
        if (remaining <= 0) {
            break;
        }

        const amount = Math.min(
            remaining,
            item.quantity
        );

        item.quantity -= amount;
        remaining -= amount;

        if (item.quantity <= 0) {
            const index = inventory.items.findIndex(
                entry => entry.uid === item.uid
            );

            if (index !== -1) {
                inventory.items.splice(index, 1);
            }
        }
    }

    saveUpdatedInventory(
        database,
        inventory
    );

    return {
        success: true,
        itemId,
        removed: quantity
    };
}


export function removeItemByUID(hunterId, uid) {
    validateHunterId(hunterId);

    if (
        typeof uid !== "string" ||
        !uid.trim()
    ) {
        return {
            success: false,
            reason: "INVALID_UID"
        };
    }

    const database = getInventoryDatabase();

    const inventory = getInventoryForMutation(
        hunterId,
        database
    );

    const equippedUIDs = getEquippedUIDs(inventory);

    if (equippedUIDs.has(uid)) {
        return {
            success: false,
            reason: "ITEM_EQUIPPED"
        };
    }

    const index = inventory.items.findIndex(
        item => item?.uid === uid
    );

    if (index === -1) {
        return {
            success: false,
            reason: "ITEM_NOT_FOUND"
        };
    }

    const removed = inventory.items.splice(index, 1)[0];

    saveUpdatedInventory(
        database,
        inventory
    );

    return {
        success: true,
        removed: clone(removed)
    };
}


// ==========================================
// EQUIP ITEMS
// ==========================================

export function equipItem(hunterId, hunter, selector) {
    validateHunterId(hunterId);

    if (!isPlainObject(hunter)) {
        return {
            success: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    const database = getInventoryDatabase();

    const inventory = getInventoryForMutation(
        hunterId,
        database
    );

    const resolved = resolveInventoryItem(
        inventory,
        selector
    );

    if (!resolved.item) {
        return {
            success: false,
            reason: resolved.reason
        };
    }

    const entry = resolved.item;

    const template = getTemplate(entry.itemId);

    if (!template) {
        return {
            success: false,
            reason: "ITEM_TEMPLATE_NOT_FOUND"
        };
    }

    if (!validateItemTemplate(template)) {
        return {
            success: false,
            reason: "INVALID_ITEM_TEMPLATE"
        };
    }

    if (
        !EQUIPMENT_SLOTS.includes(template.slot) ||
        template.type !== template.slot
    ) {
        return {
            success: false,
            reason: "ITEM_NOT_EQUIPPABLE"
        };
    }

    const requirements = checkItemRequirements(
        template,
        hunter
    );

    if (!requirements.success) {
        return requirements;
    }

    const slot = template.slot;

    const previousUID = inventory.equipment[slot];

    inventory.equipment[slot] = entry.uid;

    saveUpdatedInventory(
        database,
        inventory
    );

    return {
        success: true,

        equipped: {
            uid: entry.uid,
            itemId: entry.itemId,
            slot,
            template: clone(template)
        },

        replaced: previousUID
    };
}


export function unequipItem(hunterId, slot) {
    validateHunterId(hunterId);

    if (!EQUIPMENT_SLOTS.includes(slot)) {
        return {
            success: false,
            reason: "INVALID_EQUIPMENT_SLOT"
        };
    }

    const database = getInventoryDatabase();

    const inventory = getInventoryForMutation(
        hunterId,
        database
    );

    const uid = inventory.equipment[slot];

    if (!uid) {
        return {
            success: false,
            reason: "SLOT_EMPTY"
        };
    }

    const item = inventory.items.find(
        entry => entry?.uid === uid
    );

    inventory.equipment[slot] = null;

    saveUpdatedInventory(
        database,
        inventory
    );

    return {
        success: true,
        slot,
        item: item ? clone(item) : null
    };
}


export function unequipAll(hunterId) {
    validateHunterId(hunterId);

    const database = getInventoryDatabase();

    const inventory = getInventoryForMutation(
        hunterId,
        database
    );

    const removed = [];

    for (const slot of EQUIPMENT_SLOTS) {
        const uid = inventory.equipment[slot];

        if (uid) {
            removed.push({
                slot,
                uid
            });
        }

        inventory.equipment[slot] = null;
    }

    saveUpdatedInventory(
        database,
        inventory
    );

    return {
        success: true,
        unequipped: removed.length,
        items: removed
    };
}


// ==========================================
// EQUIPMENT STATS
// ==========================================

export function getEquippedStats(hunterId) {
    const inventory = getInventory(hunterId);

    const stats = {
        STR: 0,
        AGI: 0,
        INT: 0,
        VIT: 0,
        LUK: 0
    };

    for (const slot of EQUIPMENT_SLOTS) {
        const uid = inventory.equipment[slot];

        if (!uid) {
            continue;
        }

        const entry = inventory.items.find(
            item => item?.uid === uid
        );

        if (!entry) {
            continue;
        }

        const template = getTemplate(entry.itemId);

        if (
            !template ||
            template.type !== slot ||
            template.slot !== slot ||
            !isPlainObject(template.stats)
        ) {
            continue;
        }

        for (const stat of VALID_STATS) {
            stats[stat] += safeNumber(
                template.stats[stat]
            );
        }
    }

    for (const stat of VALID_STATS) {
        stats[stat] = Number(
            stats[stat].toFixed(2)
        );
    }

    return stats;
}


// ==========================================
// CONSUMABLE ITEMS
// ==========================================

export function useConsumable(hunterId, selector) {
    validateHunterId(hunterId);

    const database = getInventoryDatabase();

    const inventory = getInventoryForMutation(
        hunterId,
        database
    );

    const resolved = resolveInventoryItem(
        inventory,
        selector
    );

    if (!resolved.item) {
        return {
            success: false,
            reason: resolved.reason
        };
    }

    const entry = resolved.item;

    const template = getTemplate(entry.itemId);

    if (
        !template ||
        template.type !== "consumable" ||
        !isPlainObject(template.effect)
    ) {
        return {
            success: false,
            reason: "ITEM_NOT_USABLE"
        };
    }

    const effect = clone(template.effect);

    entry.quantity -= 1;

    if (entry.quantity <= 0) {
        const index = inventory.items.findIndex(
            item => item?.uid === entry.uid
        );

        if (index !== -1) {
            inventory.items.splice(index, 1);
        }
    }

    saveUpdatedInventory(
        database,
        inventory
    );

    return {
        success: true,
        itemId: template.id,
        effect,
        remaining: getItemQuantityFromInventory(
            inventory,
            template.id
        )
    };
}


// ==========================================
// CAPACITY
// ==========================================

export function increaseInventoryCapacity(
    hunterId,
    amount
) {
    validateHunterId(hunterId);

    if (!isValidQuantity(amount)) {
        return {
            success: false,
            reason: "INVALID_AMOUNT"
        };
    }

    const database = getInventoryDatabase();

    const inventory = getInventoryForMutation(
        hunterId,
        database
    );

    inventory.capacity += amount;

    saveUpdatedInventory(
        database,
        inventory
    );

    return {
        success: true,
        capacity: inventory.capacity,
        increased: amount
    };
}


// ==========================================
// INVENTORY SUMMARY
// ==========================================

export function getInventorySummary(hunterId) {
    const inventory = getInventory(hunterId);

    const summary = {
        totalItems: inventory.items.reduce(
            (sum, item) =>
                sum + safeNumber(item?.quantity),
            0
        ),

        occupiedSlots: inventory.items.length,

        capacity: inventory.capacity,

        equipmentCount: Object.values(
            inventory.equipment
        ).filter(Boolean).length,

        types: {},

        rarities: {}
    };

    for (const entry of inventory.items) {
        if (!entry?.itemId) {
            continue;
        }

        const template = getTemplate(entry.itemId);

        if (!template) {
            continue;
        }

        const quantity = safeNumber(
            entry.quantity
        );

        const type = template.type || "unknown";
        const rarity = template.rarity || "Common";

        summary.types[type] =
            (summary.types[type] || 0) + quantity;

        summary.rarities[rarity] =
            (summary.rarities[rarity] || 0) + quantity;
    }

    return summary;
}


// ==========================================
// CONFIGURATION
// ==========================================

export function getEquipmentSlots() {
    return [...EQUIPMENT_SLOTS];
}


export function getInventoryDefaults() {
    return {
        capacity: DEFAULT_CAPACITY,
        equipment: clone(EMPTY_EQUIPMENT)
    };
}
