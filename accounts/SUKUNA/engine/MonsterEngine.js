import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getEffectiveStats } from "./StatEngine.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONSTER_DATABASE = path.resolve(
    __dirname,
    "../database/monsters.json"
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


const STAT_NAMES = [
    "STR",
    "AGI",
    "INT",
    "VIT",
    "LUK"
];


const DEFAULT_STATS = {
    STR: 10,
    AGI: 10,
    INT: 10,
    VIT: 10,
    LUK: 5
};


function random(min, max) {
    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}


function round(value) {
    return Math.max(1, Math.floor(value));
}


function loadMonsterDatabase() {
    if (!fs.existsSync(MONSTER_DATABASE)) {
        throw new Error(
            "NOVA MONSTER ENGINE: monsters.json not found."
        );
    }

    try {
        const data = JSON.parse(
            fs.readFileSync(MONSTER_DATABASE, "utf8")
        );

        if (!Array.isArray(data.monsters)) {
            throw new Error(
                "Invalid monsters database structure."
            );
        }

        return data.monsters;

    } catch (error) {
        throw new Error(
            `NOVA MONSTER ENGINE: ${error.message}`
        );
    }
}


function getHunterLevel(hunter) {
    return Math.max(
        1,
        Number(hunter?.level) || 1
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
    return Math.max(
        0,
        RANK_ORDER.indexOf(rank)
    );
}


function getHunterStats(hunter) {
    let stats = {};

    try {
        stats = getEffectiveStats(hunter) || {};
    } catch {
        stats = hunter?.stats || {};
    }

    const result = {};

    for (const stat of STAT_NAMES) {
        result[stat] = Math.max(
            1,
            Number(
                stats?.[stat] ??
                DEFAULT_STATS[stat]
            ) || 1
        );
    }

    return result;
}


function calculateMonsterRank(hunterRank, difficulty) {
    const hunterIndex = getRankIndex(hunterRank);

    let offset = 0;

    if (difficulty >= 1.4) {
        offset = 1;
    } else if (difficulty <= 0.8) {
        offset = -1;
    }

    const rankIndex = Math.max(
        0,
        Math.min(
            RANK_ORDER.length - 1,
            hunterIndex + offset
        )
    );

    return RANK_ORDER[rankIndex];
}


function calculateMonsterStats(
    hunterStats,
    template,
    difficulty,
    level,
    hunterLevel
) {
    const multiplier = template.statsMultiplier || {};

    const levelDifference = Math.max(
        0,
        level - hunterLevel
    );

    const levelBonus = 1 + (
        levelDifference * 0.025
    );

    const stats = {};

    for (const stat of STAT_NAMES) {
        const base = hunterStats[stat];

        const statMultiplier = Number(
            multiplier[stat.toLowerCase()] ?? 0.75
        );

        stats[stat] = round(
            base *
            statMultiplier *
            difficulty *
            levelBonus
        );
    }

    return stats;
}


function calculateMonsterDerivedStats(stats) {
    const maxHP = round(
        100 + stats.VIT * 20
    );

    const maxMP = round(
        50 + stats.INT * 15
    );

    const physicalDamage = round(
        stats.STR * 2.5
    );

    const magicDamage = round(
        stats.INT * 3
    );

    const defense = round(
        stats.VIT * 1.5
    );

    const criticalRate = Math.min(
        75,
        5 + stats.LUK * 0.5
    );

    const criticalDamage = 150 + stats.LUK;

    const speed = round(
        stats.AGI * 1.5
    );

    const accuracy = round(
        80 + stats.AGI * 0.5
    );

    const evasion = Math.min(
        50,
        stats.AGI * 0.3
    );

    return {
        maxHP,
        maxMP,
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


function calculateRewards(
    level,
    difficulty,
    rewardMultiplier,
    isBoss
) {
    const bossMultiplier = isBoss ? 3 : 1;

    const multiplier =
        difficulty *
        rewardMultiplier *
        bossMultiplier;

    const xp = round(
        (20 + level * 12) * multiplier
    );

    const gold = round(
        (10 + level * 5) * multiplier
    );

    return {
        xp,
        gold
    };
}


function createMonsterId(templateId) {
    return `${templateId}_${Date.now()}_${random(1000, 9999)}`;
}


function buildMonster(hunter, template, options = {}) {
    if (!hunter) {
        throw new Error("HUNTER_REQUIRED");
    }

    if (!template) {
        throw new Error("MONSTER_TEMPLATE_REQUIRED");
    }

    const hunterLevel = getHunterLevel(hunter);
    const hunterRank = getHunterRank(hunter);
    const hunterStats = getHunterStats(hunter);

    const isBoss = options.isBoss === true;

    const difficulty = Math.max(
        0.1,
        Number(
            options.difficulty ??
            template.difficulty ??
            1
        ) || 1
    );

    const level = Math.max(
        1,
        Math.floor(
            Number(
                options.level ??
                hunterLevel + random(-1, 1)
            ) || hunterLevel
        )
    );

    const bossMultiplier = isBoss ? 1.35 : 1;

    const finalDifficulty = difficulty * bossMultiplier;

    const stats = calculateMonsterStats(
        hunterStats,
        template,
        finalDifficulty,
        level,
        hunterLevel
    );

    const derivedStats = calculateMonsterDerivedStats(stats);

    const rewards = calculateRewards(
        level,
        finalDifficulty,
        Number(template.rewardMultiplier) || 1,
        isBoss
    );

    return {
        id: createMonsterId(template.id),

        templateId: template.id,

        name: template.name,
        nameAr: template.nameAr,

        description: template.description,

        type: template.type,
        rarity: template.rarity,

        level,

        rank: calculateMonsterRank(
            hunterRank,
            finalDifficulty
        ),

        isBoss,

        stats,

        derivedStats,

        maxHP: derivedStats.maxHP,
        hp: derivedStats.maxHP,
        currentHP: derivedStats.maxHP,

        maxMP: derivedStats.maxMP,
        mp: derivedStats.maxMP,
        currentMP: derivedStats.maxMP,

        physicalDamage: derivedStats.physicalDamage,
        magicDamage: derivedStats.magicDamage,
        defense: derivedStats.defense,

        criticalRate: derivedStats.criticalRate,
        criticalDamage: derivedStats.criticalDamage,

        speed: derivedStats.speed,
        accuracy: derivedStats.accuracy,
        evasion: derivedStats.evasion,

        rewards,

        loot: Array.isArray(template.loot)
            ? [...template.loot]
            : [],

        statusEffects: [],
        cooldowns: {},
        activeEffects: [],

        createdAt: Date.now()
    };
}


/* =================================
   DATABASE FUNCTIONS
================================= */

export function getMonsterTemplates() {
    return loadMonsterDatabase();
}


export function getMonsterTemplate(monsterId) {
    return loadMonsterDatabase().find(
        monster => monster.id === monsterId
    ) || null;
}


/* =================================
   MONSTER FILTERING
================================= */

/*
    يقبل:
    - monster ID مثل goblin
    - monster type مثل beast
    - أكثر من ID أو type
*/

function getAvailableMonsterTemplates(
    monsters,
    options = {}
) {
    const ids = Array.isArray(options.monsterIds)
        ? options.monsterIds
        : [];

    const selector = options.type || null;

    const available = monsters.filter(monster => {
        if (options.monsterId) {
            return monster.id === options.monsterId;
        }

        if (ids.length) {
            return ids.includes(monster.id);
        }

        if (selector) {
            return (
                monster.id === selector ||
                monster.type === selector
            );
        }

        if (
            options.rarity &&
            monster.rarity !== options.rarity
        ) {
            return false;
        }

        return true;
    });

    return available;
}


/* =================================
   MONSTER GENERATION
================================= */

export function generateMonster(hunter, options = {}) {
    const monsters = loadMonsterDatabase();

    let template;

    if (options.monsterId) {
        template = monsters.find(
            monster => monster.id === options.monsterId
        );

        if (!template) {
            throw new Error("MONSTER_NOT_FOUND");
        }

    } else {
        const available = getAvailableMonsterTemplates(
            monsters,
            options
        );

        if (!available.length) {
            throw new Error("NO_AVAILABLE_MONSTERS");
        }

        template = available[
            random(0, available.length - 1)
        ];
    }

    return buildMonster(
        hunter,
        template,
        options
    );
}


/* =================================
   MONSTER PACK GENERATION
================================= */

export function generateMonsterPack(hunter, options = {}) {
    const count = Math.max(
        1,
        Math.min(
            10,
            Math.floor(Number(options.count) || 3)
        )
    );

    const monsters = [];

    for (let i = 0; i < count; i++) {
        monsters.push(
            generateMonster(hunter, {
                difficulty: options.difficulty ?? 1,
                level: options.level,
                type: options.type,
                rarity: options.rarity,
                monsterIds: options.monsterIds,
                monsterId: options.monsterId
            })
        );
    }

    return monsters;
}


/* =================================
   BOSS GENERATION
================================= */

export function generateBoss(hunter, options = {}) {
    const monsters = loadMonsterDatabase();

    let template;

    if (options.monsterId) {
        template = monsters.find(
            monster => monster.id === options.monsterId
        );

    } else if (options.type) {
        const available = monsters.filter(
            monster => (
                monster.id === options.type ||
                monster.type === options.type
            )
        );

        if (available.length) {
            template = available[
                random(0, available.length - 1)
            ];
        }

    } else {
        template = monsters[
            monsters.length - 1
        ];
    }

    if (!template) {
        throw new Error("BOSS_TEMPLATE_NOT_FOUND");
    }

    return buildMonster(hunter, template, {
        ...options,
        isBoss: true,
        difficulty: options.difficulty ?? 1.25
    });
}


/* =================================
   REWARD HELPERS
================================= */

export function getMonsterRewards(monster) {
    if (!monster) {
        return {
            xp: 0,
            gold: 0
        };
    }

    return {
        xp: Math.max(
            0,
            Number(monster.rewards?.xp) || 0
        ),

        gold: Math.max(
            0,
            Number(monster.rewards?.gold) || 0
        )
    };
}


/* =================================
   MONSTER INFORMATION
================================= */

export function getMonsterInfo(monster) {
    if (!monster) return null;

    return {
        id: monster.id,
        templateId: monster.templateId,

        name: monster.name,
        nameAr: monster.nameAr,

        level: monster.level,
        rank: monster.rank,

        type: monster.type,
        rarity: monster.rarity,

        isBoss: monster.isBoss,

        hp: monster.hp,
        maxHP: monster.maxHP,

        mp: monster.mp,
        maxMP: monster.maxMP,

        stats: { ...monster.stats },

        rewards: { ...monster.rewards }
    };
}
