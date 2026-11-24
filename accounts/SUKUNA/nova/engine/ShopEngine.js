import path from "path";
import { fileURLToPath } from "url";

import {
    readData,
    getHunters,
    saveHunters
} from "./storage.js";

import {
    getItem,
    getInventory,
    addItem,
    removeItem
} from "./InventoryEngine.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SHOP_DATABASE_PATH = path.resolve(
    __dirname,
    "../database/shop.json"
);


// ==========================================
// BASIC HELPERS
// ==========================================

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


function isValidQuantity(quantity) {
    return (
        Number.isSafeInteger(quantity) &&
        quantity > 0
    );
}


function normalizeIdentity(value) {
    if (
        typeof value !== "string" ||
        !value.trim()
    ) {
        return null;
    }

    const clean = value.trim().split(":")[0].toLowerCase();

    if (
        clean.endsWith("@s.whatsapp.net") ||
        clean.endsWith("@lid")
    ) {
        return clean;
    }

    if (/^\d+$/.test(clean)) {
        return `${clean}@s.whatsapp.net`;
    }

    return null;
}


function getIdentityCandidates(identity) {
    const values = Array.isArray(identity)
        ? identity
        : isPlainObject(identity)
            ? [
                identity.pn,
                identity.lid,
                identity.primary
            ]
            : [identity];

    return [
        ...new Set(
            values
                .map(normalizeIdentity)
                .filter(Boolean)
        )
    ];
}


// ==========================================
// SHOP DATABASE
// ==========================================

function getShopDatabase() {
    const database = readData(
        SHOP_DATABASE_PATH,
        null
    );

    if (
        !isPlainObject(database) ||
        !isPlainObject(database.items)
    ) {
        throw new Error("INVALID_SHOP_DATABASE");
    }

    return database;
}


function getValidPrice(value) {
    const price = Number(value);

    if (
        !Number.isSafeInteger(price) ||
        price < 0
    ) {
        return 0;
    }

    return price;
}


// ==========================================
// HUNTER LOOKUP
// ==========================================

function getHunterRecord(identity) {
    const candidates = getIdentityCandidates(identity);

    if (!candidates.length) {
        return null;
    }

    const hunters = getHunters();

    if (!isPlainObject(hunters)) {
        throw new Error("INVALID_HUNTERS_DATABASE");
    }

    const matches = new Map();

    for (const [key, hunter] of Object.entries(hunters)) {
        if (!isPlainObject(hunter)) {
            continue;
        }

        const storedIdentities = [
            key,
            hunter.id,
            hunter.identities?.pn,
            hunter.identities?.lid
        ]
            .map(normalizeIdentity)
            .filter(Boolean);

        const matched = candidates.some(
            candidate => storedIdentities.includes(candidate)
        );

        if (matched) {
            matches.set(key, hunter);
        }
    }

    if (matches.size !== 1) {
        return null;
    }

    const [key, hunter] = [...matches.entries()][0];

    return {
        hunters,
        hunter,
        key
    };
}


function saveHunterGold(record) {
    if (
        !record ||
        !record.hunter ||
        !record.hunters
    ) {
        throw new Error("INVALID_HUNTER_RECORD");
    }

    record.hunter.lastActive = Date.now();

    saveHunters(record.hunters);
}


function getGold(hunter) {
    const gold = safeNumber(hunter?.gold);

    return Math.max(
        0,
        Math.floor(gold)
    );
}


// ==========================================
// SHOP ITEM LOOKUP
// ==========================================

function getShopItem(itemId) {
    if (
        typeof itemId !== "string" ||
        !itemId.trim()
    ) {
        return null;
    }

    const database = getShopDatabase();

    const pricing = database.items[itemId];

    if (
        !isPlainObject(pricing) ||
        pricing.enabled !== true
    ) {
        return null;
    }

    const template = getItem(itemId);

    if (!template) {
        return null;
    }

    return {
        id: itemId,
        buyPrice: getValidPrice(pricing.buyPrice),
        sellPrice: getValidPrice(pricing.sellPrice),
        enabled: true,
        template
    };
}


// ==========================================
// INVENTORY HELPERS
// ==========================================

function getRequiredSlots(inventory, template, quantity) {
    if (
        !inventory ||
        !Array.isArray(inventory.items) ||
        !template
    ) {
        return Infinity;
    }

    if (template.stackable !== true) {
        return quantity;
    }

    const maxStack = template.maxStack;

    if (
        !Number.isSafeInteger(maxStack) ||
        maxStack < 1
    ) {
        return Infinity;
    }

    let remaining = quantity;

    for (const entry of inventory.items) {
        if (
            entry?.itemId !== template.id ||
            !Number.isSafeInteger(entry.quantity) ||
            entry.quantity < 1 ||
            entry.quantity >= maxStack
        ) {
            continue;
        }

        const available = maxStack - entry.quantity;

        const amount = Math.min(
            remaining,
            available
        );

        remaining -= amount;

        if (remaining <= 0) {
            return 0;
        }
    }

    return Math.ceil(remaining / maxStack);
}


function getInventoryHunterId(record) {
    return record?.hunter?.id || record?.key || null;
}


function getAvailableItemQuantity(inventory, itemId) {
    if (
        !inventory ||
        !Array.isArray(inventory.items)
    ) {
        return 0;
    }

    const equippedUIDs = new Set(
        Object.values(inventory.equipment || {})
            .filter(uid => typeof uid === "string" && uid)
    );

    return inventory.items
        .filter(entry =>
            entry?.itemId === itemId &&
            !equippedUIDs.has(entry.uid)
        )
        .reduce(
            (sum, entry) =>
                sum + Math.max(
                    0,
                    Math.floor(safeNumber(entry?.quantity))
                ),
            0
        );
}


// ==========================================
// SHOP INFORMATION
// ==========================================

export function getShopItems() {
    const database = getShopDatabase();

    const result = [];

    for (const [itemId, pricing] of Object.entries(database.items)) {
        if (
            !isPlainObject(pricing) ||
            pricing.enabled !== true
        ) {
            continue;
        }

        const template = getItem(itemId);

        if (!template) {
            continue;
        }

        result.push({
            ...template,
            buyPrice: getValidPrice(pricing.buyPrice),
            sellPrice: getValidPrice(pricing.sellPrice)
        });
    }

    return result;
}


export function getShopItemInfo(itemId) {
    const item = getShopItem(itemId);

    if (!item) {
        return null;
    }

    return {
        id: item.id,
        name: item.template.name,
        nameAr: item.template.nameAr,
        type: item.template.type,
        rarity: item.template.rarity,
        buyPrice: item.buyPrice,
        sellPrice: item.sellPrice,
        enabled: item.enabled
    };
}


// ==========================================
// BUY ITEM
// ==========================================

export function buyItem(
    hunterId,
    itemId,
    quantity = 1
) {
    if (!isValidQuantity(quantity)) {
        return {
            success: false,
            reason: "INVALID_QUANTITY"
        };
    }

    const record = getHunterRecord(hunterId);

    if (!record) {
        return {
            success: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    const shopItem = getShopItem(itemId);

    if (!shopItem) {
        return {
            success: false,
            reason: "ITEM_NOT_AVAILABLE"
        };
    }

    if (shopItem.buyPrice <= 0) {
        return {
            success: false,
            reason: "ITEM_NOT_FOR_SALE"
        };
    }

    const totalPrice = shopItem.buyPrice * quantity;

    if (!Number.isSafeInteger(totalPrice)) {
        return {
            success: false,
            reason: "INVALID_TOTAL_PRICE"
        };
    }

    const currentGold = getGold(record.hunter);

    if (currentGold < totalPrice) {
        return {
            success: false,
            reason: "NOT_ENOUGH_GOLD",
            required: totalPrice,
            available: currentGold
        };
    }

    const inventoryHunterId = getInventoryHunterId(record);

    if (!inventoryHunterId) {
        return {
            success: false,
            reason: "INVALID_HUNTER_ID"
        };
    }

    const inventory = getInventory(inventoryHunterId);

    const requiredSlots = getRequiredSlots(
        inventory,
        shopItem.template,
        quantity
    );

    const remainingSlots = Math.max(
        0,
        inventory.capacity - inventory.items.length
    );

    if (requiredSlots > remainingSlots) {
        return {
            success: false,
            reason: "INVENTORY_FULL",
            requiredSlots,
            remainingSlots
        };
    }

    const previousGold = currentGold;

    // خصم الذهب وحفظه.
    record.hunter.gold = currentGold - totalPrice;

    try {
        saveHunterGold(record);
    } catch (error) {
        record.hunter.gold = previousGold;

        return {
            success: false,
            reason: "GOLD_SAVE_FAILED"
        };
    }

    // إضافة العنصر للمخزون.
    try {
        const result = addItem(
            inventoryHunterId,
            itemId,
            quantity,
            {
                source: "shop"
            }
        );

        if (
            !result.success ||
            result.remaining > 0 ||
            result.added !== quantity
        ) {
            throw new Error("ITEM_ADD_FAILED");
        }

        return {
            success: true,
            itemId,
            quantity,
            unitPrice: shopItem.buyPrice,
            totalPrice,
            remainingGold: record.hunter.gold,
            inventoryResult: result
        };
    } catch (error) {
        // محاولة إعادة الذهب إذا فشلت إضافة العنصر.
        record.hunter.gold = previousGold;

        try {
            saveHunterGold(record);
        } catch (rollbackError) {
            console.error(
                "[NOVA SHOP] Gold rollback failed:",
                rollbackError
            );
        }

        return {
            success: false,
            reason: "PURCHASE_FAILED"
        };
    }
}


// ==========================================
// SELL ITEM
// ==========================================

export function sellItem(
    hunterId,
    itemId,
    quantity = 1
) {
    if (!isValidQuantity(quantity)) {
        return {
            success: false,
            reason: "INVALID_QUANTITY"
        };
    }

    const record = getHunterRecord(hunterId);

    if (!record) {
        return {
            success: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    const shopItem = getShopItem(itemId);

    if (!shopItem) {
        return {
            success: false,
            reason: "ITEM_NOT_AVAILABLE"
        };
    }

    if (shopItem.sellPrice <= 0) {
        return {
            success: false,
            reason: "ITEM_NOT_SELLABLE"
        };
    }

    const inventoryHunterId = getInventoryHunterId(record);

    if (!inventoryHunterId) {
        return {
            success: false,
            reason: "INVALID_HUNTER_ID"
        };
    }

    const inventory = getInventory(inventoryHunterId);

    const availableQuantity = getAvailableItemQuantity(
        inventory,
        itemId
    );

    if (availableQuantity < quantity) {
        return {
            success: false,
            reason: "NOT_ENOUGH_ITEMS",
            available: availableQuantity
        };
    }

    const totalPrice = shopItem.sellPrice * quantity;

    if (!Number.isSafeInteger(totalPrice)) {
        return {
            success: false,
            reason: "INVALID_TOTAL_PRICE"
        };
    }

    const currentGold = getGold(record.hunter);

    if (!Number.isSafeInteger(currentGold + totalPrice)) {
        return {
            success: false,
            reason: "GOLD_LIMIT_REACHED"
        };
    }

    // إزالة العنصر أولًا.
    const removal = removeItem(
        inventoryHunterId,
        itemId,
        quantity
    );

    if (!removal.success) {
        return {
            success: false,
            reason: removal.reason || "ITEM_REMOVE_FAILED"
        };
    }

    const previousGold = currentGold;

    record.hunter.gold = currentGold + totalPrice;

    try {
        saveHunterGold(record);
    } catch (error) {
        record.hunter.gold = previousGold;

        return {
            success: false,
            reason: "GOLD_SAVE_FAILED",
            itemRemoved: true
        };
    }

    return {
        success: true,
        itemId,
        quantity,
        unitPrice: shopItem.sellPrice,
        totalPrice,
        remainingGold: record.hunter.gold
    };
}


// ==========================================
// PLAYER SHOP INFO
// ==========================================

export function getShopPlayerInfo(hunterId) {
    const record = getHunterRecord(hunterId);

    if (!record) {
        return null;
    }

    return {
        hunterId: record.hunter.id || record.key,
        name: record.hunter.name || "Unknown Hunter",
        gold: getGold(record.hunter)
    };
}
