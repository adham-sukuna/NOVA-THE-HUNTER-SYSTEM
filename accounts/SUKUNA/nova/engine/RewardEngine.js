import fs from "fs";

import {
    readData,
    writeData,
    getDataDirectory
} from "./storage.js";


import path from "path";
import { fileURLToPath } from "url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const REWARD_DATABASE = path.resolve(
    __dirname,
    "../database/rewards.json"
);


const CLAIMS_FILE = path.join(
    getDataDirectory(),
    "reward_claims.json"
);


const DEFAULT_CLAIMS = {
    hunters: {},
    transactions: {}
};


const RARITY_ORDER = [
    "Common",
    "Uncommon",
    "Rare",
    "Epic",
    "Legendary",
    "Mythic"
];


const MAX_REWARD_AMOUNT = 1000000000;


/* =====================================
   GENERAL HELPERS
===================================== */

function random(min, max) {
    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}


function randomFloat(min, max) {
    return Math.random() * (max - min) + min;
}


function clamp(value, min, max) {
    return Math.max(
        min,
        Math.min(max, value)
    );
}


function normalizeId(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const id = String(value).trim();

    return id.length ? id : null;
}


function normalizeAmount(value) {
    const amount = Number(value);

    if (!Number.isFinite(amount)) {
        return 0;
    }

    return clamp(
        Math.floor(amount),
        0,
        MAX_REWARD_AMOUNT
    );
}


function createRewardId() {
    return [
        "reward",
        Date.now(),
        random(100000, 999999)
    ].join("_");
}


function createChestId() {
    return [
        "chest",
        Date.now(),
        random(100000, 999999)
    ].join("_");
}


function clone(data) {
    return structuredClone(data);
}


/* =====================================
   DATABASE
===================================== */

function loadRewardDatabase() {
    if (!fs.existsSync(REWARD_DATABASE)) {
        throw new Error(
            "NOVA REWARD ENGINE: rewards.json not found."
        );
    }

    try {
        const data = JSON.parse(
            fs.readFileSync(REWARD_DATABASE, "utf8")
        );

        if (
            !data ||
            typeof data !== "object" ||
            !Array.isArray(data.chests) ||
            !data.activityRewards ||
            typeof data.activityRewards !== "object" ||
            Array.isArray(data.activityRewards) ||
            !data.bossBonus ||
            typeof data.bossBonus !== "object"
        ) {
            throw new Error(
                "Invalid rewards database structure."
            );
        }

        for (const chest of data.chests) {
            if (
                !chest ||
                typeof chest.id !== "string" ||
                !chest.id ||
                !chest.rewards ||
                typeof chest.rewards !== "object"
            ) {
                throw new Error(
                    "Invalid chest template."
                );
            }
        }

        return data;

    } catch (error) {
        throw new Error(
            `NOVA REWARD ENGINE: ${error.message}`
        );
    }
}


function loadClaimsDatabase() {
    const database = readData(
        CLAIMS_FILE,
        DEFAULT_CLAIMS
    );

    if (
        !database ||
        typeof database !== "object" ||
        Array.isArray(database)
    ) {
        throw new Error(
            "NOVA REWARD ENGINE: Invalid claims database."
        );
    }

    if (
        !database.hunters ||
        typeof database.hunters !== "object" ||
        Array.isArray(database.hunters)
    ) {
        database.hunters = {};
    }

    if (
        !database.transactions ||
        typeof database.transactions !== "object" ||
        Array.isArray(database.transactions)
    ) {
        database.transactions = {};
    }

    return database;
}


function saveClaimsDatabase(database) {
    writeData(
        CLAIMS_FILE,
        database
    );
}


/* =====================================
   REWARD NORMALIZATION
===================================== */

function normalizeRewards(rewards = {}) {
    return {
        xp: normalizeAmount(rewards.xp),
        gold: normalizeAmount(rewards.gold)
    };
}


function multiplyRewards(rewards, multiplier = {}) {
    const xpMultiplier = clamp(
        Number(multiplier.xpMultiplier) || 1,
        0,
        100
    );

    const goldMultiplier = clamp(
        Number(multiplier.goldMultiplier) || 1,
        0,
        100
    );

    return {
        xp: normalizeAmount(
            rewards.xp * xpMultiplier
        ),

        gold: normalizeAmount(
            rewards.gold * goldMultiplier
        )
    };
}


function addRewards(first = {}, second = {}) {
    return {
        xp: normalizeAmount(
            (Number(first.xp) || 0) +
            (Number(second.xp) || 0)
        ),

        gold: normalizeAmount(
            (Number(first.gold) || 0) +
            (Number(second.gold) || 0)
        )
    };
}


/* =====================================
   WEIGHTED RANDOM
===================================== */

function weightedRandom(entries, weightKey = "weight") {
    if (!Array.isArray(entries) || !entries.length) {
        return null;
    }

    const validEntries = entries.filter(entry => {
        return (
            Number.isFinite(Number(entry?.[weightKey])) &&
            Number(entry[weightKey]) > 0
        );
    });

    if (!validEntries.length) {
        return null;
    }

    const totalWeight = validEntries.reduce(
        (total, entry) => {
            return total + Number(entry[weightKey]);
        },
        0
    );

    let roll = randomFloat(0, totalWeight);

    for (const entry of validEntries) {
        roll -= Number(entry[weightKey]);

        if (roll < 0) {
            return entry;
        }
    }

    return validEntries[validEntries.length - 1];
}


/* =====================================
   REWARD GENERATION
===================================== */

export function calculateRewards(options = {}) {
    const database = loadRewardDatabase();

    const baseRewards = normalizeRewards(
        options.rewards
    );

    const activity = String(
        options.activity || "gate"
    ).toLowerCase();

    const activityMultiplier =
        database.activityRewards[activity] || {
            xpMultiplier: 1,
            goldMultiplier: 1
        };

    let result = multiplyRewards(
        baseRewards,
        activityMultiplier
    );

    if (options.isBoss === true) {
        result = multiplyRewards(
            result,
            database.bossBonus
        );
    }

    if (options.multiplier) {
        result = multiplyRewards(
            result,
            options.multiplier
        );
    }

    return result;
}


/*
    MonsterEngine هو المسؤول عن حساب مكافأة الوحش.

    لا نعيد تطبيق مضاعف الزعيم هنا؛
    لأن MonsterEngine يحسب مضاعف الزعيم
    ضمن مكافأة الوحش بالفعل.
*/

export function generateMonsterReward(monster) {
    if (!monster) {
        return {
            xp: 0,
            gold: 0
        };
    }

    return normalizeRewards(
        monster.rewards
    );
}


/* =====================================
   CHEST GENERATION
===================================== */

export function getChestTemplates() {
    const database = loadRewardDatabase();

    return clone(database.chests);
}


export function getChestTemplate(chestId) {
    const database = loadRewardDatabase();

    const chest = database.chests.find(
        entry => entry.id === chestId
    );

    return chest
        ? clone(chest)
        : null;
}


export function generateChest(options = {}) {
    const database = loadRewardDatabase();

    let chest;

    if (options.chestId) {
        chest = database.chests.find(
            entry => entry.id === options.chestId
        );

    } else if (options.rarity) {
        chest = database.chests.find(
            entry => (
                String(entry.rarity).toLowerCase() ===
                String(options.rarity).toLowerCase()
            )
        );

    } else {
        chest = weightedRandom(database.chests);
    }

    if (!chest) {
        throw new Error("CHEST_NOT_FOUND");
    }

    return {
        id: createChestId(),

        templateId: chest.id,

        name: chest.name,
        nameAr: chest.nameAr,

        rarity: chest.rarity,

        rewards: {
            ...chest.rewards
        },

        status: "locked",

        createdAt: Date.now(),
        openedAt: null
    };
}


/* =====================================
   CHEST DROP CHANCE
===================================== */

export function rollChestDrop(options = {}) {
    const database = loadRewardDatabase();

    let chance = clamp(
        Number(options.chance) || 0,
        0,
        100
    );

    if (options.isBoss === true) {
        chance += Number(
            database.bossBonus.chestChanceBonus
        ) || 0;
    }

    chance = clamp(chance, 0, 100);

    const dropped = randomFloat(0, 100) < chance;

    if (!dropped) {
        return {
            dropped: false,
            chest: null,
            chance
        };
    }

    return {
        dropped: true,
        chest: generateChest(),
        chance
    };
}


/* =====================================
   OPEN CHEST
===================================== */

export function openChest(chest, baseRewards = {}) {
    if (!chest || typeof chest !== "object") {
        return {
            success: false,
            reason: "INVALID_CHEST"
        };
    }

    if (!chest.id || !chest.templateId) {
        return {
            success: false,
            reason: "INVALID_CHEST_DATA"
        };
    }

    if (chest.status === "opened") {
        return {
            success: false,
            reason: "CHEST_ALREADY_OPENED"
        };
    }

    const template = getChestTemplate(
        chest.templateId
    );

    if (!template) {
        return {
            success: false,
            reason: "CHEST_TEMPLATE_NOT_FOUND"
        };
    }

    const rewards = multiplyRewards(
        normalizeRewards(baseRewards),
        template.rewards
    );

    chest.status = "opened";
    chest.openedAt = Date.now();

    chest.generatedRewards = rewards;

    return {
        success: true,

        chest: {
            id: chest.id,
            templateId: chest.templateId,
            name: chest.name,
            nameAr: chest.nameAr,
            rarity: chest.rarity
        },

        rewards
    };
}


/* =====================================
   REWARD TRANSACTIONS
===================================== */

export function createRewardTransaction(options = {}) {
    const hunterId = normalizeId(options.hunterId);
    const source = normalizeId(options.source);
    const sourceId = normalizeId(options.sourceId);

    if (!hunterId) {
        throw new Error("HUNTER_ID_REQUIRED");
    }

    if (!source) {
        throw new Error("REWARD_SOURCE_REQUIRED");
    }

    if (!sourceId) {
        throw new Error("REWARD_SOURCE_ID_REQUIRED");
    }

    const transactionId = normalizeId(
        options.transactionId
    ) || createRewardId();

    const database = loadClaimsDatabase();

    if (database.transactions[transactionId]) {
        return {
            success: false,
            reason: "TRANSACTION_ALREADY_EXISTS",
            transaction: clone(
                database.transactions[transactionId]
            )
        };
    }

    const rewards = normalizeRewards(
        options.rewards
    );

    const transaction = {
        id: transactionId,

        hunterId,

        source,
        sourceId,

        rewards,

        status: "pending",

        createdAt: Date.now(),
        claimedAt: null
    };

    database.transactions[transactionId] = transaction;

    if (!Array.isArray(database.hunters[hunterId])) {
        database.hunters[hunterId] = [];
    }

    database.hunters[hunterId].push(transactionId);

    saveClaimsDatabase(database);

    return {
        success: true,
        transaction: clone(transaction)
    };
}


/* =====================================
   GET REWARD TRANSACTION
===================================== */

export function getRewardTransaction(transactionId) {
    transactionId = normalizeId(transactionId);

    if (!transactionId) return null;

    const database = loadClaimsDatabase();

    const transaction = database.transactions[
        transactionId
    ];

    return transaction
        ? clone(transaction)
        : null;
}


/* =====================================
   GET HUNTER REWARDS
===================================== */

export function getHunterRewardTransactions(hunterId) {
    hunterId = normalizeId(hunterId);

    if (!hunterId) return [];

    const database = loadClaimsDatabase();

    const transactionIds =
        database.hunters[hunterId] || [];

    return transactionIds
        .map(id => database.transactions[id])
        .filter(Boolean)
        .map(transaction => clone(transaction));
}


export function getPendingRewards(hunterId) {
    return getHunterRewardTransactions(hunterId)
        .filter(transaction => (
            transaction.status === "pending"
        ));
}


/* =====================================
   CLAIM REWARD
===================================== */

/*
    هذه الدالة تسجل الاستلام فقط.
    لا تضيف XP أو Gold إلى حساب اللاعب.

    النظام المسؤول عن الاقتصاد يجب أن:
    1. يقرأ المعاملة.
    2. يطبق المكافأة بنجاح.
    3. يستدعي markRewardClaimed بعد التطبيق.
*/

export function markRewardClaimed(transactionId) {
    transactionId = normalizeId(transactionId);

    if (!transactionId) {
        return {
            success: false,
            reason: "INVALID_TRANSACTION_ID"
        };
    }

    const database = loadClaimsDatabase();

    const transaction = database.transactions[
        transactionId
    ];

    if (!transaction) {
        return {
            success: false,
            reason: "TRANSACTION_NOT_FOUND"
        };
    }

    if (transaction.status === "claimed") {
        return {
            success: false,
            reason: "REWARD_ALREADY_CLAIMED"
        };
    }

    if (transaction.status !== "pending") {
        return {
            success: false,
            reason: "INVALID_TRANSACTION_STATUS"
        };
    }

    transaction.status = "claimed";
    transaction.claimedAt = Date.now();

    saveClaimsDatabase(database);

    return {
        success: true,
        transaction: clone(transaction)
    };
}


/* =====================================
   REWARD SUMMARY
===================================== */

export function getRewardSummary(hunterId) {
    const transactions = getHunterRewardTransactions(
        hunterId
    );

    const summary = {
        pending: {
            xp: 0,
            gold: 0
        },

        claimed: {
            xp: 0,
            gold: 0
        },

        totalTransactions: transactions.length
    };

    for (const transaction of transactions) {
        const target = transaction.status === "claimed"
            ? summary.claimed
            : summary.pending;

        target.xp += transaction.rewards.xp;
        target.gold += transaction.rewards.gold;
    }

    return summary;
}


/* =====================================
   REWARD INFORMATION
===================================== */

export function getRewardRarities() {
    return [...RARITY_ORDER];
}


export function getRewardInfo(transactionId) {
    const transaction = getRewardTransaction(
        transactionId
    );

    if (!transaction) return null;

    return {
        id: transaction.id,

        hunterId: transaction.hunterId,

        source: transaction.source,
        sourceId: transaction.sourceId,

        rewards: { ...transaction.rewards },

        status: transaction.status,

        createdAt: transaction.createdAt,
        claimedAt: transaction.claimedAt
    };
}
