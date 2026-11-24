import {
    resolveHunterIdentity,
    addXP
} from "../../nova/engine/PlayerEngine.js";

import {
    getHunters,
    saveHunters
} from "../../nova/engine/storage.js";

import {
    getAvailableDungeons,
    getDungeon,
    startDungeon,
    getDungeonProgress,
    getActiveDungeon,
    getCurrentDungeonRoom,
    completeDungeonRoom,
    advanceDungeonRoom,
    abandonDungeon,
    claimDungeonRewards
} from "../../nova/engine/DungeonEngine.js";

import {
    createBattle,
    performBasicAttack,
    useHunterSkill,
    performEnemyAttack,
    advanceBattleTurn,
    restoreMana,
    getBattleStatus
} from "../../nova/engine/CombatEngine.js";

import {
    getSkill
} from "../../nova/engine/SkillEngine.js";


export const NovaUltra = {
    command: "مغارات",
    description: "استكشاف المغارات وقتال الوحوش والزعماء",
    usage: ".مغارات",
    elite: "off",
    group: true,
    prv: false,
    lock: "off",
    category: "NOVA"
};


const activeSessions = new Map();

const SESSION_TIMEOUT = 10 * 60 * 1000;

const MAX_BATTLE_LOGS = 5;


// ==========================================
// GENERAL HELPERS
// ==========================================

function safeNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


function normalizeText(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}


function normalizeIdentity(value) {
    if (!value) return null;

    const id = String(value).trim();

    if (!id) return null;

    if (
        id.endsWith("@s.whatsapp.net") ||
        id.endsWith("@lid")
    ) {
        return id;
    }

    return `${id}@s.whatsapp.net`;
}


function getMessageText(msg) {
    const message = msg?.message;

    if (!message) return "";

    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        message.buttonsResponseMessage?.selectedButtonId ||
        message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        message.templateButtonReplyMessage?.selectedId ||
        ""
    ).trim();
}


function getMessageIdentity(msg) {
    try {
        return resolveHunterIdentity({
            msg
        });
    } catch {
        return null;
    }
}


function getSessionKey(chat, hunterId) {
    return `${chat}:${hunterId}`;
}


function getHunterName(hunter) {
    return (
        hunter?.name ||
        hunter?.username ||
        "الصياد"
    );
}


function getMonsterName(monster) {
    return (
        monster?.nameAr ||
        monster?.name ||
        "وحش مجهول"
    );
}


function getDungeonName(dungeon) {
    return (
        dungeon?.nameAr ||
        dungeon?.name ||
        "مغارة مجهولة"
    );
}


function formatNumber(value) {
    return safeNumber(value).toLocaleString("en-US");
}


function formatHP(current, maximum) {
    return `${formatNumber(current)} / ${formatNumber(maximum)}`;
}


function getRankEmoji(rank) {
    const ranks = {
        E: "🟢",
        D: "🔵",
        C: "🟣",
        B: "🟠",
        A: "🔴",
        S: "⭐",
        SS: "🌟",
        SSS: "💠",
        NATIONAL: "👑"
    };

    return ranks[rank] || "⚪";
}


// ==========================================
// HUNTER HELPERS
// ==========================================

function getHunterEntry(identity) {
    if (!identity) return null;

    const hunters = getHunters();

    const pn = normalizeIdentity(identity.pn);
    const lid = normalizeIdentity(identity.lid);
    const primary = normalizeIdentity(identity.primary);

    const matches = [];

    for (const [key, hunter] of Object.entries(hunters)) {
        if (!hunter || typeof hunter !== "object") {
            continue;
        }

        const identities = hunter.identities || {};

        const candidates = [
            key,
            hunter.id,
            identities.pn,
            identities.lid
        ]
            .map(normalizeIdentity)
            .filter(Boolean);

        const matched = candidates.some(candidate => {
            return (
                candidate === pn ||
                candidate === lid ||
                candidate === primary
            );
        });

        if (matched) {
            matches.push({
                key,
                hunter
            });
        }
    }

    // لا نختار شخصية عند وجود أكثر من تطابق.

    if (matches.length !== 1) {
        return null;
    }

    return matches[0];
}


function findHunterRecord(hunterId) {
    const hunters = getHunters();

    if (
        hunters[hunterId] &&
        typeof hunters[hunterId] === "object"
    ) {
        return {
            hunters,
            key: hunterId,
            hunter: hunters[hunterId]
        };
    }

    for (const [key, hunter] of Object.entries(hunters)) {
        if (!hunter || typeof hunter !== "object") {
            continue;
        }

        if (hunter.id === hunterId) {
            return {
                hunters,
                key,
                hunter
            };
        }
    }

    return null;
}


function saveHunterVitals(hunterId, hp, mp) {
    const record = findHunterRecord(hunterId);

    if (!record) {
        return false;
    }

    record.hunter.hp = Math.max(
        0,
        safeNumber(hp)
    );

    record.hunter.mp = Math.max(
        0,
        safeNumber(mp)
    );

    record.hunter.lastActive = Date.now();

    saveHunters(record.hunters);

    return true;
}


function addHunterGold(hunterId, amount) {
    const record = findHunterRecord(hunterId);

    if (!record) {
        return false;
    }

    const gold = Math.max(
        0,
        safeNumber(amount)
    );

    record.hunter.gold = Math.max(
        0,
        safeNumber(record.hunter.gold)
    ) + gold;

    record.hunter.lastActive = Date.now();

    saveHunters(record.hunters);

    return true;
}


function getHunter(identity) {
    const entry = getHunterEntry(identity);

    return entry?.hunter || null;
}


// ==========================================
// MONSTER ADAPTER
// ==========================================

function adaptMonster(monster) {
    const derived = monster.derivedStats || {};

    return {
        ...monster,

        // CombatEngine يستخدم maxHp و maxMp.

        maxHp: safeNumber(
            monster.maxHP,
            safeNumber(derived.maxHP, 100)
        ),

        maxMp: safeNumber(
            monster.maxMP,
            safeNumber(derived.maxMP, 0)
        ),

        hp: safeNumber(
            monster.hp,
            safeNumber(monster.maxHP, 100)
        ),

        mp: safeNumber(
            monster.mp,
            safeNumber(monster.maxMP, 0)
        ),

        // CombatEngine ينتظر derived وليس derivedStats.

        derived: {
            maxHp: safeNumber(
                derived.maxHP,
                safeNumber(monster.maxHP, 100)
            ),

            maxMp: safeNumber(
                derived.maxMP,
                safeNumber(monster.maxMP, 0)
            ),

            physicalDamage: safeNumber(
                derived.physicalDamage,
                monster.physicalDamage
            ),

            magicDamage: safeNumber(
                derived.magicDamage,
                monster.magicDamage
            ),

            defense: safeNumber(
                derived.defense,
                monster.defense
            ),

            criticalRate: safeNumber(
                derived.criticalRate,
                monster.criticalRate
            ),

            criticalDamage: safeNumber(
                derived.criticalDamage,
                safeNumber(monster.criticalDamage, 150)
            ),

            speed: safeNumber(
                derived.speed,
                monster.speed
            ),

            accuracy: safeNumber(
                derived.accuracy,
                monster.accuracy
            ),

            evasion: safeNumber(
                derived.evasion,
                monster.evasion
            )
        }
    };
}


// ==========================================
// MESSAGE HELPERS
// ==========================================

async function sendText(sock, chat, text, quoted = null) {
    try {
        await sock.sendMessage(
            chat,
            {
                text
            },
            quoted
                ? { quoted }
                : {}
        );
    } catch (error) {
        console.error(
            "[NOVA DUNGEON] Send error:",
            error
        );
    }
}


function cleanupSession(sessionKey) {
    const session = activeSessions.get(sessionKey);

    if (!session) return;

    if (session.timeout) {
        clearTimeout(session.timeout);
    }

    if (session.listener && session.sock?.ev) {
        session.sock.ev.off(
            "messages.upsert",
            session.listener
        );
    }

    activeSessions.delete(sessionKey);
}


function refreshSessionTimeout(sessionKey) {
    const session = activeSessions.get(sessionKey);

    if (!session) return;

    if (session.timeout) {
        clearTimeout(session.timeout);
    }

    session.timeout = setTimeout(() => {
        sendText(
            session.sock,
            session.chat,
            "⌛ انتهت جلسة المغارة بسبب عدم التفاعل.\nاستخدم .مغارات للعودة ومتابعة تقدمك."
        );

        cleanupSession(sessionKey);

    }, SESSION_TIMEOUT);

    session.timeout.unref?.();
}


// ==========================================
// DUNGEON DISPLAY
// ==========================================

function buildDungeonList(hunter, dungeons) {
    if (!dungeons.length) {
        return [
            "╭━━〔 🏰 NOVA DUNGEONS 〕━━╮",
            "",
            "❌ لا توجد مغارات متاحة لمستواك ورتبتك حاليًا.",
            "",
            "╰━━━━━━━━━━━━━━━━━━╯"
        ].join("\n");
    }

    const lines = [
        "╭━━〔 🏰 NOVA DUNGEONS 〕━━╮",
        "",
        `👤 الصياد: ${getHunterName(hunter)}`,
        `⭐ المستوى: ${hunter.level || 1}`,
        `🏅 الرتبة: ${hunter.rank || hunter.hunterRank || "E"}`,
        "",
        "اختر المغارة برقمها:",
        ""
    ];

    dungeons.forEach((dungeon, index) => {
        lines.push(
            `${index + 1}. ${getDungeonName(dungeon)}`
        );

        lines.push(
            `   ${getRankEmoji(dungeon.rank)} الرتبة: ${dungeon.rank || "E"} | المستوى: ${dungeon.minLevel || 1}+`
        );

        lines.push(
            `   🚪 الغرف: ${dungeon.rooms}`
        );

        lines.push("");
    });

    lines.push("╰━━━━━━━━━━━━━━━━━━╯");

    return lines.join("\n");
}


function buildDungeonDetails(dungeon) {
    return [
        "╭━━〔 🏰 DUNGEON INFO 〕━━╮",
        "",
        `📍 ${getDungeonName(dungeon)}`,
        `📝 ${dungeon.description || "لا يوجد وصف."}`,
        "",
        `🏅 الرتبة: ${dungeon.rank}`,
        `⭐ المستوى المطلوب: ${dungeon.minLevel}`,
        `🚪 عدد الغرف: ${dungeon.rooms}`,
        "",
        `👑 الزعيم: ${dungeon.bossMonsterId}`,
        `🎁 مكافأة الإكمال:`,
        `   XP: ${formatNumber(dungeon.rewards?.xp)}`,
        `   Gold: ${formatNumber(dungeon.rewards?.gold)}`,
        "",
        "1 - دخول المغارة",
        "2 - العودة للقائمة",
        "",
        "╰━━━━━━━━━━━━━━━━━━╯"
    ].join("\n");
}


// ==========================================
// ROOM DISPLAY
// ==========================================

function buildRoomMessage(run, room) {
    const lines = [
        "╭━━〔 ⚔️ DUNGEON ROOM 〕━━╮",
        "",
        `🏰 ${run.dungeonNameAr || run.dungeonName}`,
        `🚪 الغرفة: ${room.number} / ${run.totalRooms}`,
        ""
    ];

    if (room.type === "boss") {
        lines.push("👑 غرفة الزعيم");
        lines.push("");
    } else {
        lines.push("⚔️ غرفة وحوش");
        lines.push("");
    }

    lines.push(
        `👹 عدد الأعداء: ${room.enemies.length}`
    );

    lines.push("");

    room.enemies.forEach((enemy, index) => {
        const name = getMonsterName(enemy);

        lines.push(
            `${index + 1}. ${name} - Lv.${enemy.level}`
        );
    });

    lines.push("");
    lines.push("استعد للقتال...");
    lines.push("╰━━━━━━━━━━━━━━━━━━╯");

    return lines.join("\n");
}


// ==========================================
// BATTLE DISPLAY
// ==========================================

function buildBattleMessage(battle, monster, index, total) {
    const status = getBattleStatus(battle);

    return [
        "╭━━〔 ⚔️ NOVA COMBAT 〕━━╮",
        "",
        `👹 ${monster.nameAr || monster.name}`,
        `⭐ المستوى: ${monster.level}`,
        `🏅 الرتبة: ${monster.rank}`,
        "",
        `❤️ HP الوحش: ${formatHP(status.enemy.hp, status.enemy.maxHp)}`,
        `💙 MP الوحش: ${formatHP(status.enemy.mp, status.enemy.maxMp)}`,
        "",
        `❤️ HP الصياد: ${formatHP(status.hunter.hp, status.hunter.maxHp)}`,
        `💙 MP الصياد: ${formatHP(status.hunter.mp, status.hunter.maxMp)}`,
        "",
        `👹 الوحش ${index + 1} من ${total}`,
        "",
        "اختر حركتك:",
        "",
        "1 - ⚔️ هجوم عادي",
        "2 - ✨ استخدام مهارة",
        "3 - 💙 استعادة 10 مانا",
        "4 - 🚪 الانسحاب من المغارة",
        "",
        "╰━━━━━━━━━━━━━━━━━━╯"
    ].join("\n");
}


function buildSkillList(hunter) {
    const skills = [];

    for (const skillId of hunter.skills || []) {
        const skill = getSkill(skillId);

        if (!skill || skill.type !== "active") {
            continue;
        }

        skills.push(skill);
    }

    return skills;
}


function buildSkillMessage(hunter) {
    const skills = buildSkillList(hunter);

    if (!skills.length) {
        return {
            skills,
            text: "❌ لا تمتلك أي مهارات هجومية أو دفاعية نشطة."
        };
    }

    const lines = [
        "╭━━〔 ✨ HUNTER SKILLS 〕━━╮",
        ""
    ];

    skills.forEach((skill, index) => {
        lines.push(
            `${index + 1}. ${skill.nameAr || skill.name}`
        );

        lines.push(
            `   💙 MP: ${skill.mpCost || 0}`
        );

        lines.push(
            `   ⏳ Cooldown: ${skill.cooldown || 0}`
        );

        lines.push("");
    });

    lines.push("أرسل رقم المهارة أو اسمها.");
    lines.push("╰━━━━━━━━━━━━━━━━━━╯");

    return {
        skills,
        text: lines.join("\n")
    };
}


// ==========================================
// BATTLE LOG
// ==========================================

function getRecentLogs(battle) {
    if (!Array.isArray(battle?.logs)) {
        return [];
    }

    return battle.logs.slice(-MAX_BATTLE_LOGS);
}


function formatBattleLogs(battle) {
    const logs = getRecentLogs(battle);

    return logs
        .map(log => `• ${log.message}`)
        .join("\n");
}


// ==========================================
// REWARD DISPLAY
// ==========================================

function buildRewardMessage(rewards) {
    return [
        "╭━━〔 🎁 DUNGEON REWARDS 〕━━╮",
        "",
        `⭐ XP: +${formatNumber(rewards.xp)}`,
        `💰 Gold: +${formatNumber(rewards.gold)}`,
        "",
        "1 - استلام المكافآت",
        "2 - عدم الاستلام الآن",
        "",
        "╰━━━━━━━━━━━━━━━━━━╯"
    ].join("\n");
}


// ==========================================
// SESSION START
// ==========================================

async function startSession({
    sock,
    msg,
    hunter,
    identity
}) {
    const chat = msg.chat || msg.key?.remoteJid;

    const hunterId = hunter.id;

    const sessionKey = getSessionKey(
        chat,
        hunterId
    );

    if (activeSessions.has(sessionKey)) {
        await sendText(
            sock,
            chat,
            "⚠️ لديك جلسة مغارة مفتوحة بالفعل.",
            msg
        );

        return;
    }

    const session = {
        sock,
        chat,
        hunterId,
        hunter,
        identity,
        stage: "select_dungeon",
        dungeon: null,
        run: null,
        room: null,
        enemyIndex: 0,
        battle: null,
        timeout: null,
        listener: null
    };

    activeSessions.set(
        sessionKey,
        session
    );

    session.listener = async update => {
        if (update.type !== "notify") {
            return;
        }

        for (const incoming of update.messages || []) {
            if (!incoming.message || incoming.key?.fromMe) {
                continue;
            }

            const incomingChat = incoming.key?.remoteJid;

            if (incomingChat !== chat) {
                continue;
            }

            const incomingIdentity = getMessageIdentity(incoming);

            if (!incomingIdentity?.primary) {
                continue;
            }

            const incomingHunter = getHunter(incomingIdentity);

            if (!incomingHunter || incomingHunter.id !== hunterId) {
                continue;
            }

            const text = getMessageText(incoming);

            if (!text) continue;

            refreshSessionTimeout(sessionKey);

            try {
                await handleSessionInput(
                    sessionKey,
                    session,
                    incoming,
                    text
                );
            } catch (error) {
                console.error(
                    "[NOVA DUNGEON] Session error:",
                    error
                );

                await sendText(
                    sock,
                    chat,
                    "❌ حصل خطأ أثناء تنفيذ العملية. حاول مرة تانية.",
                    incoming
                );
            }

            break;
        }
    };

    sock.ev.on(
        "messages.upsert",
        session.listener
    );

    refreshSessionTimeout(sessionKey);

    await resumeOrShowDungeons(
        sessionKey,
        session,
        msg
    );
}


// ==========================================
// RESUME / SHOW DUNGEONS
// ==========================================

async function resumeOrShowDungeons(
    sessionKey,
    session,
    msg
) {
    const activeRun = getActiveDungeon(
        session.hunterId
    );

    if (activeRun) {
        session.run = activeRun;

        if (activeRun.status === "completed") {
            session.stage = "claim_rewards";

            await sendText(
                session.sock,
                session.chat,
                buildRewardMessage(
                    activeRun.pendingRewards
                ),
                msg
            );

            return;
        }

        const room = getCurrentDungeonRoom(
            session.hunterId
        );

        if (room?.status === "cleared") {
            const result = advanceDungeonRoom(
                session.hunter,
                session.hunterId
            );

            if (result.success) {
                session.room = result.room;

                await beginRoom(
                    sessionKey,
                    session,
                    msg
                );

                return;
            }
        }

        if (room?.status === "active") {
            session.room = room;

            await sendText(
                session.sock,
                session.chat,
                [
                    "╭━━〔 🔄 RESUME DUNGEON 〕━━╮",
                    "",
                    `🏰 ${activeRun.dungeonNameAr || activeRun.dungeonName}`,
                    `🚪 الغرفة الحالية: ${activeRun.currentRoom}/${activeRun.totalRooms}`,
                    "",
                    "1 - متابعة المغارة",
                    "2 - الانسحاب",
                    "",
                    "╰━━━━━━━━━━━━━━━━━━╯"
                ].join("\n"),
                msg
            );

            session.stage = "resume";
            return;
        }
    }

    await showDungeonList(
        sessionKey,
        session,
        msg
    );
}


// ==========================================
// SHOW DUNGEON LIST
// ==========================================

async function showDungeonList(
    sessionKey,
    session,
    msg
) {
    const dungeons = getAvailableDungeons(
        session.hunter
    );

    session.dungeons = dungeons;

    session.stage = "select_dungeon";

    await sendText(
        session.sock,
        session.chat,
        buildDungeonList(
            session.hunter,
            dungeons
        ),
        msg
    );
}


// ==========================================
// BEGIN DUNGEON
// ==========================================

async function beginDungeon(
    sessionKey,
    session,
    dungeon,
    msg
) {
    const result = startDungeon(
        session.hunter,
        dungeon.id
    );

    if (!result.success) {
        await sendText(
            session.sock,
            session.chat,
            getDungeonError(result.reason),
            msg
        );

        return;
    }

    session.dungeon = dungeon;
    session.run = result.run;

    session.room = result.run.rooms[0];

    await sendText(
        session.sock,
        session.chat,
        [
            "╭━━〔 🏰 DUNGEON STARTED 〕━━╮",
            "",
            `🏰 ${getDungeonName(dungeon)}`,
            "",
            "بدأت رحلتك داخل المغارة.",
            "استعد لمواجهة الوحوش!",
            "",
            "╰━━━━━━━━━━━━━━━━━━╯"
        ].join("\n"),
        msg
    );

    await beginRoom(
        sessionKey,
        session,
        msg
    );
}


// ==========================================
// BEGIN ROOM
// ==========================================

async function beginRoom(
    sessionKey,
    session,
    msg
) {
    if (!session.room) {
        session.room = getCurrentDungeonRoom(
            session.hunterId
        );
    }

    if (!session.room) {
        await sendText(
            session.sock,
            session.chat,
            "❌ تعذر تحميل الغرفة الحالية.",
            msg
        );

        cleanupSession(sessionKey);
        return;
    }

    session.enemyIndex = 0;
    session.battle = null;

    await sendText(
        session.sock,
        session.chat,
        buildRoomMessage(
            session.run,
            session.room
        ),
        msg
    );

    await beginEnemy(
        sessionKey,
        session,
        msg
    );
}


// ==========================================
// BEGIN ENEMY
// ==========================================

async function beginEnemy(
    sessionKey,
    session,
    msg
) {
    const enemies = session.room.enemies || [];

    if (session.enemyIndex >= enemies.length) {
        await finishRoom(
            sessionKey,
            session,
            msg
        );

        return;
    }

    const monster = enemies[session.enemyIndex];

    // تحديث بيانات الصياد قبل كل معركة.

    const refreshedHunter = getHunter(
        session.identity
    );

    if (refreshedHunter) {
        session.hunter = refreshedHunter;
    }

    const enemy = adaptMonster(monster);

    const battleResult = createBattle(
        session.hunter,
        enemy
    );

    if (!battleResult.success) {
        await sendText(
            session.sock,
            session.chat,
            "❌ تعذر بدء المعركة. راجع بيانات الصياد والوحش.",
            msg
        );

        cleanupSession(sessionKey);
        return;
    }

    session.battle = battleResult.battle;

    session.stage = "battle";

    await sendText(
        session.sock,
        session.chat,
        buildBattleMessage(
            session.battle,
            monster,
            session.enemyIndex,
            enemies.length
        ),
        msg
    );
}


// ==========================================
// PROCESS HUNTER ACTION
// ==========================================

async function processBattleAction(
    sessionKey,
    session,
    action,
    msg
) {
    const battle = session.battle;

    if (!battle || battle.status !== "ongoing") {
        await sendText(
            session.sock,
            session.chat,
            "❌ لا توجد معركة نشطة.",
            msg
        );

        return;
    }

    let result;

    // --------------------------------------
    // BASIC ATTACK
    // --------------------------------------

    if (action === "1" || action === "هجوم") {
        result = performBasicAttack(
            battle,
            "hunter"
        );
    }

    // --------------------------------------
    // SKILLS
    // --------------------------------------

    else if (
        action === "2" ||
        action === "مهارة" ||
        action === "مهارات"
    ) {
        session.stage = "select_skill";

        const skillList = buildSkillMessage(
            session.hunter
        );

        await sendText(
            session.sock,
            session.chat,
            skillList.text,
            msg
        );

        if (!skillList.skills.length) {
            session.stage = "battle";
        }

        return;
    }

    // --------------------------------------
    // MANA RESTORE
    // --------------------------------------

    else if (
        action === "3" ||
        action === "مانا"
    ) {
        result = restoreMana(
            battle,
            "hunter",
            10
        );
    }

    // --------------------------------------
    // ABANDON
    // --------------------------------------

    else if (
        action === "4" ||
        action === "انسحاب"
    ) {
        const abandoned = abandonDungeon(
            session.hunterId
        );

        if (abandoned.success) {
            await sendText(
                session.sock,
                session.chat,
                "🚪 انسحبت من المغارة. تم حفظ سجل المحاولة.",
                msg
            );
        }

        cleanupSession(sessionKey);
        return;
    }

    else {
        await sendText(
            session.sock,
            session.chat,
            "❌ اختيار غير صحيح.\nاستخدم 1 أو 2 أو 3 أو 4.",
            msg
        );

        return;
    }

    if (!result?.success) {
        await sendText(
            session.sock,
            session.chat,
            getCombatError(result?.reason),
            msg
        );

        return;
    }

    await finishHunterTurn(
        sessionKey,
        session,
        msg
    );
}


// ==========================================
// PROCESS SKILL SELECTION
// ==========================================

async function processSkillSelection(
    sessionKey,
    session,
    text,
    msg
) {
    const skills = buildSkillList(
        session.hunter
    );

    const choice = normalizeText(text);

    let selectedSkill = null;

    const numericChoice = Number(choice);

    if (
        Number.isInteger(numericChoice) &&
        numericChoice >= 1 &&
        numericChoice <= skills.length
    ) {
        selectedSkill = skills[numericChoice - 1];
    } else {
        selectedSkill = skills.find(skill => {
            return (
                normalizeText(skill.id) === choice ||
                normalizeText(skill.name) === choice ||
                normalizeText(skill.nameAr) === choice
            );
        });
    }

    if (!selectedSkill) {
        await sendText(
            session.sock,
            session.chat,
            "❌ المهارة غير موجودة في قائمتك.",
            msg
        );

        return;
    }

    const result = useHunterSkill(
        session.battle,
        selectedSkill.id
    );

    if (!result.success) {
        await sendText(
            session.sock,
            session.chat,
            getCombatError(result.reason),
            msg
        );

        return;
    }

    session.stage = "battle";

    await finishHunterTurn(
        sessionKey,
        session,
        msg
    );
}


// ==========================================
// FINISH HUNTER TURN
// ==========================================

async function finishHunterTurn(
    sessionKey,
    session,
    msg
) {
    const battle = session.battle;

    if (!battle) return;

    // --------------------------------------
    // HUNTER VICTORY
    // --------------------------------------

    if (battle.status === "victory") {
        await handleEnemyDefeated(
            sessionKey,
            session,
            msg
        );

        return;
    }

    // --------------------------------------
    // HUNTER DEFEAT
    // --------------------------------------

    if (
        battle.status === "defeat" ||
        battle.status === "draw"
    ) {
        await handleHunterDefeated(
            sessionKey,
            session,
            msg
        );

        return;
    }

    // --------------------------------------
    // ENEMY TURN
    // --------------------------------------

    const enemyResult = performEnemyAttack(
        battle
    );

    if (!enemyResult.success) {
        await sendText(
            session.sock,
            session.chat,
            "❌ تعذر تنفيذ هجوم الوحش.",
            msg
        );

        return;
    }

    // --------------------------------------
    // CHECK RESULT
    // --------------------------------------

    if (
        battle.status === "defeat" ||
        battle.status === "draw"
    ) {
        await handleHunterDefeated(
            sessionKey,
            session,
            msg
        );

        return;
    }

    if (battle.status === "victory") {
        await handleEnemyDefeated(
            sessionKey,
            session,
            msg
        );

        return;
    }

    advanceBattleTurn(battle);

    await sendText(
        session.sock,
        session.chat,
        [
            formatBattleLogs(battle),
            "",
            buildBattleMessage(
                battle,
                session.room.enemies[session.enemyIndex],
                session.enemyIndex,
                session.room.enemies.length
            )
        ].join("\n"),
        msg
    );
}


// ==========================================
// ENEMY DEFEATED
// ==========================================

async function handleEnemyDefeated(
    sessionKey,
    session,
    msg
) {
    const battle = session.battle;

    if (!battle) return;

    const monster = session.room.enemies[
        session.enemyIndex
    ];

    // حفظ صحة ومانا الصياد بعد المعركة.

    const saved = saveHunterVitals(
        session.hunterId,
        battle.hunter.hp,
        battle.hunter.mp
    );

    if (!saved) {
        await sendText(
            session.sock,
            session.chat,
            "⚠️ تعذر حفظ حالة الصياد.",
            msg
        );

        cleanupSession(sessionKey);
        return;
    }

    session.hunter.hp = battle.hunter.hp;
    session.hunter.mp = battle.hunter.mp;

    const monsterRewards = monster.rewards || {};

    await sendText(
        session.sock,
        session.chat,
        [
            "╭━━〔 ✅ MONSTER DEFEATED 〕━━╮",
            "",
            `👹 ${getMonsterName(monster)}`,
            "",
            "❤️ تم القضاء على الوحش.",
            `⭐ XP: +${formatNumber(monsterRewards.xp)}`,
            `💰 Gold: +${formatNumber(monsterRewards.gold)}`,
            "",
            "╰━━━━━━━━━━━━━━━━━━╯"
        ].join("\n"),
        msg
    );

    session.enemyIndex += 1;

    session.battle = null;

    await beginEnemy(
        sessionKey,
        session,
        msg
    );
}


// ==========================================
// HUNTER DEFEATED
// ==========================================

async function handleHunterDefeated(
    sessionKey,
    session,
    msg
) {
    const battle = session.battle;

    if (battle) {
        saveHunterVitals(
            session.hunterId,
            battle.hunter.hp,
            battle.hunter.mp
        );
    }

    completeDungeonRoom(
        session.hunterId,
        false
    );

    await sendText(
        session.sock,
        session.chat,
        [
            "╭━━〔 ❌ DUNGEON FAILED 〕━━╮",
            "",
            "لم يتمكن الصياد من إكمال المغارة.",
            "",
            `❤️ HP: ${battle?.hunter.hp || 0}`,
            `💙 MP: ${battle?.hunter.mp || 0}`,
            "",
            "تم تسجيل المحاولة الفاشلة.",
            "",
            "╰━━━━━━━━━━━━━━━━━━╯"
        ].join("\n"),
        msg
    );

    cleanupSession(sessionKey);
}


// ==========================================
// FINISH ROOM
// ==========================================

async function finishRoom(
    sessionKey,
    session,
    msg
) {
    const result = completeDungeonRoom(
        session.hunterId,
        true
    );

    if (!result.success) {
        await sendText(
            session.sock,
            session.chat,
            "❌ تعذر إكمال الغرفة.",
            msg
        );

        return;
    }

    // --------------------------------------
    // DUNGEON COMPLETED
    // --------------------------------------

    if (result.status === "completed") {
        session.run = result.run;

        session.stage = "claim_rewards";

        await sendText(
            session.sock,
            session.chat,
            [
                "╭━━〔 👑 DUNGEON CLEARED 〕━━╮",
                "",
                `🏰 ${result.run.dungeonNameAr || result.run.dungeonName}`,
                "",
                "🎉 تم إكمال جميع غرف المغارة!",
                "",
                `⭐ XP: +${formatNumber(result.rewards.xp)}`,
                `💰 Gold: +${formatNumber(result.rewards.gold)}`,
                "",
                "1 - استلام المكافآت",
                "2 - لاحقًا",
                "",
                "╰━━━━━━━━━━━━━━━━━━╯"
            ].join("\n"),
            msg
        );

        return;
    }

    // --------------------------------------
    // ROOM CLEARED
    // --------------------------------------

    await sendText(
        session.sock,
        session.chat,
        [
            "╭━━〔 ✅ ROOM CLEARED 〕━━╮",
            "",
            `🚪 تم تنظيف الغرفة ${session.run.currentRoom}.`,
            "",
            `⭐ XP المكتسب: +${formatNumber(result.run.rooms[session.run.currentRoom - 1]?.rewards?.xp)}`,
            `💰 Gold المكتسب: +${formatNumber(result.run.rooms[session.run.currentRoom - 1]?.rewards?.gold)}`,
            "",
            "1 - الانتقال للغرفة التالية",
            "2 - الانسحاب",
            "",
            "╰━━━━━━━━━━━━━━━━━━╯"
        ].join("\n"),
        msg
    );

    session.run = result.run;

    session.stage = "room_cleared";
}


// ==========================================
// ADVANCE ROOM
// ==========================================

async function goToNextRoom(
    sessionKey,
    session,
    msg
) {
    const result = advanceDungeonRoom(
        session.hunter,
        session.hunterId
    );

    if (!result.success) {
        await sendText(
            session.sock,
            session.chat,
            "❌ تعذر الانتقال للغرفة التالية.",
            msg
        );

        return;
    }

    session.run = result.run;
    session.room = result.room;

    await beginRoom(
        sessionKey,
        session,
        msg
    );
}


// ==========================================
// CLAIM REWARDS
// ==========================================

async function handleClaimRewards(
    sessionKey,
    session,
    shouldClaim,
    msg
) {
    if (!shouldClaim) {
        await sendText(
            session.sock,
            session.chat,
            "🎁 مكافآتك محفوظة. استخدم .مغارات لاستلامها لاحقًا.",
            msg
        );

        cleanupSession(sessionKey);
        return;
    }

    const result = claimDungeonRewards(
        session.hunterId
    );

    if (!result.success) {
        await sendText(
            session.sock,
            session.chat,
            "❌ تعذر استلام المكافآت.",
            msg
        );

        return;
    }

    const rewards = result.rewards;

    // إضافة الخبرة.

    const xpResult = addXP(
        session.hunterId,
        rewards.xp
    );

    if (!xpResult?.success) {
        await sendText(
            session.sock,
            session.chat,
            "⚠️ تم إنهاء المغارة، لكن تعذرت إضافة الخبرة. راجع بيانات الصياد.",
            msg
        );

        cleanupSession(sessionKey);
        return;
    }

    // إضافة الذهب.

    const goldSaved = addHunterGold(
        session.hunterId,
        rewards.gold
    );

    if (!goldSaved) {
        await sendText(
            session.sock,
            session.chat,
            "⚠️ تمت إضافة الخبرة، لكن تعذر حفظ الذهب.",
            msg
        );

        cleanupSession(sessionKey);
        return;
    }

    const levelMessage = xpResult.levelsGained > 0
        ? `\n🎉 ارتفع مستواك إلى ${xpResult.currentLevel}!`
        : "";

    await sendText(
        session.sock,
        session.chat,
        [
            "╭━━〔 🎁 REWARDS CLAIMED 〕━━╮",
            "",
            `⭐ XP: +${formatNumber(rewards.xp)}`,
            `💰 Gold: +${formatNumber(rewards.gold)}`,
            levelMessage,
            "",
            "🏰 أحسنت! تم إنهاء المغارة بنجاح.",
            "",
            "╰━━━━━━━━━━━━━━━━━━╯"
        ].join("\n"),
        msg
    );

    cleanupSession(sessionKey);
}


// ==========================================
// ERROR MESSAGES
// ==========================================

function getDungeonError(reason) {
    const errors = {
        HUNTER_NOT_FOUND:
            "❌ لم يتم العثور على الصياد.",

        DUNGEON_NOT_FOUND:
            "❌ المغارة غير موجودة.",

        LEVEL_TOO_LOW:
            "❌ مستواك أقل من المستوى المطلوب.",

        RANK_TOO_LOW:
            "❌ رتبتك لا تسمح بدخول المغارة.",

        ACTIVE_DUNGEON_EXISTS:
            "⚠️ لديك مغارة نشطة بالفعل. استخدم .مغارات لمتابعتها."
    };

    return errors[reason] || `❌ تعذر تنفيذ العملية: ${reason}`;
}


function getCombatError(reason) {
    const errors = {
        BATTLE_NOT_ACTIVE:
            "❌ المعركة غير نشطة.",

        INVALID_SIDE:
            "❌ جهة القتال غير صحيحة.",

        INVALID_COMBATANT_STATE:
            "❌ حالة المقاتل غير صالحة.",

        SKILL_NOT_FOUND:
            "❌ المهارة غير موجودة.",

        NOT_ACTIVE_SKILL:
            "❌ هذه ليست مهارة نشطة.",

        SKILL_NOT_LEARNED:
            "❌ لم تتعلم هذه المهارة.",

        CLASS_NOT_ALLOWED:
            "❌ فئتك لا تستطيع استخدام هذه المهارة.",

        SKILL_ON_COOLDOWN:
            "⏳ المهارة في فترة انتظار.",

        NOT_ENOUGH_MP:
            "💙 المانا غير كافية لاستخدام المهارة.",

        INVALID_SKILL_POWER:
            "❌ قوة المهارة غير صالحة."
    };

    return errors[reason] || `❌ خطأ في القتال: ${reason}`;
}


// ==========================================
// SESSION INPUT HANDLER
// ==========================================

async function handleSessionInput(
    sessionKey,
    session,
    msg,
    text
) {
    const input = normalizeText(text);

    // --------------------------------------
    // RESUME
    // --------------------------------------

    if (session.stage === "resume") {
        if (
            input === "1" ||
            input === "متابعة" ||
            input === "استكمال"
        ) {
            session.stage = "battle";

            await beginRoom(
                sessionKey,
                session,
                msg
            );

            return;
        }

        if (
            input === "2" ||
            input === "انسحاب"
        ) {
            abandonDungeon(session.hunterId);

            await sendText(
                session.sock,
                session.chat,
                "🚪 تم الانسحاب من المغارة.",
                msg
            );

            cleanupSession(sessionKey);
            return;
        }

        return;
    }

    // --------------------------------------
    // SELECT DUNGEON
    // --------------------------------------

    if (session.stage === "select_dungeon") {
        const dungeons = session.dungeons || [];

        const numericChoice = Number(input);

        let dungeon = null;

        if (
            Number.isInteger(numericChoice) &&
            numericChoice >= 1 &&
            numericChoice <= dungeons.length
        ) {
            dungeon = dungeons[numericChoice - 1];
        } else {
            dungeon = dungeons.find(item => {
                return (
                    normalizeText(item.id) === input ||
                    normalizeText(item.name) === input ||
                    normalizeText(item.nameAr) === input
                );
            });
        }

        if (!dungeon) {
            await sendText(
                session.sock,
                session.chat,
                "❌ المغارة غير موجودة في القائمة.",
                msg
            );

            return;
        }

        session.dungeon = dungeon;
        session.stage = "dungeon_details";

        await sendText(
            session.sock,
            session.chat,
            buildDungeonDetails(dungeon),
            msg
        );

        return;
    }

    // --------------------------------------
    // DUNGEON DETAILS
    // --------------------------------------

    if (session.stage === "dungeon_details") {
        if (
            input === "1" ||
            input === "دخول" ||
            input === "ابدأ"
        ) {
            await beginDungeon(
                sessionKey,
                session,
                session.dungeon,
                msg
            );

            return;
        }

        if (
            input === "2" ||
            input === "رجوع"
        ) {
            await showDungeonList(
                sessionKey,
                session,
                msg
            );

            return;
        }

        return;
    }

    // --------------------------------------
    // BATTLE
    // --------------------------------------

    if (session.stage === "battle") {
        await processBattleAction(
            sessionKey,
            session,
            input,
            msg
        );

        return;
    }

    // --------------------------------------
    // SKILL SELECTION
    // --------------------------------------

    if (session.stage === "select_skill") {
        if (
            input === "0" ||
            input === "رجوع"
        ) {
            session.stage = "battle";

            await sendText(
                session.sock,
                session.chat,
                buildBattleMessage(
                    session.battle,
                    session.room.enemies[session.enemyIndex],
                    session.enemyIndex,
                    session.room.enemies.length
                ),
                msg
            );

            return;
        }

        await processSkillSelection(
            sessionKey,
            session,
            input,
            msg
        );

        return;
    }

    // --------------------------------------
    // ROOM CLEARED
    // --------------------------------------

    if (session.stage === "room_cleared") {
        if (
            input === "1" ||
            input === "التالي" ||
            input === "استمرار"
        ) {
            await goToNextRoom(
                sessionKey,
                session,
                msg
            );

            return;
        }

        if (
            input === "2" ||
            input === "انسحاب"
        ) {
            abandonDungeon(session.hunterId);

            await sendText(
                session.sock,
                session.chat,
                "🚪 انسحبت من المغارة. تم حفظ سجل المحاولة.",
                msg
            );

            cleanupSession(sessionKey);
            return;
        }

        return;
    }

    // --------------------------------------
    // CLAIM REWARDS
    // --------------------------------------

    if (session.stage === "claim_rewards") {
        if (
            input === "1" ||
            input === "استلام" ||
            input === "نعم"
        ) {
            await handleClaimRewards(
                sessionKey,
                session,
                true,
                msg
            );

            return;
        }

        if (
            input === "2" ||
            input === "لاحقًا" ||
            input === "لا"
        ) {
            await handleClaimRewards(
                sessionKey,
                session,
                false,
                msg
            );

            return;
        }
    }
}


// ==========================================
// PLUGIN EXECUTION
// ==========================================

export default {
    NovaUltra,

    async execute({ sock, msg, args, sender }) {
        const chat = msg.chat || msg.key?.remoteJid;

        if (!chat) {
            return;
        }

        const identity = resolveHunterIdentity({
            msg,
            sender
        });

        if (!identity?.primary) {
            await sendText(
                sock,
                chat,
                "❌ تعذر تحديد هوية الصياد.",
                msg
            );

            return;
        }

        const hunter = getHunter(identity);

        if (!hunter) {
            await sendText(
                sock,
                chat,
                "❌ ليس لديك ملف صياد في نظام NOVA.\nاستخدم أمر الاستيقاظ أولًا.",
                msg
            );

            return;
        }

        if (!hunter.id) {
            await sendText(
                sock,
                chat,
                "❌ ملف الصياد لا يحتوي على ID صالح.",
                msg
            );

            return;
        }

        await startSession({
            sock,
            msg,
            hunter,
            identity
        });
    }
};
