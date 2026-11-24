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
    generateBoss
} from "./MonsterEngine.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOWER_DATABASE = path.resolve(
    __dirname,
    "../database/towers.json"
);

const PROGRESS_FILE = path.join(
    getDataDirectory(),
    "tower_progress.json"
);

const TOTAL_FLOORS = 100;
const BOSS_INTERVAL = 10;
const MAX_ENEMIES_PER_FLOOR = 6;

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


// ==========================================
// GENERAL HELPERS
// ==========================================

function safeNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


function clone(value) {
    return structuredClone(value);
}


function random(min, max) {
    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}


function createRunId() {
    return `TOWER_${Date.now()}_${random(1000, 9999)}`;
}


function validateHunterId(hunterId) {
    return (
        typeof hunterId === "string" &&
        hunterId.trim().length > 0
    );
}


function validateTowerId(towerId) {
    return (
        typeof towerId === "string" &&
        towerId.trim().length > 0
    );
}


function getHunterIdentifier(hunter) {
    if (
        !hunter ||
        typeof hunter.id !== "string" ||
        !hunter.id.trim()
    ) {
        throw new Error("INVALID_HUNTER_ID");
    }

    return hunter.id;
}


function getHunterLevel(hunter) {
    return Math.max(
        1,
        Math.floor(
            safeNumber(hunter?.level, 1)
        )
    );
}


function getHunterRank(hunter) {
    const rank = String(
        hunter?.rank ||
        hunter?.hunterRank ||
        "E"
    ).toUpperCase();

    return RANK_ORDER.includes(rank)
        ? rank
        : null;
}


function getRankIndex(rank) {
    return RANK_ORDER.indexOf(rank);
}


function isObject(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}


// ==========================================
// TOWER DATABASE VALIDATION
// ==========================================

function validateReward(value, fieldName) {
    if (
        !Number.isFinite(Number(value)) ||
        Number(value) < 0
    ) {
        throw new Error(
            `Invalid reward value: ${fieldName}`
        );
    }
}


function validateTower(tower) {
    if (!isObject(tower)) {
        throw new Error("Invalid tower entry.");
    }

    if (
        typeof tower.id !== "string" ||
        !tower.id.trim()
    ) {
        throw new Error(
            "Every tower must have a valid ID."
        );
    }

    if (
        !Number.isInteger(tower.totalFloors) ||
        tower.totalFloors !== TOTAL_FLOORS
    ) {
        throw new Error(
            `Tower ${tower.id} must have exactly ${TOTAL_FLOORS} floors.`
        );
    }

    const rank = String(
        tower.rank || ""
    ).toUpperCase();

    if (!RANK_ORDER.includes(rank)) {
        throw new Error(
            `Tower ${tower.id} has an invalid rank.`
        );
    }

    if (
        !Number.isInteger(tower.minLevel) ||
        tower.minLevel < 1
    ) {
        throw new Error(
            `Tower ${tower.id} has an invalid minimum level.`
        );
    }

    if (
        !Number.isFinite(Number(tower.difficulty)) ||
        Number(tower.difficulty) <= 0
    ) {
        throw new Error(
            `Tower ${tower.id} has an invalid difficulty.`
        );
    }

    if (
        !Array.isArray(tower.enemyTypes) ||
        !tower.enemyTypes.length ||
        !tower.enemyTypes.every(
            item => typeof item === "string" && item.trim()
        )
    ) {
        throw new Error(
            `Tower ${tower.id} has invalid enemy types.`
        );
    }

    if (
        !Array.isArray(tower.bossMonsterIds) ||
        !tower.bossMonsterIds.length ||
        !tower.bossMonsterIds.every(
            item => typeof item === "string" && item.trim()
        )
    ) {
        throw new Error(
            `Tower ${tower.id} has invalid boss monster IDs.`
        );
    }

    if (!isObject(tower.floorRewards)) {
        throw new Error(
            `Tower ${tower.id} has invalid floor rewards.`
        );
    }

    validateReward(
        tower.floorRewards.baseXP,
        `${tower.id}.floorRewards.baseXP`
    );

    validateReward(
        tower.floorRewards.baseGold,
        `${tower.id}.floorRewards.baseGold`
    );

    if (!isObject(tower.rewards)) {
        throw new Error(
            `Tower ${tower.id} has invalid completion rewards.`
        );
    }

    validateReward(
        tower.rewards.completionXP,
        `${tower.id}.rewards.completionXP`
    );

    validateReward(
        tower.rewards.completionGold,
        `${tower.id}.rewards.completionGold`
    );
}


function loadTowerDatabase() {
    if (!fs.existsSync(TOWER_DATABASE)) {
        throw new Error(
            "NOVA TOWER ENGINE: towers.json not found."
        );
    }

    try {
        const content = fs.readFileSync(
            TOWER_DATABASE,
            "utf8"
        );

        if (!content.trim()) {
            throw new Error(
                "Tower database is empty."
            );
        }

        const data = JSON.parse(content);

        if (
            !isObject(data) ||
            !Array.isArray(data.towers) ||
            !data.towers.length
        ) {
            throw new Error(
                "Invalid tower database structure."
            );
        }

        const ids = new Set();

        for (const tower of data.towers) {
            validateTower(tower);

            if (ids.has(tower.id)) {
                throw new Error(
                    `Duplicate tower ID: ${tower.id}`
                );
            }

            ids.add(tower.id);
        }

        return data.towers;

    } catch (error) {
        throw new Error(
            `NOVA TOWER ENGINE: ${error.message}`
        );
    }
}


// ==========================================
// PROGRESS DATABASE
// ==========================================

function getProgressDatabase() {
    const database = readData(
        PROGRESS_FILE,
        {}
    );

    if (!isObject(database)) {
        throw new Error(
            "NOVA TOWER ENGINE: Invalid progress database."
        );
    }

    return database;
}


function saveProgressDatabase(database) {
    writeData(
        PROGRESS_FILE,
        database
    );
}


// ==========================================
// TOWER LOOKUP
// ==========================================

function getTowerById(towerId) {
    if (!validateTowerId(towerId)) {
        return null;
    }

    return loadTowerDatabase().find(
        tower => tower.id === towerId
    ) || null;
}


export function getTowers() {
    return clone(
        loadTowerDatabase()
    );
}


export function getTower(towerId) {
    const tower = getTowerById(towerId);

    return tower
        ? clone(tower)
        : null;
}


// ==========================================
// PROGRESS STRUCTURE
// ==========================================

function createEmptyProgress() {
    return {
        highestFloor: 0,
        currentFloor: 1,

        status: "not_started",
        completed: false,

        activeFloor: null,

        pendingRewards: {
            xp: 0,
            gold: 0
        },

        totalRewards: {
            xp: 0,
            gold: 0
        },

        completedFloors: [],

        rewardsClaimed: false,

        updatedAt: Date.now()
    };
}


function normalizeRewards(rewards) {
    if (!isObject(rewards)) {
        return {
            xp: 0,
            gold: 0
        };
    }

    return {
        xp: Math.max(
            0,
            safeNumber(rewards.xp)
        ),

        gold: Math.max(
            0,
            safeNumber(rewards.gold)
        )
    };
}


function getTowerPlayerData(database, hunterId, towerId) {
    if (!validateHunterId(hunterId)) {
        throw new Error("INVALID_HUNTER_ID");
    }

    if (!validateTowerId(towerId)) {
        throw new Error("INVALID_TOWER_ID");
    }

    if (!isObject(database[hunterId])) {
        database[hunterId] = {
            towers: {},
            history: []
        };
    }

    const hunterProgress = database[hunterId];

    if (!isObject(hunterProgress.towers)) {
        hunterProgress.towers = {};
    }

    if (!Array.isArray(hunterProgress.history)) {
        hunterProgress.history = [];
    }

    if (!isObject(hunterProgress.towers[towerId])) {
        hunterProgress.towers[towerId] =
            createEmptyProgress();
    }

    const progress = hunterProgress.towers[towerId];

    if (!Array.isArray(progress.completedFloors)) {
        progress.completedFloors = [];
    }

    progress.pendingRewards = normalizeRewards(
        progress.pendingRewards
    );

    progress.totalRewards = normalizeRewards(
        progress.totalRewards
    );

    progress.highestFloor = Math.max(
        0,
        Math.floor(
            safeNumber(progress.highestFloor)
        )
    );

    progress.currentFloor = Math.max(
        1,
        Math.min(
            TOTAL_FLOORS,
            Math.floor(
                safeNumber(progress.currentFloor, 1)
            )
        )
    );

    progress.completed = Boolean(
        progress.completed
    );

    progress.rewardsClaimed = Boolean(
        progress.rewardsClaimed
    );

    return progress;
}


// ==========================================
// ACTIVE TOWER VALIDATION
// ==========================================

function validateActiveFloor(progress) {
    const floor = progress?.activeFloor;

    if (!isObject(floor)) {
        return false;
    }

    if (
        floor.number !== progress.currentFloor
    ) {
        return false;
    }

    if (
        !["active", "cleared", "failed"].includes(
            floor.status
        )
    ) {
        return false;
    }

    if (!Array.isArray(floor.enemies)) {
        return false;
    }

    return true;
}


function findOtherActiveTower(
    database,
    hunterId,
    excludedTowerId
) {
    const towers = database[hunterId]?.towers;

    if (!isObject(towers)) {
        return null;
    }

    for (const [towerId, progress] of Object.entries(towers)) {
        if (
            towerId !== excludedTowerId &&
            progress?.status === "active"
        ) {
            return {
                towerId,
                currentFloor: progress.currentFloor || 1,
                highestFloor: progress.highestFloor || 0
            };
        }
    }

    return null;
}


// ==========================================
// FLOOR RULES
// ==========================================

function isBossFloor(floor) {
    return floor % BOSS_INTERVAL === 0;
}


function isSpecialFloor(floor) {
    return (
        floor % BOSS_INTERVAL === 0
    );
}


function calculateFloorDifficulty(tower, floor) {
    const baseDifficulty = safeNumber(
        tower.difficulty,
        1
    );

    const progression = 1 + (
        (floor - 1) * 0.025
    );

    return Number(
        (baseDifficulty * progression).toFixed(3)
    );
}


function calculateFloorEnemyCount(floor) {
    if (isBossFloor(floor)) {
        return 1;
    }

    const count = 1 + Math.floor(
        floor / 20
    );

    return Math.min(
        MAX_ENEMIES_PER_FLOOR,
        Math.max(1, count)
    );
}


// ==========================================
// FLOOR REWARDS
// ==========================================

function calculateFloorRewards(tower, floor) {
    const settings = tower.floorRewards || {};

    const baseXP = safeNumber(
        settings.baseXP,
        15
    );

    const baseGold = safeNumber(
        settings.baseGold,
        10
    );

    const progression = 1 + (
        (floor - 1) * 0.05
    );

    const bossMultiplier = isBossFloor(floor)
        ? 3
        : 1;

    const multiplier = (
        progression * bossMultiplier
    );

    return {
        xp: Math.floor(
            baseXP * multiplier
        ),

        gold: Math.floor(
            baseGold * multiplier
        )
    };
}


// ==========================================
// ENEMY GENERATION
// ==========================================

function selectBossTemplate(tower) {
    const bossIds = tower.bossMonsterIds;

    return bossIds[
        random(0, bossIds.length - 1)
    ];
}


function generateFloorEnemies(hunter, tower, floor) {
    const difficulty = calculateFloorDifficulty(
        tower,
        floor
    );

    if (isBossFloor(floor)) {
        const bossMonsterId = selectBossTemplate(tower);

        const boss = generateBoss(hunter, {
            monsterId: bossMonsterId,
            difficulty
        });

        if (!isObject(boss)) {
            throw new Error(
                `Failed to generate tower boss: ${bossMonsterId}`
            );
        }

        return [boss];
    }

    const enemyCount = calculateFloorEnemyCount(
        floor
    );

    const selectedType = tower.enemyTypes[
        random(0, tower.enemyTypes.length - 1)
    ];

    const enemies = generateMonsterPack(hunter, {
        count: enemyCount,
        difficulty,
        type: selectedType
    });

    if (
        !Array.isArray(enemies) ||
        !enemies.length
    ) {
        throw new Error(
            `Failed to generate enemies for tower ${tower.id}, floor ${floor}.`
        );
    }

    if (enemies.length > MAX_ENEMIES_PER_FLOOR) {
        throw new Error(
            "Monster generator returned too many enemies."
        );
    }

    return enemies;
}


// ==========================================
// FLOOR GENERATION
// ==========================================

function generateTowerFloor(hunter, tower, floorNumber) {
    if (
        !Number.isInteger(floorNumber) ||
        floorNumber < 1 ||
        floorNumber > TOTAL_FLOORS
    ) {
        throw new Error("INVALID_TOWER_FLOOR");
    }

    const bossFloor = isBossFloor(floorNumber);

    const enemies = generateFloorEnemies(
        hunter,
        tower,
        floorNumber
    );

    return {
        number: floorNumber,

        type: bossFloor
            ? "boss"
            : "normal",

        isBossFloor: bossFloor,
        isSpecialFloor: isSpecialFloor(floorNumber),

        status: "active",

        difficulty: calculateFloorDifficulty(
            tower,
            floorNumber
        ),

        enemies,

        rewards: calculateFloorRewards(
            tower,
            floorNumber
        ),

        startedAt: Date.now(),
        completedAt: null
    };
}


// ==========================================
// TOWER RUN CREATION
// ==========================================

function createTowerRecord(tower, hunter) {
    const firstFloor = generateTowerFloor(
        hunter,
        tower,
        1
    );

    const now = Date.now();

    return {
        id: createRunId(),

        towerId: tower.id,
        towerName: tower.name,
        towerNameAr: tower.nameAr,

        hunterId: getHunterIdentifier(hunter),

        totalFloors: TOTAL_FLOORS,

        currentFloor: 1,
        highestFloor: 0,

        status: "active",

        activeFloor: firstFloor,

        completedFloors: [],

        pendingRewards: {
            xp: 0,
            gold: 0
        },

        rewardsClaimed: false,

        startedAt: now,
        updatedAt: now,
        completedAt: null
    };
}


// ==========================================
// TOWER REQUIREMENTS
// ==========================================

export function canEnterTower(hunter, towerId) {
    if (!hunter) {
        return {
            allowed: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    const tower = getTowerById(towerId);

    if (!tower) {
        return {
            allowed: false,
            reason: "TOWER_NOT_FOUND"
        };
    }

    const hunterLevel = getHunterLevel(hunter);
    const hunterRank = getHunterRank(hunter);

    if (!hunterRank) {
        return {
            allowed: false,
            reason: "INVALID_HUNTER_RANK"
        };
    }

    const requiredRank = String(
        tower.rank
    ).toUpperCase();

    if (hunterLevel < tower.minLevel) {
        return {
            allowed: false,
            reason: "LEVEL_TOO_LOW",
            requiredLevel: tower.minLevel,
            currentLevel: hunterLevel
        };
    }

    if (
        getRankIndex(hunterRank) <
        getRankIndex(requiredRank)
    ) {
        return {
            allowed: false,
            reason: "RANK_TOO_LOW",
            requiredRank,
            currentRank: hunterRank
        };
    }

    return {
        allowed: true,
        tower: clone(tower)
    };
}


// ==========================================
// ENTER OR RESUME TOWER
// ==========================================

export function enterTower(hunter, towerId) {
    let hunterId;

    try {
        hunterId = getHunterIdentifier(hunter);
    } catch {
        return {
            success: false,
            reason: "INVALID_HUNTER_ID"
        };
    }

    const requirement = canEnterTower(
        hunter,
        towerId
    );

    if (!requirement.allowed) {
        return {
            success: false,
            reason: requirement.reason,
            details: requirement
        };
    }

    const database = getProgressDatabase();

    const progress = getTowerPlayerData(
        database,
        hunterId,
        towerId
    );

    if (
        progress.completed ||
        progress.status === "completed"
    ) {
        return {
            success: false,
            reason: "TOWER_ALREADY_COMPLETED",
            progress: clone(progress)
        };
    }

    if (progress.status === "active") {
        if (!validateActiveFloor(progress)) {
            return {
                success: false,
                reason: "TOWER_STATE_INVALID"
            };
        }

        return {
            success: true,
            resumed: true,
            floor: clone(progress.activeFloor),
            progress: clone(progress)
        };
    }

    const otherActiveTower = findOtherActiveTower(
        database,
        hunterId,
        towerId
    );

    if (otherActiveTower) {
        return {
            success: false,
            reason: "ANOTHER_TOWER_ACTIVE",
            activeTower: otherActiveTower
        };
    }

    let run;

    try {
        run = createTowerRecord(
            requirement.tower,
            hunter
        );
    } catch (error) {
        return {
            success: false,
            reason: "FLOOR_GENERATION_FAILED",
            error: error.message
        };
    }

    progress.currentFloor = 1;
    progress.highestFloor = 0;

    progress.status = "active";
    progress.completed = false;

    progress.activeFloor = run.activeFloor;

    progress.runId = run.id;

    progress.completedFloors = [];

    progress.pendingRewards = {
        xp: 0,
        gold: 0
    };

    progress.rewardsClaimed = false;

    progress.startedAt = run.startedAt;
    progress.updatedAt = Date.now();

    saveProgressDatabase(database);

    return {
        success: true,
        resumed: false,
        floor: clone(progress.activeFloor),
        progress: clone(progress)
    };
}


// ==========================================
// GET TOWER PROGRESS
// ==========================================

export function getTowerProgress(hunterId, towerId) {
    if (!validateHunterId(hunterId)) {
        throw new Error("INVALID_HUNTER_ID");
    }

    if (!getTowerById(towerId)) {
        return null;
    }

    const database = getProgressDatabase();

    const progress = database[hunterId]?.towers?.[towerId];

    if (!progress) {
        return {
            towerId,
            currentFloor: 1,
            highestFloor: 0,
            status: "not_started",
            completed: false,
            activeFloor: null,
            pendingRewards: {
                xp: 0,
                gold: 0
            },
            totalRewards: {
                xp: 0,
                gold: 0
            },
            completedFloors: [],
            rewardsClaimed: false
        };
    }

    return clone(progress);
}


export function getAllTowerProgress(hunterId) {
    if (!validateHunterId(hunterId)) {
        throw new Error("INVALID_HUNTER_ID");
    }

    const database = getProgressDatabase();

    return clone(
        database[hunterId] || {
            towers: {},
            history: []
        }
    );
}


export function getActiveTowerFloor(hunterId, towerId) {
    const progress = getTowerProgress(
        hunterId,
        towerId
    );

    if (
        !progress ||
        progress.status !== "active" ||
        !progress.activeFloor
    ) {
        return null;
    }

    return clone(progress.activeFloor);
}


// ==========================================
// COMPLETE FLOOR
// ==========================================

export function completeTowerFloor(
    hunterId,
    towerId,
    victory = true
) {
    if (!validateHunterId(hunterId)) {
        return {
            success: false,
            reason: "INVALID_HUNTER_ID"
        };
    }

    const tower = getTowerById(towerId);

    if (!tower) {
        return {
            success: false,
            reason: "TOWER_NOT_FOUND"
        };
    }

    if (typeof victory !== "boolean") {
        return {
            success: false,
            reason: "INVALID_VICTORY_RESULT"
        };
    }

    const database = getProgressDatabase();

    const existingProgress =
        database[hunterId]?.towers?.[towerId];

    if (!existingProgress) {
        return {
            success: false,
            reason: "TOWER_NOT_STARTED"
        };
    }

    const progress = getTowerPlayerData(
        database,
        hunterId,
        towerId
    );

    if (progress.status !== "active") {
        return {
            success: false,
            reason: "TOWER_NOT_ACTIVE"
        };
    }

    const floor = progress.activeFloor;

    if (
        !floor ||
        floor.status !== "active" ||
        !validateActiveFloor(progress)
    ) {
        return {
            success: false,
            reason: "FLOOR_NOT_ACTIVE"
        };
    }

    if (!victory) {
        floor.status = "failed";

        progress.updatedAt = Date.now();

        saveProgressDatabase(database);

        return {
            success: true,
            status: "failed",
            currentFloor: progress.currentFloor,
            message: "FLOOR_CAN_BE_RETRIED"
        };
    }

    floor.status = "cleared";
    floor.completedAt = Date.now();

    progress.highestFloor = Math.max(
        progress.highestFloor,
        floor.number
    );

    if (!progress.completedFloors.includes(floor.number)) {
        progress.completedFloors.push(
            floor.number
        );
    }

    const floorRewards = normalizeRewards(
        floor.rewards
    );

    progress.pendingRewards.xp += floorRewards.xp;
    progress.pendingRewards.gold += floorRewards.gold;

    progress.updatedAt = Date.now();

    const isFinalFloor = (
        floor.number === TOTAL_FLOORS
    );

    if (isFinalFloor) {
        progress.status = "completed";
        progress.completed = true;
        progress.completedAt = Date.now();

        progress.pendingRewards.xp += safeNumber(
            tower.rewards?.completionXP
        );

        progress.pendingRewards.gold += safeNumber(
            tower.rewards?.completionGold
        );

        const hunterProgress = database[hunterId];

        if (!Array.isArray(hunterProgress.history)) {
            hunterProgress.history = [];
        }

        const alreadyRecorded = hunterProgress.history.some(
            entry => entry.runId === progress.runId
        );

        if (!alreadyRecorded) {
            hunterProgress.history.push({
                runId: progress.runId,
                towerId,
                status: "completed",
                highestFloor: TOTAL_FLOORS,
                completedAt: progress.completedAt,
                rewards: clone(progress.pendingRewards)
            });
        }

        saveProgressDatabase(database);

        return {
            success: true,
            status: "completed",
            floor: clone(floor),
            rewards: clone(progress.pendingRewards)
        };
    }

    saveProgressDatabase(database);

    return {
        success: true,
        status: "floor_cleared",
        floor: clone(floor),
        nextFloor: floor.number + 1,
        floorRewards: clone(floorRewards),
        totalPendingRewards: clone(progress.pendingRewards)
    };
}


// ==========================================
// ADVANCE FLOOR
// ==========================================

export function advanceTowerFloor(hunter, towerId) {
    let hunterId;

    try {
        hunterId = getHunterIdentifier(hunter);
    } catch {
        return {
            success: false,
            reason: "INVALID_HUNTER_ID"
        };
    }

    const tower = getTowerById(towerId);

    if (!tower) {
        return {
            success: false,
            reason: "TOWER_NOT_FOUND"
        };
    }

    const database = getProgressDatabase();

    const existingProgress =
        database[hunterId]?.towers?.[towerId];

    if (!existingProgress) {
        return {
            success: false,
            reason: "TOWER_NOT_STARTED"
        };
    }

    const progress = getTowerPlayerData(
        database,
        hunterId,
        towerId
    );

    if (progress.status !== "active") {
        return {
            success: false,
            reason: "TOWER_NOT_ACTIVE"
        };
    }

    const currentFloor = progress.activeFloor;

    if (
        !currentFloor ||
        currentFloor.status !== "cleared" ||
        !validateActiveFloor(progress)
    ) {
        return {
            success: false,
            reason: "CURRENT_FLOOR_NOT_CLEARED"
        };
    }

    const nextFloorNumber = (
        progress.currentFloor + 1
    );

    if (nextFloorNumber > TOTAL_FLOORS) {
        return {
            success: false,
            reason: "TOWER_ALREADY_FINISHED"
        };
    }

    let nextFloor;

    try {
        nextFloor = generateTowerFloor(
            hunter,
            tower,
            nextFloorNumber
        );
    } catch (error) {
        return {
            success: false,
            reason: "FLOOR_GENERATION_FAILED",
            error: error.message
        };
    }

    progress.currentFloor = nextFloorNumber;
    progress.activeFloor = nextFloor;
    progress.updatedAt = Date.now();

    saveProgressDatabase(database);

    return {
        success: true,
        floor: clone(nextFloor),
        progress: clone(progress)
    };
}


// ==========================================
// RETRY FLOOR
// ==========================================

export function retryTowerFloor(hunter, towerId) {
    let hunterId;

    try {
        hunterId = getHunterIdentifier(hunter);
    } catch {
        return {
            success: false,
            reason: "INVALID_HUNTER_ID"
        };
    }

    const tower = getTowerById(towerId);

    if (!tower) {
        return {
            success: false,
            reason: "TOWER_NOT_FOUND"
        };
    }

    const database = getProgressDatabase();

    const existingProgress =
        database[hunterId]?.towers?.[towerId];

    if (!existingProgress) {
        return {
            success: false,
            reason: "TOWER_NOT_STARTED"
        };
    }

    const progress = getTowerPlayerData(
        database,
        hunterId,
        towerId
    );

    if (progress.status !== "active") {
        return {
            success: false,
            reason: "TOWER_NOT_ACTIVE"
        };
    }

    if (
        !progress.activeFloor ||
        progress.activeFloor.status !== "failed"
    ) {
        return {
            success: false,
            reason: "FLOOR_NOT_FAILED"
        };
    }

    let newFloor;

    try {
        newFloor = generateTowerFloor(
            hunter,
            tower,
            progress.currentFloor
        );
    } catch (error) {
        return {
            success: false,
            reason: "FLOOR_GENERATION_FAILED",
            error: error.message
        };
    }

    progress.activeFloor = newFloor;
    progress.updatedAt = Date.now();

    saveProgressDatabase(database);

    return {
        success: true,
        floor: clone(newFloor),
        currentFloor: progress.currentFloor
    };
}


// ==========================================
// CHEST COMPATIBILITY
// ==========================================

// الصناديق متوقفة مؤقتًا.
// الدالة موجودة حتى لا تتسبب في كسر أي Plugin قديم.

export function openTowerChest(hunterId, towerId) {
    if (!validateHunterId(hunterId)) {
        return {
            success: false,
            reason: "INVALID_HUNTER_ID"
        };
    }

    if (!getTowerById(towerId)) {
        return {
            success: false,
            reason: "TOWER_NOT_FOUND"
        };
    }

    return {
        success: false,
        reason: "CHEST_SYSTEM_DISABLED"
    };
}


// ==========================================
// LEAVE TOWER
// ==========================================

export function leaveTower(hunterId, towerId) {
    if (!validateHunterId(hunterId)) {
        return {
            success: false,
            reason: "INVALID_HUNTER_ID"
        };
    }

    if (!getTowerById(towerId)) {
        return {
            success: false,
            reason: "TOWER_NOT_FOUND"
        };
    }

    const database = getProgressDatabase();

    const existingProgress =
        database[hunterId]?.towers?.[towerId];

    if (!existingProgress) {
        return {
            success: false,
            reason: "TOWER_NOT_STARTED"
        };
    }

    const progress = getTowerPlayerData(
        database,
        hunterId,
        towerId
    );

    if (progress.status !== "active") {
        return {
            success: false,
            reason: "TOWER_NOT_ACTIVE"
        };
    }

    progress.updatedAt = Date.now();

    saveProgressDatabase(database);

    return {
        success: true,
        currentFloor: progress.currentFloor,
        highestFloor: progress.highestFloor,
        message: "TOWER_PROGRESS_SAVED"
    };
}


// ==========================================
// CLAIM TOWER REWARDS
// ==========================================

export function claimTowerRewards(hunterId, towerId) {
    if (!validateHunterId(hunterId)) {
        return {
            success: false,
            reason: "INVALID_HUNTER_ID"
        };
    }

    if (!getTowerById(towerId)) {
        return {
            success: false,
            reason: "TOWER_NOT_FOUND"
        };
    }

    const database = getProgressDatabase();

    const existingProgress =
        database[hunterId]?.towers?.[towerId];

    if (!existingProgress) {
        return {
            success: false,
            reason: "TOWER_NOT_STARTED"
        };
    }

    const progress = getTowerPlayerData(
        database,
        hunterId,
        towerId
    );

    if (progress.status !== "completed") {
        return {
            success: false,
            reason: "TOWER_NOT_COMPLETED"
        };
    }

    if (progress.rewardsClaimed) {
        return {
            success: false,
            reason: "REWARDS_ALREADY_CLAIMED"
        };
    }

    const rewards = clone(
        progress.pendingRewards
    );

    progress.rewardsClaimed = true;
    progress.totalRewards = clone(rewards);
    progress.updatedAt = Date.now();

    saveProgressDatabase(database);

    return {
        success: true,
        rewards
    };
}


// ==========================================
// TOWER STATISTICS
// ==========================================

export function getTowerStatistics(hunterId) {
    if (!validateHunterId(hunterId)) {
        throw new Error("INVALID_HUNTER_ID");
    }

    const database = getProgressDatabase();

    const playerProgress = database[hunterId];

    if (!playerProgress) {
        return {
            totalTowers: 0,
            completedTowers: 0,
            highestFloors: {},
            history: []
        };
    }

    const towers = isObject(playerProgress.towers)
        ? playerProgress.towers
        : {};

    const highestFloors = {};

    let completedTowers = 0;

    for (const [towerId, progress] of Object.entries(towers)) {
        highestFloors[towerId] = Math.max(
            0,
            safeNumber(progress?.highestFloor)
        );

        if (
            progress?.completed ||
            progress?.status === "completed"
        ) {
            completedTowers++;
        }
    }

    return {
        totalTowers: Object.keys(towers).length,

        completedTowers,

        highestFloors,

        history: clone(
            Array.isArray(playerProgress.history)
                ? playerProgress.history
                : []
        )
    };
}
