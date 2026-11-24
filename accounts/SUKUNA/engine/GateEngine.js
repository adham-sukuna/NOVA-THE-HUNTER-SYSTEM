import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
    readData,
    writeData,
    getDataDirectory
} from "./storage.js";

import {
    generateMonsterPack,
    generateBoss,
    getMonsterRewards
} from "./MonsterEngine.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const GATE_DATABASE = path.resolve(
    __dirname,
    "../database/gates.json"
);


const PROGRESS_FILE = path.join(
    getDataDirectory(),
    "gate_progress.json"
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


const CHEST_TYPES = [
    {
        id: "common",
        name: "Common Chest",
        nameAr: "صندوق عادي",
        weight: 60,
        rewards: {
            xpMultiplier: 1.2,
            goldMultiplier: 1.2
        }
    },
    {
        id: "rare",
        name: "Rare Chest",
        nameAr: "صندوق نادر",
        weight: 25,
        rewards: {
            xpMultiplier: 1.5,
            goldMultiplier: 1.5
        }
    },
    {
        id: "epic",
        name: "Epic Chest",
        nameAr: "صندوق ملحمي",
        weight: 12,
        rewards: {
            xpMultiplier: 2,
            goldMultiplier: 2
        }
    },
    {
        id: "legendary",
        name: "Legendary Chest",
        nameAr: "صندوق أسطوري",
        weight: 3,
        rewards: {
            xpMultiplier: 3,
            goldMultiplier: 3
        }
    }
];


const DEFAULT_DATABASE = {
    hunters: {}
};


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


function normalizeLevel(hunter) {
    return Math.max(
        1,
        Number(hunter?.level) || 1
    );
}


function normalizeRank(hunter) {
    const rank = String(
        hunter?.rank ||
        hunter?.hunterRank ||
        "E"
    ).toUpperCase();

    return RANK_ORDER.includes(rank)
        ? rank
        : "E";
}


function getRankIndex(rank) {
    return RANK_ORDER.indexOf(rank);
}


function isValidRank(rank) {
    return RANK_ORDER.includes(
        String(rank || "").toUpperCase()
    );
}


function randomChest() {
    const totalWeight = CHEST_TYPES.reduce(
        (sum, chest) => sum + chest.weight,
        0
    );

    let roll = randomFloat(0, totalWeight);

    for (const chest of CHEST_TYPES) {
        roll -= chest.weight;

        if (roll <= 0) {
            return {
                id: chest.id,
                name: chest.name,
                nameAr: chest.nameAr,
                rewards: { ...chest.rewards }
            };
        }
    }

    const fallback = CHEST_TYPES[0];

    return {
        id: fallback.id,
        name: fallback.name,
        nameAr: fallback.nameAr,
        rewards: { ...fallback.rewards }
    };
}


function getEmptyProgress(hunterId) {
    return {
        hunterId,

        activeGateId: null,

        gates: {},

        statistics: {
            entered: 0,
            completed: 0,
            failed: 0,
            totalWavesCleared: 0,
            totalRewardsClaimed: 0
        },

        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}


/* =====================================
   DATABASE
===================================== */

function loadGateDatabase() {
    if (!fs.existsSync(GATE_DATABASE)) {
        throw new Error(
            "NOVA GATE ENGINE: gates.json not found."
        );
    }

    try {
        const data = JSON.parse(
            fs.readFileSync(GATE_DATABASE, "utf8")
        );

        if (!Array.isArray(data.gates)) {
            throw new Error(
                "Invalid gates database structure."
            );
        }

        return data.gates;

    } catch (error) {
        throw new Error(
            `NOVA GATE ENGINE: ${error.message}`
        );
    }
}


function loadProgressDatabase() {
    const database = readData(
        PROGRESS_FILE,
        DEFAULT_DATABASE
    );

    if (
        !database ||
        typeof database !== "object" ||
        Array.isArray(database)
    ) {
        throw new Error(
            "NOVA GATE ENGINE: Invalid progress database."
        );
    }

    if (!database.hunters) {
        database.hunters = {};
    }

    return database;
}


function saveProgressDatabase(database) {
    writeData(
        PROGRESS_FILE,
        database
    );
}


function getHunterProgress(database, hunterId) {
    if (!database.hunters[hunterId]) {
        database.hunters[hunterId] =
            getEmptyProgress(hunterId);
    }

    const progress = database.hunters[hunterId];

    if (!progress.gates) {
        progress.gates = {};
    }

    if (!progress.statistics) {
        progress.statistics = {
            entered: 0,
            completed: 0,
            failed: 0,
            totalWavesCleared: 0,
            totalRewardsClaimed: 0
        };
    }

    return progress;
}


function getGateProgressEntry(progress, gateId) {
    return progress.gates[gateId] || null;
}


function saveHunterProgress(
    database,
    hunterId,
    progress
) {
    progress.updatedAt = Date.now();

    database.hunters[hunterId] = progress;

    saveProgressDatabase(database);
}


/* =====================================
   GATE LOOKUP
===================================== */

export function getGates() {
    return loadGateDatabase();
}


export function getGate(gateId) {
    return loadGateDatabase().find(
        gate => gate.id === gateId
    ) || null;
}


export function getAvailableGates(hunter) {
    if (!hunter) return [];

    const level = normalizeLevel(hunter);
    const rank = normalizeRank(hunter);

    const hunterRankIndex = getRankIndex(rank);

    return loadGateDatabase().filter(gate => {
        if (level < Number(gate.minLevel || 1)) {
            return false;
        }

        if (
            gate.maxLevel &&
            level > Number(gate.maxLevel)
        ) {
            return false;
        }

        const requiredRank = String(
            gate.rank || "E"
        ).toUpperCase();

        if (!isValidRank(requiredRank)) {
            return false;
        }

        return (
            hunterRankIndex >= getRankIndex(requiredRank)
        );
    });
}


/* =====================================
   GATE REQUIREMENTS
===================================== */

export function canEnterGate(hunter, gateId) {
    if (!hunter) {
        return {
            allowed: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    const gate = getGate(gateId);

    if (!gate) {
        return {
            allowed: false,
            reason: "GATE_NOT_FOUND"
        };
    }

    const level = normalizeLevel(hunter);
    const rank = normalizeRank(hunter);

    const requiredRank = String(
        gate.rank || "E"
    ).toUpperCase();

    if (!isValidRank(requiredRank)) {
        return {
            allowed: false,
            reason: "INVALID_GATE_RANK"
        };
    }

    if (level < Number(gate.minLevel || 1)) {
        return {
            allowed: false,
            reason: "LEVEL_TOO_LOW",
            requiredLevel: gate.minLevel,
            currentLevel: level
        };
    }

    if (
        gate.maxLevel &&
        level > Number(gate.maxLevel)
    ) {
        return {
            allowed: false,
            reason: "LEVEL_TOO_HIGH",
            maxLevel: gate.maxLevel,
            currentLevel: level
        };
    }

    if (
        getRankIndex(rank) <
        getRankIndex(requiredRank)
    ) {
        return {
            allowed: false,
            reason: "RANK_TOO_LOW",
            requiredRank,
            currentRank: rank
        };
    }

    if (
        !Array.isArray(gate.waves) ||
        gate.waves.length === 0
    ) {
        return {
            allowed: false,
            reason: "INVALID_GATE_WAVES"
        };
    }

    return {
        allowed: true,
        gate
    };
}


/* =====================================
   WAVE GENERATION
===================================== */

function generateGateWave(hunter, gate, waveIndex) {
    const wave = gate.waves[waveIndex];

    if (!wave) {
        throw new Error("GATE_WAVE_NOT_FOUND");
    }

    const difficulty = Number(
        gate.difficulty || 1
    );

    const waveDifficulty = difficulty * (
        1 + waveIndex * 0.08
    );

    let monsters;

    if (wave.boss === true) {
        const boss = generateBoss(hunter, {
            monsterId: wave.bossMonsterId,
            difficulty: waveDifficulty
        });

        monsters = [boss];

    } else {
        const monsterIds = Array.isArray(
            wave.monsterIds
        )
            ? wave.monsterIds
            : [];

        if (!monsterIds.length) {
            throw new Error(
                `GATE_WAVE_HAS_NO_MONSTERS: ${waveIndex}`
            );
        }

        monsters = generateMonsterPack(hunter, {
            count: wave.count || 3,
            monsterIds,
            difficulty: waveDifficulty
        });
    }

    return {
        index: waveIndex,

        name: wave.name || `Wave ${waveIndex + 1}`,
        nameAr: wave.nameAr || `الموجة ${waveIndex + 1}`,

        isBossWave: wave.boss === true,

        status: "waiting",

        monsters,

        createdAt: Date.now(),
        completedAt: null
    };
}


function generateAllGateWaves(hunter, gate) {
    return gate.waves.map(
        (wave, index) => generateGateWave(
            hunter,
            gate,
            index
        )
    );
}


/* =====================================
   GATE ENTRY
===================================== */

export function enterGate(hunterId, hunter, gateId) {
    hunterId = normalizeId(hunterId);
    gateId = normalizeId(gateId);

    if (!hunterId) {
        throw new Error("HUNTER_ID_REQUIRED");
    }

    if (!gateId) {
        throw new Error("GATE_ID_REQUIRED");
    }

    const requirement = canEnterGate(
        hunter,
        gateId
    );

    if (!requirement.allowed) {
        return {
            success: false,
            ...requirement
        };
    }

    const gate = requirement.gate;

    const database = loadProgressDatabase();

    const progress = getHunterProgress(
        database,
        hunterId
    );

    const existing = getGateProgressEntry(
        progress,
        gateId
    );

    /*
       إذا كان الصياد قد دخل البوابة من قبل
       وما زالت رحلته نشطة، يرجع لنفس التقدم.
    */

    if (
        existing &&
        existing.status === "active"
    ) {
        progress.activeGateId = gateId;

        saveHunterProgress(
            database,
            hunterId,
            progress
        );

        return {
            success: true,
            resumed: true,
            gate,
            progress: existing,
            currentWave: existing.waves[
                existing.currentWave
            ]
        };
    }

    /*
       منع دخول بوابة أخرى أثناء وجود رحلة نشطة.
    */

    if (progress.activeGateId) {
        const active = progress.gates[
            progress.activeGateId
        ];

        if (active?.status === "active") {
            return {
                success: false,
                reason: "ANOTHER_GATE_ACTIVE",
                activeGateId: progress.activeGateId
            };
        }
    }

    const waves = generateAllGateWaves(
        hunter,
        gate
    );

    if (!waves.length) {
        throw new Error("GATE_HAS_NO_WAVES");
    }

    waves[0].status = "active";

    const newProgress = {
        gateId,
        hunterId,

        status: "active",

        currentWave: 0,

        totalWaves: waves.length,

        waves,

        chest: {
            available: false,
            opened: false,
            data: null
        },

        rewards: {
            xp: Number(gate.rewards?.xp) || 0,
            gold: Number(gate.rewards?.gold) || 0
        },

        pendingRewards: {
            xp: 0,
            gold: 0
        },

        rewardsClaimed: false,

        startedAt: Date.now(),
        completedAt: null,
        updatedAt: Date.now()
    };

    progress.gates[gateId] = newProgress;
    progress.activeGateId = gateId;

    progress.statistics.entered++;

    saveHunterProgress(
        database,
        hunterId,
        progress
    );

    return {
        success: true,
        resumed: false,
        gate,
        progress: newProgress,
        currentWave: waves[0]
    };
}


/* =====================================
   PROGRESS
===================================== */

export function getGateProgress(hunterId, gateId) {
    hunterId = normalizeId(hunterId);
    gateId = normalizeId(gateId);

    if (!hunterId || !gateId) {
        return null;
    }

    const database = loadProgressDatabase();

    const progress = database.hunters[hunterId];

    if (!progress) return null;

    return progress.gates?.[gateId] || null;
}


export function getAllGateProgress(hunterId) {
    hunterId = normalizeId(hunterId);

    if (!hunterId) return {};

    const database = loadProgressDatabase();

    return database.hunters[hunterId]?.gates || {};
}


export function getActiveGate(hunterId) {
    hunterId = normalizeId(hunterId);

    if (!hunterId) return null;

    const database = loadProgressDatabase();

    const progress = database.hunters[hunterId];

    if (!progress?.activeGateId) {
        return null;
    }

    const gateProgress = progress.gates[
        progress.activeGateId
    ];

    if (gateProgress?.status !== "active") {
        return null;
    }

    return {
        gateId: progress.activeGateId,
        progress: gateProgress
    };
}


export function getCurrentGateWave(hunterId, gateId) {
    const progress = getGateProgress(
        hunterId,
        gateId
    );

    if (!progress || progress.status !== "active") {
        return null;
    }

    return progress.waves?.[
        progress.currentWave
    ] || null;
}


/* =====================================
   WAVE COMPLETION
===================================== */

/*
    يجب استدعاء الدالة دي بعد انتهاء القتال الحقيقي
    والتأكد من أن جميع وحوش الموجة هُزمت.
*/

export function completeGateWave(
    hunterId,
    gateId,
    victory = true
) {
    hunterId = normalizeId(hunterId);
    gateId = normalizeId(gateId);

    if (!hunterId || !gateId) {
        throw new Error("INVALID_GATE_IDENTITY");
    }

    const database = loadProgressDatabase();

    const progress = getHunterProgress(
        database,
        hunterId
    );

    const gateProgress = getGateProgressEntry(
        progress,
        gateId
    );

    if (!gateProgress) {
        return {
            success: false,
            reason: "GATE_PROGRESS_NOT_FOUND"
        };
    }

    if (gateProgress.status !== "active") {
        return {
            success: false,
            reason: "GATE_NOT_ACTIVE"
        };
    }

    const wave = gateProgress.waves[
        gateProgress.currentWave
    ];

    if (!wave) {
        return {
            success: false,
            reason: "WAVE_NOT_FOUND"
        };
    }

    if (wave.status === "cleared") {
        return {
            success: false,
            reason: "WAVE_ALREADY_CLEARED"
        };
    }

    if (victory !== true) {
        wave.status = "failed";

        gateProgress.status = "failed";
        gateProgress.failedAt = Date.now();

        progress.activeGateId = null;
        progress.statistics.failed++;

        saveHunterProgress(
            database,
            hunterId,
            progress
        );

        return {
            success: true,
            victory: false,
            status: "failed"
        };
    }

    wave.status = "cleared";
    wave.completedAt = Date.now();

    const monsterRewards = wave.monsters.reduce(
        (total, monster) => {
            const rewards = getMonsterRewards(monster);

            total.xp += rewards.xp;
            total.gold += rewards.gold;

            return total;
        },
        {
            xp: 0,
            gold: 0
        }
    );

    gateProgress.pendingRewards.xp += monsterRewards.xp;
    gateProgress.pendingRewards.gold += monsterRewards.gold;

    gateProgress.statistics ||= {
        wavesCleared: 0,
        monstersDefeated: 0
    };

    gateProgress.statistics.wavesCleared++;

    gateProgress.statistics.monstersDefeated +=
        wave.monsters.length;

    progress.statistics.totalWavesCleared++;

    const isFinalWave =
        gateProgress.currentWave >=
        gateProgress.totalWaves - 1;

    if (!isFinalWave) {
        const nextWaveIndex =
            gateProgress.currentWave + 1;

        gateProgress.waves[
            nextWaveIndex
        ].status = "active";

        gateProgress.currentWave = nextWaveIndex;

        saveHunterProgress(
            database,
            hunterId,
            progress
        );

        return {
            success: true,
            victory: true,
            completed: false,

            clearedWave: wave,

            currentWave: gateProgress.waves[
                nextWaveIndex
            ],

            pendingRewards: {
                ...gateProgress.pendingRewards
            }
        };
    }

    /*
       انتهاء البوابة بالكامل.
    */

    gateProgress.status = "completed";
    gateProgress.completedAt = Date.now();

    gateProgress.pendingRewards.xp +=
        gateProgress.rewards.xp;

    gateProgress.pendingRewards.gold +=
        gateProgress.rewards.gold;

    const gate = getGate(gateId);

    const chestChance = clamp(
        Number(gate?.chestChance) || 0,
        0,
        100
    );

    const hasChest = random(1, 100) <= chestChance;

    if (hasChest) {
        gateProgress.chest = {
            available: true,
            opened: false,
            data: randomChest()
        };
    }

    progress.activeGateId = null;
    progress.statistics.completed++;

    saveHunterProgress(
        database,
        hunterId,
        progress
    );

    return {
        success: true,
        victory: true,
        completed: true,

        chestAvailable: hasChest,
        chest: hasChest
            ? gateProgress.chest.data
            : null,

        pendingRewards: {
            ...gateProgress.pendingRewards
        }
    };
}


/* =====================================
   RETRY FAILED GATE
===================================== */

export function retryGate(hunterId, hunter, gateId) {
    hunterId = normalizeId(hunterId);
    gateId = normalizeId(gateId);

    if (!hunterId || !gateId) {
        throw new Error("INVALID_GATE_IDENTITY");
    }

    const requirement = canEnterGate(
        hunter,
        gateId
    );

    if (!requirement.allowed) {
        return {
            success: false,
            ...requirement
        };
    }

    const database = loadProgressDatabase();

    const progress = getHunterProgress(
        database,
        hunterId
    );

    const existing = getGateProgressEntry(
        progress,
        gateId
    );

    if (!existing || existing.status !== "failed") {
        return {
            success: false,
            reason: "GATE_NOT_FAILED"
        };
    }

    if (progress.activeGateId) {
        const active = progress.gates[
            progress.activeGateId
        ];

        if (active?.status === "active") {
            return {
                success: false,
                reason: "ANOTHER_GATE_ACTIVE"
            };
        }
    }

    const gate = requirement.gate;

    const waves = generateAllGateWaves(
        hunter,
        gate
    );

    waves[0].status = "active";

    const newProgress = {
        gateId,
        hunterId,

        status: "active",

        currentWave: 0,

        totalWaves: waves.length,

        waves,

        chest: {
            available: false,
            opened: false,
            data: null
        },

        rewards: {
            xp: Number(gate.rewards?.xp) || 0,
            gold: Number(gate.rewards?.gold) || 0
        },

        pendingRewards: {
            xp: 0,
            gold: 0
        },

        rewardsClaimed: false,

        startedAt: Date.now(),
        completedAt: null,
        updatedAt: Date.now()
    };

    progress.gates[gateId] = newProgress;
    progress.activeGateId = gateId;

    saveHunterProgress(
        database,
        hunterId,
        progress
    );

    return {
        success: true,
        gate,
        progress: newProgress,
        currentWave: waves[0]
    };
}


/* =====================================
   LEAVE GATE
===================================== */

export function leaveGate(hunterId, gateId) {
    hunterId = normalizeId(hunterId);
    gateId = normalizeId(gateId);

    if (!hunterId || !gateId) {
        return {
            success: false,
            reason: "INVALID_GATE_IDENTITY"
        };
    }

    const database = loadProgressDatabase();

    const progress = database.hunters[hunterId];

    if (!progress) {
        return {
            success: false,
            reason: "HUNTER_PROGRESS_NOT_FOUND"
        };
    }

    const gateProgress = progress.gates?.[gateId];

    if (!gateProgress || gateProgress.status !== "active") {
        return {
            success: false,
            reason: "GATE_NOT_ACTIVE"
        };
    }

    if (progress.activeGateId === gateId) {
        progress.activeGateId = null;
    }

    gateProgress.updatedAt = Date.now();

    saveHunterProgress(
        database,
        hunterId,
        progress
    );

    return {
        success: true,
        resumed: true,
        gateId,
        currentWave: gateProgress.currentWave
    };
}


/* =====================================
   CHEST SYSTEM
===================================== */

export function openGateChest(hunterId, gateId) {
    hunterId = normalizeId(hunterId);
    gateId = normalizeId(gateId);

    if (!hunterId || !gateId) {
        return {
            success: false,
            reason: "INVALID_GATE_IDENTITY"
        };
    }

    const database = loadProgressDatabase();

    const progress = database.hunters[hunterId];

    const gateProgress = progress?.gates?.[gateId];

    if (!gateProgress) {
        return {
            success: false,
            reason: "GATE_PROGRESS_NOT_FOUND"
        };
    }

    if (gateProgress.status !== "completed") {
        return {
            success: false,
            reason: "GATE_NOT_COMPLETED"
        };
    }

    if (!gateProgress.chest?.available) {
        return {
            success: false,
            reason: "NO_CHEST_AVAILABLE"
        };
    }

    if (gateProgress.chest.opened) {
        return {
            success: false,
            reason: "CHEST_ALREADY_OPENED"
        };
    }

    const chest = gateProgress.chest.data;

    if (!chest?.rewards) {
        return {
            success: false,
            reason: "INVALID_CHEST_DATA"
        };
    }

    const xpMultiplier = Number(
        chest.rewards.xpMultiplier
    ) || 1;

    const goldMultiplier = Number(
        chest.rewards.goldMultiplier
    ) || 1;

    const bonusXP = Math.floor(
        gateProgress.rewards.xp *
        (xpMultiplier - 1)
    );

    const bonusGold = Math.floor(
        gateProgress.rewards.gold *
        (goldMultiplier - 1)
    );

    gateProgress.pendingRewards.xp += bonusXP;
    gateProgress.pendingRewards.gold += bonusGold;

    gateProgress.chest.opened = true;
    gateProgress.chest.openedAt = Date.now();

    saveHunterProgress(
        database,
        hunterId,
        progress
    );

    return {
        success: true,

        chest: {
            id: chest.id,
            name: chest.name,
            nameAr: chest.nameAr
        },

        rewards: {
            xp: bonusXP,
            gold: bonusGold
        },

        totalPendingRewards: {
            ...gateProgress.pendingRewards
        }
    };
}


/* =====================================
   CLAIM REWARDS
===================================== */

export function claimGateRewards(hunterId, gateId) {
    hunterId = normalizeId(hunterId);
    gateId = normalizeId(gateId);

    if (!hunterId || !gateId) {
        return {
            success: false,
            reason: "INVALID_GATE_IDENTITY"
        };
    }

    const database = loadProgressDatabase();

    const progress = database.hunters[hunterId];

    const gateProgress = progress?.gates?.[gateId];

    if (!gateProgress) {
        return {
            success: false,
            reason: "GATE_PROGRESS_NOT_FOUND"
        };
    }

    if (gateProgress.status !== "completed") {
        return {
            success: false,
            reason: "GATE_NOT_COMPLETED"
        };
    }

    if (gateProgress.rewardsClaimed) {
        return {
            success: false,
            reason: "REWARDS_ALREADY_CLAIMED"
        };
    }

    /*
       لا نسمح باستلام مكافآت البوابة
       قبل فتح الصندوق المتاح.
    */

    if (
        gateProgress.chest?.available &&
        !gateProgress.chest.opened
    ) {
        return {
            success: false,
            reason: "CHEST_NOT_OPENED"
        };
    }

    const rewards = {
        xp: Math.max(
            0,
            Number(gateProgress.pendingRewards?.xp) || 0
        ),

        gold: Math.max(
            0,
            Number(gateProgress.pendingRewards?.gold) || 0
        )
    };

    gateProgress.rewardsClaimed = true;
    gateProgress.claimedAt = Date.now();

    gateProgress.pendingRewards = {
        xp: 0,
        gold: 0
    };

    progress.statistics.totalRewardsClaimed++;

    saveHunterProgress(
        database,
        hunterId,
        progress
    );

    return {
        success: true,
        rewards
    };
}


/* =====================================
   GATE STATISTICS
===================================== */

export function getGateStatistics(hunterId) {
    hunterId = normalizeId(hunterId);

    if (!hunterId) return null;

    const database = loadProgressDatabase();

    const progress = database.hunters[hunterId];

    if (!progress) {
        return getEmptyProgress(hunterId).statistics;
    }

    return {
        ...progress.statistics
    };
}


/* =====================================
   GATE INFORMATION
===================================== */

export function getGateInfo(gateId) {
    const gate = getGate(gateId);

    if (!gate) return null;

    return {
        id: gate.id,

        name: gate.name,
        nameAr: gate.nameAr,

        description: gate.description,

        rank: gate.rank,

        minLevel: gate.minLevel,
        maxLevel: gate.maxLevel,

        difficulty: gate.difficulty,

        totalWaves: gate.waves.length,

        rewards: {
            xp: Number(gate.rewards?.xp) || 0,
            gold: Number(gate.rewards?.gold) || 0
        },

        chestChance: Number(gate.chestChance) || 0
    };
}
