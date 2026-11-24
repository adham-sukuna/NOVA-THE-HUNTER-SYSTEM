import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

import {
    readData,
    writeData,
    getDataDirectory,
    getHunters,
    saveHunters
} from "./storage.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.resolve(
    __dirname,
    "../database/guilds.json"
);

const GUILDS_PATH = path.join(
    getDataDirectory(),
    "guild_profiles.json"
);


// ==========================================
// BASIC HELPERS
// ==========================================

function isObject(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}


function safeNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


function normalizeIdentity(value) {
    if (
        typeof value !== "string" ||
        !value.trim()
    ) {
        return null;
    }

    const clean = value
        .trim()
        .split(":")[0]
        .toLowerCase();

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
        : isObject(identity)
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


function normalizeGuildName(name) {
    if (typeof name !== "string") {
        return "";
    }

    return name
        .trim()
        .replace(/\s+/g, " ");
}


function getGuildNameKey(name) {
    return normalizeGuildName(name).toLowerCase();
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
        !isObject(config) ||
        !isObject(config.settings) ||
        !isObject(config.ranks) ||
        !isObject(config.experience)
    ) {
        throw new Error("INVALID_GUILD_CONFIG");
    }

    return config;
}


function getGuildDatabase() {
    const database = readData(
        GUILDS_PATH,
        {}
    );

    if (!isObject(database)) {
        throw new Error("INVALID_GUILD_DATABASE");
    }

    return database;
}


function saveGuildDatabase(database) {
    writeData(
        GUILDS_PATH,
        database
    );
}


// ==========================================
// HUNTER LOOKUP
// ==========================================

function getHunterRecord(identity) {
    const candidates = getIdentityCandidates(identity);

    if (!candidates.length) {
        return {
            success: false,
            reason: "INVALID_IDENTITY"
        };
    }

    const hunters = getHunters();

    if (!isObject(hunters)) {
        throw new Error("INVALID_HUNTERS_DATABASE");
    }

    const matches = new Map();

    for (const [key, hunter] of Object.entries(hunters)) {
        if (!isObject(hunter)) {
            continue;
        }

        const identities = [
            key,
            hunter.id,
            hunter.identities?.pn,
            hunter.identities?.lid
        ]
            .map(normalizeIdentity)
            .filter(Boolean);

        if (
            candidates.some(candidate =>
                identities.includes(candidate)
            )
        ) {
            matches.set(key, hunter);
        }
    }

    if (matches.size === 0) {
        return {
            success: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    if (matches.size > 1) {
        return {
            success: false,
            reason: "HUNTER_IDENTITY_CONFLICT"
        };
    }

    const [key, hunter] = [...matches.entries()][0];

    return {
        success: true,
        key,
        hunter,
        hunters,
        hunterId: hunter.id || key
    };
}


// ==========================================
// GUILD LOOKUP
// ==========================================

function getGuildByIdInternal(guildId, database) {
    if (
        typeof guildId !== "string" ||
        !guildId.trim()
    ) {
        return null;
    }

    return database[guildId] || null;
}


function findHunterGuild(hunterId, database) {
    for (const guild of Object.values(database)) {
        if (
            !isObject(guild) ||
            !isObject(guild.members)
        ) {
            continue;
        }

        if (guild.members[hunterId]) {
            return guild;
        }
    }

    return null;
}


function getMember(guild, hunterId) {
    if (
        !guild ||
        !isObject(guild.members)
    ) {
        return null;
    }

    return guild.members[hunterId] || null;
}


function hasPermission(guild, hunterId, permission, config) {
    const member = getMember(guild, hunterId);

    if (!member) {
        return false;
    }

    const rank = config.ranks[member.rank];

    if (!rank) {
        return false;
    }

    return rank.permissions.includes(permission);
}


// ==========================================
// VALIDATION
// ==========================================

function validateGuildName(name, config, database) {
    const cleanName = normalizeGuildName(name);

    if (!cleanName) {
        return {
            success: false,
            reason: "INVALID_GUILD_NAME"
        };
    }

    const settings = config.settings;

    if (
        cleanName.length < settings.minimumNameLength ||
        cleanName.length > settings.maximumNameLength
    ) {
        return {
            success: false,
            reason: "INVALID_GUILD_NAME_LENGTH",
            minimum: settings.minimumNameLength,
            maximum: settings.maximumNameLength
        };
    }

    if (!/^[\p{L}\p{N} _-]+$/u.test(cleanName)) {
        return {
            success: false,
            reason: "INVALID_GUILD_NAME_CHARACTERS"
        };
    }

    const nameKey = getGuildNameKey(cleanName);

    const exists = Object.values(database).some(
        guild =>
            getGuildNameKey(guild?.name) === nameKey
    );

    if (exists) {
        return {
            success: false,
            reason: "GUILD_NAME_TAKEN"
        };
    }

    return {
        success: true,
        name: cleanName
    };
}


function validateHunterLevel(hunter, minimumLevel) {
    const level = safeNumber(hunter?.level, 1);

    return level >= minimumLevel;
}


// ==========================================
// PUBLIC DATABASE APIs
// ==========================================

export function getGuildConfig() {
    return structuredClone(getConfig());
}


export function getGuilds() {
    const database = getGuildDatabase();

    return Object.values(database).map(guild =>
        structuredClone(guild)
    );
}


export function getGuild(guildId) {
    const database = getGuildDatabase();

    const guild = getGuildByIdInternal(
        guildId,
        database
    );

    return guild
        ? structuredClone(guild)
        : null;
}


export function getGuildByHunter(identity) {
    const record = getHunterRecord(identity);

    if (!record.success) {
        return null;
    }

    const database = getGuildDatabase();

    const guild = findHunterGuild(
        record.hunterId,
        database
    );

    return guild
        ? structuredClone(guild)
        : null;
}


export function getHunterGuildInfo(identity) {
    const record = getHunterRecord(identity);

    if (!record.success) {
        return {
            success: false,
            reason: record.reason
        };
    }

    const database = getGuildDatabase();

    const guild = findHunterGuild(
        record.hunterId,
        database
    );

    if (!guild) {
        return {
            success: true,
            inGuild: false
        };
    }

    return {
        success: true,
        inGuild: true,
        guild: structuredClone(guild),
        member: structuredClone(
            guild.members[record.hunterId]
        )
    };
}


export function getGuildMemberCount(guildId) {
    const guild = getGuild(guildId);

    if (!guild) {
        return 0;
    }

    return Object.keys(guild.members).length;
}


// ==========================================
// CREATE GUILD
// ==========================================

export function createGuild(identity, name, description = "") {
    const config = getConfig();

    if (config.settings.enabled !== true) {
        return {
            success: false,
            reason: "GUILD_SYSTEM_DISABLED"
        };
    }

    const record = getHunterRecord(identity);

    if (!record.success) {
        return record;
    }

    const database = getGuildDatabase();

    const existingGuild = findHunterGuild(
        record.hunterId,
        database
    );

    if (existingGuild) {
        return {
            success: false,
            reason: "ALREADY_IN_GUILD"
        };
    }

    if (
        !validateHunterLevel(
            record.hunter,
            config.settings.minimumLevel
        )
    ) {
        return {
            success: false,
            reason: "LEVEL_TOO_LOW",
            requiredLevel: config.settings.minimumLevel
        };
    }

    const nameValidation = validateGuildName(
        name,
        config,
        database
    );

    if (!nameValidation.success) {
        return nameValidation;
    }

    const cleanDescription = String(description || "").trim();

    if (cleanDescription.length > 300) {
        return {
            success: false,
            reason: "DESCRIPTION_TOO_LONG"
        };
    }

    const creationCost = Math.max(
        0,
        Math.floor(
            safeNumber(config.settings.creationCost)
        )
    );

    const currentGold = Math.max(
        0,
        Math.floor(safeNumber(record.hunter.gold))
    );

    if (currentGold < creationCost) {
        return {
            success: false,
            reason: "NOT_ENOUGH_GOLD",
            required: creationCost,
            available: currentGold
        };
    }

    const now = Date.now();

    const guildId = `guild_${randomUUID()}`;

    const guild = {
        id: guildId,
        name: nameValidation.name,
        description: cleanDescription,

        level: 1,
        experience: safeNumber(
            config.experience.creationExperience
        ),

        gold: 0,

        masterId: record.hunterId,

        members: {
            [record.hunterId]: {
                hunterId: record.hunterId,
                name: record.hunter.name || "Unknown Hunter",
                rank: "master",
                joinedAt: now,
                contribution: 0
            }
        },

        invitations: {},

        createdAt: now,
        updatedAt: now
    };

    const previousGold = currentGold;

    record.hunter.gold = currentGold - creationCost;
    record.hunter.lastActive = now;

    try {
        saveHunters(record.hunters);
    } catch (error) {
        record.hunter.gold = previousGold;

        return {
            success: false,
            reason: "GOLD_SAVE_FAILED"
        };
    }

    database[guildId] = guild;

    try {
        saveGuildDatabase(database);
    } catch (error) {
        record.hunter.gold = previousGold;

        try {
            saveHunters(record.hunters);
        } catch (rollbackError) {
            console.error(
                "[NOVA GUILD] Creation rollback failed:",
                rollbackError
            );
        }

        return {
            success: false,
            reason: "GUILD_SAVE_FAILED"
        };
    }

    return {
        success: true,
        guild: structuredClone(guild),
        creationCost,
        remainingGold: record.hunter.gold
    };
}


// ==========================================
// INVITE HUNTER
// ==========================================

export function inviteHunter(
    inviterIdentity,
    targetIdentity,
    guildId
) {
    const config = getConfig();

    const inviter = getHunterRecord(inviterIdentity);

    if (!inviter.success) {
        return inviter;
    }

    const target = getHunterRecord(targetIdentity);

    if (!target.success) {
        return target;
    }

    const database = getGuildDatabase();

    const guild = getGuildByIdInternal(
        guildId,
        database
    );

    if (!guild) {
        return {
            success: false,
            reason: "GUILD_NOT_FOUND"
        };
    }

    if (
        !hasPermission(
            guild,
            inviter.hunterId,
            "invite",
            config
        )
    ) {
        return {
            success: false,
            reason: "NO_PERMISSION"
        };
    }

    if (findHunterGuild(target.hunterId, database)) {
        return {
            success: false,
            reason: "TARGET_ALREADY_IN_GUILD"
        };
    }

    if (guild.members[target.hunterId]) {
        return {
            success: false,
            reason: "ALREADY_MEMBER"
        };
    }

    const maxMembers = Math.max(
        1,
        Math.floor(safeNumber(config.settings.maximumMembers, 20))
    );

    if (Object.keys(guild.members).length >= maxMembers) {
        return {
            success: false,
            reason: "GUILD_FULL"
        };
    }

    const now = Date.now();

    const duration = Math.max(
        60000,
        safeNumber(config.settings.invitationDuration, 86400000)
    );

    guild.invitations ||= {};

    guild.invitations[target.hunterId] = {
        hunterId: target.hunterId,
        hunterName: target.hunter.name || "Unknown Hunter",
        invitedBy: inviter.hunterId,
        invitedAt: now,
        expiresAt: now + duration
    };

    guild.updatedAt = now;

    saveGuildDatabase(database);

    return {
        success: true,
        guildId,
        guildName: guild.name,
        targetHunterId: target.hunterId,
        expiresAt: now + duration
    };
}


// ==========================================
// ACCEPT INVITATION
// ==========================================

export function acceptGuildInvitation(identity, guildId) {
    const config = getConfig();

    const record = getHunterRecord(identity);

    if (!record.success) {
        return record;
    }

    const database = getGuildDatabase();

    if (
        findHunterGuild(
            record.hunterId,
            database
        )
    ) {
        return {
            success: false,
            reason: "ALREADY_IN_GUILD"
        };
    }

    const guild = getGuildByIdInternal(
        guildId,
        database
    );

    if (!guild) {
        return {
            success: false,
            reason: "GUILD_NOT_FOUND"
        };
    }

    const invitation = guild.invitations?.[record.hunterId];

    if (!invitation) {
        return {
            success: false,
            reason: "INVITATION_NOT_FOUND"
        };
    }

    if (Date.now() > invitation.expiresAt) {
        delete guild.invitations[record.hunterId];

        guild.updatedAt = Date.now();

        saveGuildDatabase(database);

        return {
            success: false,
            reason: "INVITATION_EXPIRED"
        };
    }

    const maxMembers = Math.max(
        1,
        Math.floor(safeNumber(config.settings.maximumMembers, 20))
    );

    if (Object.keys(guild.members).length >= maxMembers) {
        return {
            success: false,
            reason: "GUILD_FULL"
        };
    }

    const now = Date.now();

    guild.members[record.hunterId] = {
        hunterId: record.hunterId,
        name: record.hunter.name || "Unknown Hunter",
        rank: "member",
        joinedAt: now,
        contribution: 0
    };

    delete guild.invitations[record.hunterId];

    guild.updatedAt = now;

    saveGuildDatabase(database);

    return {
        success: true,
        guildId,
        guildName: guild.name,
        member: structuredClone(
            guild.members[record.hunterId]
        )
    };
}


// ==========================================
// DECLINE INVITATION
// ==========================================

export function declineGuildInvitation(identity, guildId) {
    const record = getHunterRecord(identity);

    if (!record.success) {
        return record;
    }

    const database = getGuildDatabase();

    const guild = getGuildByIdInternal(
        guildId,
        database
    );

    if (!guild) {
        return {
            success: false,
            reason: "GUILD_NOT_FOUND"
        };
    }

    if (!guild.invitations?.[record.hunterId]) {
        return {
            success: false,
            reason: "INVITATION_NOT_FOUND"
        };
    }

    delete guild.invitations[record.hunterId];

    guild.updatedAt = Date.now();

    saveGuildDatabase(database);

    return {
        success: true
    };
}


// ==========================================
// LEAVE GUILD
// ==========================================

export function leaveGuild(identity) {
    const record = getHunterRecord(identity);

    if (!record.success) {
        return record;
    }

    const database = getGuildDatabase();

    const guild = findHunterGuild(
        record.hunterId,
        database
    );

    if (!guild) {
        return {
            success: false,
            reason: "NOT_IN_GUILD"
        };
    }

    if (guild.masterId === record.hunterId) {
        return {
            success: false,
            reason: "MASTER_CANNOT_LEAVE"
        };
    }

    delete guild.members[record.hunterId];

    guild.updatedAt = Date.now();

    saveGuildDatabase(database);

    return {
        success: true,
        guildId: guild.id,
        guildName: guild.name
    };
}


// ==========================================
// KICK MEMBER
// ==========================================

export function kickGuildMember(
    actorIdentity,
    targetHunterId,
    guildId
) {
    const config = getConfig();

    const actor = getHunterRecord(actorIdentity);

    if (!actor.success) {
        return actor;
    }

    const database = getGuildDatabase();

    const guild = getGuildByIdInternal(
        guildId,
        database
    );

    if (!guild) {
        return {
            success: false,
            reason: "GUILD_NOT_FOUND"
        };
    }

    if (
        !hasPermission(
            guild,
            actor.hunterId,
            "kick",
            config
        )
    ) {
        return {
            success: false,
            reason: "NO_PERMISSION"
        };
    }

    const actorMember = getMember(
        guild,
        actor.hunterId
    );

    const targetMember = getMember(
        guild,
        targetHunterId
    );

    if (!targetMember) {
        return {
            success: false,
            reason: "TARGET_NOT_MEMBER"
        };
    }

    if (targetMember.rank === "master") {
        return {
            success: false,
            reason: "CANNOT_KICK_MASTER"
        };
    }

    const actorRank = config.ranks[actorMember.rank];
    const targetRank = config.ranks[targetMember.rank];

    if (
        !actorRank ||
        !targetRank ||
        actorRank.priority <= targetRank.priority
    ) {
        return {
            success: false,
            reason: "TARGET_RANK_TOO_HIGH"
        };
    }

    delete guild.members[targetHunterId];

    guild.updatedAt = Date.now();

    saveGuildDatabase(database);

    return {
        success: true,
        targetHunterId,
        targetName: targetMember.name
    };
}


// ==========================================
// CHANGE MEMBER RANK
// ==========================================

export function setGuildMemberRank(
    actorIdentity,
    targetHunterId,
    newRank,
    guildId
) {
    const config = getConfig();

    const actor = getHunterRecord(actorIdentity);

    if (!actor.success) {
        return actor;
    }

    if (
        !Object.hasOwn(config.ranks, newRank) ||
        newRank === "master"
    ) {
        return {
            success: false,
            reason: "INVALID_RANK"
        };
    }

    const database = getGuildDatabase();

    const guild = getGuildByIdInternal(
        guildId,
        database
    );

    if (!guild) {
        return {
            success: false,
            reason: "GUILD_NOT_FOUND"
        };
    }

    if (
        !hasPermission(
            guild,
            actor.hunterId,
            "manage_ranks",
            config
        )
    ) {
        return {
            success: false,
            reason: "NO_PERMISSION"
        };
    }

    const target = getMember(
        guild,
        targetHunterId
    );

    if (!target) {
        return {
            success: false,
            reason: "TARGET_NOT_MEMBER"
        };
    }

    const officerRanks = [
        "vice",
        "officer"
    ];

    if (
        officerRanks.includes(newRank) &&
        target.rank !== newRank
    ) {
        const officers = Object.values(guild.members)
            .filter(member =>
                officerRanks.includes(member.rank)
            )
            .length;

        if (
            officers >= config.settings.maximumOfficers
        ) {
            return {
                success: false,
                reason: "OFFICER_LIMIT_REACHED"
            };
        }
    }

    const previousRank = target.rank;

    target.rank = newRank;

    guild.updatedAt = Date.now();

    saveGuildDatabase(database);

    return {
        success: true,
        targetHunterId,
        previousRank,
        newRank
    };
}


// ==========================================
// TRANSFER LEADERSHIP
// ==========================================

export function transferGuildLeadership(
    masterIdentity,
    targetHunterId,
    guildId
) {
    const config = getConfig();

    const master = getHunterRecord(masterIdentity);

    if (!master.success) {
        return master;
    }

    const database = getGuildDatabase();

    const guild = getGuildByIdInternal(
        guildId,
        database
    );

    if (!guild) {
        return {
            success: false,
            reason: "GUILD_NOT_FOUND"
        };
    }

    if (
        !hasPermission(
            guild,
            master.hunterId,
            "transfer_leadership",
            config
        )
    ) {
        return {
            success: false,
            reason: "NO_PERMISSION"
        };
    }

    const target = getMember(
        guild,
        targetHunterId
    );

    if (!target) {
        return {
            success: false,
            reason: "TARGET_NOT_MEMBER"
        };
    }

    const oldMasterId = guild.masterId;

    const oldMaster = getMember(
        guild,
        oldMasterId
    );

    oldMaster.rank = "vice";
    target.rank = "master";

    guild.masterId = targetHunterId;

    guild.updatedAt = Date.now();

    saveGuildDatabase(database);

    return {
        success: true,
        oldMasterId,
        newMasterId: targetHunterId
    };
}


// ==========================================
// UPDATE DESCRIPTION
// ==========================================

export function updateGuildDescription(
    identity,
    guildId,
    description
) {
    const config = getConfig();

    const record = getHunterRecord(identity);

    if (!record.success) {
        return record;
    }

    const cleanDescription = String(
        description || ""
    ).trim();

    if (cleanDescription.length > 300) {
        return {
            success: false,
            reason: "DESCRIPTION_TOO_LONG"
        };
    }

    const database = getGuildDatabase();

    const guild = getGuildByIdInternal(
        guildId,
        database
    );

    if (!guild) {
        return {
            success: false,
            reason: "GUILD_NOT_FOUND"
        };
    }

    if (
        !hasPermission(
            guild,
            record.hunterId,
            "manage_description",
            config
        )
    ) {
        return {
            success: false,
            reason: "NO_PERMISSION"
        };
    }

    guild.description = cleanDescription;
    guild.updatedAt = Date.now();

    saveGuildDatabase(database);

    return {
        success: true,
        description: cleanDescription
    };
}


// ==========================================
// DISBAND GUILD
// ==========================================

export function disbandGuild(identity, guildId) {
    const config = getConfig();

    const record = getHunterRecord(identity);

    if (!record.success) {
        return record;
    }

    const database = getGuildDatabase();

    const guild = getGuildByIdInternal(
        guildId,
        database
    );

    if (!guild) {
        return {
            success: false,
            reason: "GUILD_NOT_FOUND"
        };
    }

    if (
        !hasPermission(
            guild,
            record.hunterId,
            "disband",
            config
        )
    ) {
        return {
            success: false,
            reason: "NO_PERMISSION"
        };
    }

    const guildName = guild.name;

    delete database[guildId];

    saveGuildDatabase(database);

    return {
        success: true,
        guildId,
        guildName
    };
}


// ==========================================
// GUILD STATISTICS
// ==========================================

export function getGuildStatistics(guildId) {
    const guild = getGuild(guildId);

    if (!guild) {
        return null;
    }

    const members = Object.values(guild.members);

    const ranks = {};

    for (const member of members) {
        ranks[member.rank] =
            (ranks[member.rank] || 0) + 1;
    }

    return {
        id: guild.id,
        name: guild.name,
        level: guild.level,
        experience: guild.experience,
        gold: guild.gold,
        memberCount: members.length,
        maximumMembers: getConfig().settings.maximumMembers,
        ranks,
        createdAt: guild.createdAt
    };
}
