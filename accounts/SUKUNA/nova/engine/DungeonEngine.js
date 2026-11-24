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

const DUNGEON_DATABASE = path.resolve(
    __dirname,
    "../database/dungeons.json"
);

const PROGRESS_FILE = path.join(
    getDataDirectory(),
    "dungeon_progress.json"
);


const MAX_ENEMIES_PER_ROOM = 5;


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


function random(min, max) {
    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}


function safeNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


function clone(value) {
    return structuredClone(value);
}


function loadDungeonDatabase() {
    if (!fs.existsSync(DUNGEON_DATABASE)) {
        throw new Error(
            "NOVA DUNGEON ENGINE: dungeons.json not found."
        );
    }

    try {
        const data = JSON.parse(
            fs.readFileSync(DUNGEON_DATABASE, "utf8")
        );

        if (!Array.isArray(data.dungeons)) {
            throw new Error(
                "Invalid dungeon database structure."
            );
        }

        return data.dungeons;

    } catch (error) {
        throw new Error(
            `NOVA DUNGEON ENGINE: ${error.message}`
        );
    }
}


function getProgressDatabase() {
    return readData(PROGRESS_FILE, {});
}


function saveProgressDatabase(data) {
    writeData(PROGRESS_FILE, data);
}


function getHunterIdentifier(hunter) {
    const id = hunter?.id;

    if (!id || typeof id !== "string") {
        throw new Error("INVALID_HUNTER_ID");
    }

    return id;
}


function getHunterLevel(hunter) {
    return Math.max(
        1,
        safeNumber(hunter?.level, 1)
    );
}


function getHunterRank(hunter) {
    const rank = String(
        hunter?.rank || hunter?.hunterRank || "E"
    ).toUpperCase();

    return RANK_ORDER.includes(rank)
        ? rank
        : "E";
}


function getRankIndex(rank) {
    return RANK_ORDER.indexOf(rank);
}


function getDungeonById(dungeonId) {
    return loadDungeonDatabase().find(
        dungeon => dungeon.id === dungeonId
    ) || null;
}


function createRunId() {
    return `DUNGEON_${Date.now()}_${random(1000, 9999)}`;
}


function getRoomEnemyCount(roomNumber, totalRooms) {
    if (roomNumber === totalRooms) {
        return 0;
    }

    if (roomNumber <= 2) {
        return random(1, 2);
    }

    return random(2, 4);
}


function calculateRoomDifficulty(dungeon, roomNumber) {
    const baseDifficulty = safeNumber(
        dungeon.difficulty,
        1
    );

    const progression = 1 + (
        (roomNumber - 1) * 0.035
    );

    return Number(
        (baseDifficulty * progression).toFixed(3)
    );
}


function calculateRoomRewards(monsters) {
    let xp = 0;
    let gold = 0;

    for (const monster of monsters) {
        const rewards = getMonsterRewards(monster);

        xp += rewards.xp;
        gold += rewards.gold;
    }

    return {
        xp,
        gold
    };
}


function getActiveRun(database, hunterId) {
    const hunterProgress = database[hunterId];

    if (!hunterProgress) {
        return null;
    }

    return hunterProgress.activeRun || null;
}


function saveActiveRun(database, hunterId, run) {
    if (!database[hunterId]) {
        database[hunterId] = {
            activeRun: null,
            completedDungeons: [],
            dungeonHistory: []
        };
    }

    database[hunterId].activeRun = run;

    saveProgressDatabase(database);
}


function normalizeHunterProgress(database, hunterId) {
    if (!database[hunterId]) {
        database[hunterId] = {
            activeRun: null,
            completedDungeons: [],
            dungeonHistory: []
        };
    }

    const progress = database[hunterId];

    if (!Array.isArray(progress.completedDungeons)) {
        progress.completedDungeons = [];
    }

    if (!Array.isArray(progress.dungeonHistory)) {
        progress.dungeonHistory = [];
    }

    return progress;
}


/* =====================================
   DUNGEON DATABASE
===================================== */

export function getDungeons() {
    return clone(loadDungeonDatabase());
}


export function getDungeon(dungeonId) {
    const dungeon = getDungeonById(dungeonId);

    return dungeon
        ? clone(dungeon)
        : null;
}


export function getAvailableDungeons(hunter) {
    if (!hunter) {
        throw new Error("HUNTER_NOT_FOUND");
    }

    const hunterLevel = getHunterLevel(hunter);
    const hunterRank = getHunterRank(hunter);

    const hunterRankIndex = getRankIndex(hunterRank);

    return loadDungeonDatabase()
        .filter(dungeon => {
            const requiredLevel = safeNumber(
                dungeon.minLevel,
                1
            );

            const requiredRankIndex = getRankIndex(
                String(dungeon.rank || "E").toUpperCase()
            );

            return (
                hunterLevel >= requiredLevel &&
                hunterRankIndex >= requiredRankIndex
            );
        })
        .map(dungeon => clone(dungeon));
}


/* =====================================
   DUNGEON REQUIREMENTS
===================================== */

export function canEnterDungeon(hunter, dungeonId) {
    if (!hunter) {
        return {
            allowed: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    const dungeon = getDungeonById(dungeonId);

    if (!dungeon) {
        return {
            allowed: false,
            reason: "DUNGEON_NOT_FOUND"
        };
    }

    const hunterLevel = getHunterLevel(hunter);
    const hunterRank = getHunterRank(hunter);

    const requiredLevel = safeNumber(
        dungeon.minLevel,
        1
    );

    const requiredRank = String(
        dungeon.rank || "E"
    ).toUpperCase();

    if (hunterLevel < requiredLevel) {
        return {
            allowed: false,
            reason: "LEVEL_TOO_LOW",
            requiredLevel,
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
        dungeon: clone(dungeon)
    };
}


/* =====================================
   ROOM GENERATION
===================================== */

function generateDungeonRoom(hunter, dungeon, roomNumber) {
    const totalRooms = safeNumber(
        dungeon.rooms,
        5
    );

    const isBossRoom = (
        roomNumber === dungeon.bossRoom
    );

    const difficulty = calculateRoomDifficulty(
        dungeon,
        roomNumber
    );

    if (isBossRoom) {
        const boss = generateBoss(hunter, {
            monsterId: dungeon.bossMonsterId,
            difficulty: difficulty
        });

        return {
            number: roomNumber,
            type: "boss",
            status: "active",
            enemies: [boss],
            rewards: calculateRoomRewards([boss]),
            completedAt: null
        };
    }

    const enemyCount = Math.min(
        MAX_ENEMIES_PER_ROOM,
        getRoomEnemyCount(roomNumber, totalRooms)
    );

    const enemyTypes = Array.isArray(
        dungeon.enemyTypes
    ) && dungeon.enemyTypes.length
        ? dungeon.enemyTypes
        : undefined;

    const selectedType = enemyTypes
        ? enemyTypes[
            random(0, enemyTypes.length - 1)
        ]
        : undefined;

    const enemies = generateMonsterPack(hunter, {
        count: enemyCount,
        difficulty,
        type: selectedType
    });

    return {
        number: roomNumber,
        type: "normal",
        status: "active",
        enemies,
        rewards: calculateRoomRewards(enemies),
        completedAt: null
    };
}


/* =====================================
   START DUNGEON
===================================== */

export function startDungeon(hunter, dungeonId) {
    const hunterId = getHunterIdentifier(hunter);

    const requirement = canEnterDungeon(
        hunter,
        dungeonId
    );

    if (!requirement.allowed) {
        return {
            success: false,
            reason: requirement.reason,
            details: requirement
        };
    }

    const database = getProgressDatabase();

    const progress = normalizeHunterProgress(
        database,
        hunterId
    );

    if (progress.activeRun) {
        return {
            success: false,
            reason: "ACTIVE_DUNGEON_EXISTS",
            activeRun: clone(progress.activeRun)
        };
    }

    const dungeon = requirement.dungeon;

    const firstRoom = generateDungeonRoom(
        hunter,
        dungeon,
        1
    );

    const run = {
        id: createRunId(),

        hunterId,

        dungeonId: dungeon.id,
        dungeonName: dungeon.name,
        dungeonNameAr: dungeon.nameAr,

        totalRooms: dungeon.rooms,

        currentRoom: 1,

        status: "active",

        rooms: [firstRoom],

        clearedRooms: [],

        pendingRewards: {
            xp: 0,
            gold: 0
        },

        startedAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: null
    };

    progress.activeRun = run;

    saveProgressDatabase(database);

    return {
        success: true,
        run: clone(run)
    };
}


/* =====================================
   GET DUNGEON PROGRESS
===================================== */

export function getDungeonProgress(hunterId) {
    if (!hunterId || typeof hunterId !== "string") {
        throw new Error("INVALID_HUNTER_ID");
    }

    const database = getProgressDatabase();

    const progress = database[hunterId];

    if (!progress) {
        return {
            activeRun: null,
            completedDungeons: [],
            dungeonHistory: []
        };
    }

    return clone(progress);
}


export function getActiveDungeon(hunterId) {
    const database = getProgressDatabase();

    const run = getActiveRun(
        database,
        hunterId
    );

    return run
        ? clone(run)
        : null;
}


/* =====================================
   GET CURRENT ROOM
===================================== */

export function getCurrentDungeonRoom(hunterId) {
    const run = getActiveDungeon(hunterId);

    if (!run || run.status !== "active") {
        return null;
    }

    return clone(
        run.rooms.find(
            room => room.number === run.currentRoom
        ) || null
    );
}


/* =====================================
   COMPLETE CURRENT ROOM
===================================== */

export function completeDungeonRoom(
    hunterId,
    victory = true
) {
    const database = getProgressDatabase();

    const run = getActiveRun(
        database,
        hunterId
    );

    if (!run) {
        return {
            success: false,
            reason: "NO_ACTIVE_DUNGEON"
        };
    }

    if (run.status !== "active") {
        return {
            success: false,
            reason: "DUNGEON_NOT_ACTIVE"
        };
    }

    const room = run.rooms.find(
        item => item.number === run.currentRoom
    );

    if (!room || room.status !== "active") {
        return {
            success: false,
            reason: "ROOM_NOT_ACTIVE"
        };
    }

    if (!victory) {
        run.status = "failed";

        run.updatedAt = Date.now();

        database[hunterId].activeRun = null;

        database[hunterId].dungeonHistory.push({
            runId: run.id,
            dungeonId: run.dungeonId,
            status: "failed",
            clearedRooms: [...run.clearedRooms],
            finishedAt: Date.now()
        });

        saveProgressDatabase(database);

        return {
            success: true,
            status: "failed",
            run: clone(run)
        };
    }

    room.status = "cleared";
    room.completedAt = Date.now();

    run.clearedRooms.push(room.number);

    run.pendingRewards.xp += room.rewards.xp;
    run.pendingRewards.gold += room.rewards.gold;

    run.updatedAt = Date.now();

    const isFinalRoom = (
        run.currentRoom >= run.totalRooms
    );

    if (isFinalRoom) {
        const dungeon = getDungeonById(
            run.dungeonId
        );

        run.status = "completed";
        run.completedAt = Date.now();

        run.pendingRewards.xp += safeNumber(
            dungeon?.rewards?.xp
        );

        run.pendingRewards.gold += safeNumber(
            dungeon?.rewards?.gold
        );

        const progress = database[hunterId];

        progress.completedDungeons.push({
            dungeonId: run.dungeonId,
            completedAt: run.completedAt,
            runId: run.id
        });

        progress.dungeonHistory.push({
            runId: run.id,
            dungeonId: run.dungeonId,
            status: "completed",
            clearedRooms: [...run.clearedRooms],
            rewards: clone(run.pendingRewards),
            finishedAt: run.completedAt
        });

        saveProgressDatabase(database);

        return {
            success: true,
            status: "completed",
            run: clone(run),
            rewards: clone(run.pendingRewards)
        };
    }

    saveProgressDatabase(database);

    return {
        success: true,
        status: "room_cleared",
        run: clone(run),
        nextRoom: run.currentRoom + 1
    };
}


/* =====================================
   ADVANCE TO NEXT ROOM
===================================== */

export function advanceDungeonRoom(hunter, hunterId) {
    const id = hunterId || getHunterIdentifier(hunter);

    const database = getProgressDatabase();

    const run = getActiveRun(
        database,
        id
    );

    if (!run) {
        return {
            success: false,
            reason: "NO_ACTIVE_DUNGEON"
        };
    }

    if (run.status !== "active") {
        return {
            success: false,
            reason: "DUNGEON_NOT_ACTIVE"
        };
    }

    const currentRoom = run.rooms.find(
        room => room.number === run.currentRoom
    );

    if (!currentRoom || currentRoom.status !== "cleared") {
        return {
            success: false,
            reason: "CURRENT_ROOM_NOT_CLEARED"
        };
    }

    const nextRoomNumber = run.currentRoom + 1;

    if (nextRoomNumber > run.totalRooms) {
        return {
            success: false,
            reason: "DUNGEON_ALREADY_FINISHED"
        };
    }

    const dungeon = getDungeonById(
        run.dungeonId
    );

    if (!dungeon) {
        return {
            success: false,
            reason: "DUNGEON_NOT_FOUND"
        };
    }

    const nextRoom = generateDungeonRoom(
        hunter,
        dungeon,
        nextRoomNumber
    );

    run.currentRoom = nextRoomNumber;

    run.rooms.push(nextRoom);

    run.updatedAt = Date.now();

    saveProgressDatabase(database);

    return {
        success: true,
        room: clone(nextRoom),
        run: clone(run)
    };
}


/* =====================================
   ABANDON DUNGEON
===================================== */

export function abandonDungeon(hunterId) {
    const database = getProgressDatabase();

    const run = getActiveRun(
        database,
        hunterId
    );

    if (!run) {
        return {
            success: false,
            reason: "NO_ACTIVE_DUNGEON"
        };
    }

    database[hunterId].activeRun = null;

    database[hunterId].dungeonHistory.push({
        runId: run.id,
        dungeonId: run.dungeonId,
        status: "abandoned",
        clearedRooms: [...run.clearedRooms],
        finishedAt: Date.now()
    });

    saveProgressDatabase(database);

    return {
        success: true,
        abandonedRun: clone(run)
    };
}


/* =====================================
   CLAIM DUNGEON REWARDS
===================================== */

export function claimDungeonRewards(hunterId) {
    const database = getProgressDatabase();

    const progress = database[hunterId];

    if (!progress?.activeRun) {
        return {
            success: false,
            reason: "NO_COMPLETED_DUNGEON"
        };
    }

    const run = progress.activeRun;

    if (run.status !== "completed") {
        return {
            success: false,
            reason: "DUNGEON_NOT_COMPLETED"
        };
    }

    if (run.rewardsClaimed) {
        return {
            success: false,
            reason: "REWARDS_ALREADY_CLAIMED"
        };
    }

    run.rewardsClaimed = true;

    const rewards = clone(run.pendingRewards);

    progress.activeRun = null;

    saveProgressDatabase(database);

    return {
        success: true,
        rewards
    };
}


/* =====================================
   DUNGEON STATISTICS
===================================== */

export function getDungeonStatistics(hunterId) {
    const progress = getDungeonProgress(hunterId);

    const history = progress.dungeonHistory || [];

    const completed = history.filter(
        run => run.status === "completed"
    ).length;

    const failed = history.filter(
        run => run.status === "failed"
    ).length;

    const abandoned = history.filter(
        run => run.status === "abandoned"
    ).length;

    return {
        completed,
        failed,
        abandoned,
        totalRuns: history.length,
        completedDungeons: clone(
            progress.completedDungeons || []
        ),
        activeRun: clone(progress.activeRun)
    };
}
