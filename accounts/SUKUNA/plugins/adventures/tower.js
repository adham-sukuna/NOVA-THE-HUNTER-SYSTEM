import {
    resolveHunterIdentity,
    addXP
} from "../../nova/engine/PlayerEngine.js";

import {
    getHunters,
    saveHunters
} from "../../nova/engine/storage.js";

import {
    getTowers,
    getTower,
    canEnterTower,
    enterTower,
    getTowerProgress,
    completeTowerFloor,
    advanceTowerFloor,
    retryTowerFloor,
    leaveTower,
    claimTowerRewards
} from "../../nova/engine/TowerEngine.js";

import {
    createBattle,
    performBasicAttack,
    useHunterSkill,
    performEnemyAttack,
    advanceBattleTurn,
    getBattleStatus
} from "../../nova/engine/CombatEngine.js";


// ==========================================
// SESSION STORAGE
// ==========================================

const activeSessions = new Map();

const SESSION_TIMEOUT = 300000;


// ==========================================
// BASIC HELPERS
// ==========================================

function safeNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


function normalizeJid(value) {
    if (!value) return "";

    return String(value)
        .trim()
        .replace(/:\d+(?=@)/, "")
        .toLowerCase();
}


function unwrapMessage(message) {
    let current = message?.message;

    for (let i = 0; i < 6 && current; i++) {
        const wrapper =
            current.ephemeralMessage?.message ||
            current.viewOnceMessage?.message ||
            current.viewOnceMessageV2?.message ||
            current.documentWithCaptionMessage?.message;

        if (!wrapper) break;

        current = wrapper;
    }

    return current || {};
}


function getMessageText(message) {
    const msg = unwrapMessage(message);

    return String(
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        msg.documentMessage?.caption ||
        msg.buttonsResponseMessage?.selectedButtonId ||
        msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
        msg.templateButtonReplyMessage?.selectedId ||
        msg.interactiveResponseMessage?.body?.text ||
        ""
    ).trim();
}


function getIncomingSender(message) {
    return (
        message?.key?.participant ||
        message?.key?.remoteJid ||
        ""
    );
}


function getSessionKey(chatId, hunterId) {
    return `${normalizeJid(chatId)}:${normalizeJid(hunterId)}`;
}


function formatNumber(value) {
    return safeNumber(value).toLocaleString("en-US");
}


function normalizeText(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[ـ]/g, "")
        .replace(/\s+/g, " ");
}


// ==========================================
// HUNTER IDENTITY
// ==========================================

function getHunterIdentities(identity, hunter) {
    const values = [
        identity?.pn,
        identity?.lid,
        identity?.primary,

        hunter?.id,

        hunter?.identities?.pn,
        hunter?.identities?.lid
    ];

    return new Set(
        values
            .filter(Boolean)
            .map(normalizeJid)
            .filter(Boolean)
    );
}


function isSameSender(message, session) {
    const incomingChat = normalizeJid(
        message?.key?.remoteJid
    );

    const sessionChat = normalizeJid(
        session.chatId
    );

    if (!incomingChat || incomingChat !== sessionChat) {
        return false;
    }

    // في الخاص، المحادثة نفسها تحدد صاحب الجلسة.
    if (!incomingChat.endsWith("@g.us")) {
        return true;
    }

    // في الجروبات لازم نتحقق من هوية المشارك.
    const incomingSender = normalizeJid(
        getIncomingSender(message)
    );

    if (!incomingSender) {
        return false;
    }

    if (session.identities?.has(incomingSender)) {
        return true;
    }

    // محاولة مطابقة PN و LID من الرسالة الواردة.
    try {
        const identity = resolveHunterIdentity({
            msg: message,
            sender: null
        });

        const candidates = [
            identity?.pn,
            identity?.lid,
            identity?.primary
        ]
            .filter(Boolean)
            .map(normalizeJid);

        return candidates.some(
            value => session.identities?.has(value)
        );

    } catch {
        return false;
    }
}


// ==========================================
// HUNTER SEARCH
// ==========================================

function findHunterFromIdentity(identity, msg, sender) {
    if (!identity) return null;

    const hunters = getHunters();

    if (!hunters || typeof hunters !== "object") {
        return null;
    }

    const candidates = [
        identity.pn,
        identity.lid,
        identity.primary,

        sender?.pn,
        sender?.lid,
        sender?.id,

        msg?.key?.participant,

        !msg?.key?.remoteJid?.endsWith("@g.us")
            ? msg?.key?.remoteJid
            : null
    ];

    const identifiers = new Set(
        candidates
            .filter(Boolean)
            .map(normalizeJid)
            .filter(Boolean)
    );

    if (!identifiers.size) {
        return null;
    }

    const matches = [];

    for (const [key, hunter] of Object.entries(hunters)) {
        if (!hunter) continue;

        const storedIdentifiers = [
            key,
            hunter.id,
            hunter.identities?.pn,
            hunter.identities?.lid
        ]
            .filter(Boolean)
            .map(normalizeJid)
            .filter(Boolean);

        if (
            storedIdentifiers.some(
                id => identifiers.has(id)
            )
        ) {
            matches.push(hunter);
        }
    }

    if (matches.length > 1) {
        throw new Error("HUNTER_IDENTITY_CONFLICT");
    }

    return matches[0] || null;
}


// ==========================================
// HUNTER STORAGE
// ==========================================

function findHunterDatabaseEntry(hunters, hunter) {
    if (!hunters || !hunter) return null;

    const identities = getHunterIdentities(
        null,
        hunter
    );

    for (const [key, storedHunter] of Object.entries(hunters)) {
        if (!storedHunter) continue;

        const storedIdentities = [
            key,
            storedHunter.id,
            storedHunter.identities?.pn,
            storedHunter.identities?.lid
        ]
            .filter(Boolean)
            .map(normalizeJid);

        const matched = storedIdentities.some(
            value => identities.has(value)
        );

        if (matched) {
            return {
                key,
                hunter: storedHunter
            };
        }
    }

    return null;
}


function refreshHunter(hunter) {
    if (!hunter) return null;

    const hunters = getHunters();

    const entry = findHunterDatabaseEntry(
        hunters,
        hunter
    );

    return entry?.hunter || null;
}


function saveHunterVitals(hunter, battle) {
    if (!hunter || !battle?.hunter) {
        return false;
    }

    const hunters = getHunters();

    const entry = findHunterDatabaseEntry(
        hunters,
        hunter
    );

    if (!entry) {
        throw new Error(
            "NOVA_HUNTER_STORAGE_ENTRY_NOT_FOUND"
        );
    }

    const combatHunter = battle.hunter;

    entry.hunter.hp = Math.max(
        0,
        Math.min(
            safeNumber(combatHunter.maxHp),
            safeNumber(combatHunter.hp)
        )
    );

    entry.hunter.mp = Math.max(
        0,
        Math.min(
            safeNumber(combatHunter.maxMp),
            safeNumber(combatHunter.mp)
        )
    );

    entry.hunter.lastActive = Date.now();

    saveHunters(hunters);

    hunter.hp = entry.hunter.hp;
    hunter.mp = entry.hunter.mp;

    return true;
}


// ==========================================
// TOWER SEARCH
// ==========================================

function getTowerDisplayName(tower) {
    return (
        tower?.nameAr ||
        tower?.name ||
        tower?.id ||
        "برج مجهول"
    );
}


function findTowerByInput(input) {
    const query = normalizeText(input);

    if (!query) return null;

    const towers = getTowers();

    return towers.find(tower => {
        const values = [
            tower.id,
            tower.name,
            tower.nameAr
        ];

        return values.some(
            value => normalizeText(value) === query
        );
    }) || null;
}


function getMonsterName(monster) {
    return (
        monster?.nameAr ||
        monster?.name ||
        monster?.id ||
        "وحش مجهول"
    );
}


// ==========================================
// RANK DISPLAY
// ==========================================

function getRankEmoji(rank) {
    const ranks = {
        E: "▫️",
        D: "🟩",
        C: "🟦",
        B: "🟪",
        A: "🟨",
        S: "🟥",
        SS: "🔥",
        SSS: "💎",
        NATIONAL: "👑"
    };

    return ranks[
        String(rank || "E").toUpperCase()
    ] || "▫️";
}


// ==========================================
// MESSAGE SENDER
// ==========================================

async function sendText(sock, chatId, text, quoted = null) {
    return sock.sendMessage(
        chatId,
        { text },
        quoted ? { quoted } : {}
    );
}


// ==========================================
// SESSION MANAGEMENT
// ==========================================

function endSession(session, message = null) {
    if (!session || session.ended) return;

    session.ended = true;

    if (session.listener) {
        try {
            session.sock.ev.off(
                "messages.upsert",
                session.listener
            );
        } catch (error) {
            console.error(
                "[NOVA TOWER LISTENER CLEANUP]",
                error
            );
        }
    }

    if (session.timeout) {
        clearTimeout(session.timeout);
        session.timeout = null;
    }

    if (
        activeSessions.get(session.key) === session
    ) {
        activeSessions.delete(session.key);
    }

    if (message) {
        sendText(
            session.sock,
            session.chatId,
            message
        ).catch(() => {});
    }
}


function resetSessionTimeout(session) {
    if (!session || session.ended) return;

    if (session.timeout) {
        clearTimeout(session.timeout);
    }

    session.timeout = setTimeout(() => {
        endSession(
            session,
            "⌛ انتهت جلسة البرج بسبب عدم وجود تفاعل.\nتقدمك محفوظ، تقدر ترجع تكمل باستخدام أمر البرج."
        );
    }, SESSION_TIMEOUT);
}


function registerSessionListener(session, handler) {
    if (!session || !handler) return false;

    session.listener = async update => {
        if (session.ended) return;

        const messages = update?.messages || [];

        for (const incoming of messages) {
            if (session.ended) break;

            if (!incoming?.message) continue;
            if (incoming.key?.fromMe) continue;

            if (
                !isSameSender(incoming, session)
            ) {
                continue;
            }

            const text = getMessageText(incoming);

            if (!text) continue;

            resetSessionTimeout(session);

            try {
                await handler(
                    incoming,
                    text
                );

            } catch (error) {
                console.error(
                    "[NOVA TOWER MESSAGE ERROR]",
                    error
                );

                await sendText(
                    session.sock,
                    session.chatId,
                    `❌ حصل خطأ أثناء تنفيذ الحركة.\n${error.message || "UNKNOWN_ERROR"}`
                );
            }
        }
    };

    session.sock.ev.on(
        "messages.upsert",
        session.listener
    );

    return true;
}


// ==========================================
// TOWER MENU
// ==========================================

function buildTowerMenu(hunter) {
    const towers = getTowers();

    let text = `
╭━━━〔 🏰 أبراج الصيادين 〕━━━╮

👤 الصياد: ${hunter.name || "Hunter"}
⭐ المستوى: ${formatNumber(hunter.level)}
🏅 الرتبة: ${getRankEmoji(hunter.rank)} ${hunter.rank || "E"}

`;

    for (const tower of towers) {
        const requirement = canEnterTower(
            hunter,
            tower.id
        );

        const status = requirement.allowed
            ? "🟢 متاح"
            : "🔒 غير متاح";

        text += `
╭─〔 ${getTowerDisplayName(tower)} 〕
│ 🆔 ${tower.id}
│ 🏅 الرتبة المطلوبة: ${tower.rank}
│ ⭐ المستوى المطلوب: ${tower.minLevel}
│ 🏢 الطوابق: ${tower.totalFloors}
│ ${status}
╰──────────────
`;
    }

    text += `
📌 أرسل اسم البرج أو ID للدخول إليه.

مثال:
unstable_tower

أو أرسل اسمه بالعربي.

╰━━━━━━━━━━━━━━━━━━╯`;

    return text;
}


// ==========================================
// FLOOR INFORMATION
// ==========================================

function formatFloorType(floor) {
    return floor?.isBossFloor
        ? "👑 طابق زعيم"
        : "⚔️ طابق عادي";
}


function buildFloorMessage(session) {
    const floor = session.floor;

    const enemies = floor.enemies || [];

    let text = `
╭━━━〔 🏰 البرج 〕━━━╮

🏢 البرج: ${session.towerName}
📍 الطابق: ${floor.number}/100
${formatFloorType(floor)}

⚔️ عدد الوحوش: ${enemies.length}
🔥 الصعوبة: ${floor.difficulty}

`;

    for (let index = 0; index < enemies.length; index++) {
        const enemy = enemies[index];

        text += `
${index + 1}. ${getMonsterName(enemy)}
❤️ HP: ${formatNumber(enemy.hp ?? enemy.currentHP)}/${formatNumber(enemy.maxHp ?? enemy.maxHP)}
`;
    }

    text += `
🎁 مكافأة الطابق:
✨ XP: ${formatNumber(floor.rewards?.xp)}
💰 Gold: ${formatNumber(floor.rewards?.gold)}

╰━━━━━━━━━━━━━━━━━━╯

اكتب:
هجوم
مهارة skill_id
حالة
خروج
`;

    return text;
}


// ==========================================
// COMBAT ADAPTER
// ==========================================

function prepareEnemyForCombat(enemy) {
    if (!enemy) {
        throw new Error("INVALID_TOWER_ENEMY");
    }

    const derived = enemy.derivedStats || {};

    const maxHp = Math.max(
        1,
        safeNumber(
            enemy.maxHp ??
            enemy.maxHP ??
            derived.maxHp ??
            derived.maxHP,
            100
        )
    );

    const maxMp = Math.max(
        0,
        safeNumber(
            enemy.maxMp ??
            enemy.maxMP ??
            derived.maxMp ??
            derived.maxMP,
            0
        )
    );

    const hp = Math.max(
        0,
        Math.min(
            maxHp,
            safeNumber(
                enemy.hp ??
                enemy.currentHP,
                maxHp
            )
        )
    );

    const mp = Math.max(
        0,
        Math.min(
            maxMp,
            safeNumber(
                enemy.mp ??
                enemy.currentMP,
                maxMp
            )
        )
    );

    return {
        ...enemy,

        maxHp,
        hp,

        maxMp,
        mp,

        derivedStats: {
            ...derived,
            maxHp,
            maxMp
        }
    };
}


// ==========================================
// START BATTLE
// ==========================================

function startEnemyBattle(session) {
    const enemies = session.floor?.enemies || [];

    if (
        session.enemyIndex < 0 ||
        session.enemyIndex >= enemies.length
    ) {
        return {
            success: false,
            reason: "ENEMY_INDEX_INVALID"
        };
    }

    const enemy = prepareEnemyForCombat(
        enemies[session.enemyIndex]
    );

    const hunter = refreshHunter(
        session.hunter
    );

    if (!hunter) {
        return {
            success: false,
            reason: "HUNTER_NOT_FOUND"
        };
    }

    const result = createBattle(
        hunter,
        enemy
    );

    if (!result?.success || !result.battle) {
        return {
            success: false,
            reason: result?.reason || "BATTLE_CREATION_FAILED"
        };
    }

    session.hunter = hunter;
    session.battle = result.battle;
    session.currentEnemy = enemy;

    return {
        success: true,
        battle: result.battle,
        enemy
    };
}


// ==========================================
// COMBAT STATUS
// ==========================================

function getCombatText(session) {
    const status = getBattleStatus(
        session.battle
    );

    if (!status) {
        return "تعذر قراءة حالة المعركة.";
    }

    const hunter = status.hunter || {};
    const enemy = status.enemy || {};

    return `
╭━━━〔 ⚔️ حالة المعركة 〕━━━╮

🏢 الطابق: ${session.floor.number}/100
👾 الوحش: ${getMonsterName(session.currentEnemy)}

👤 ${session.hunter.name || "Hunter"}
❤️ HP: ${formatNumber(hunter.hp)}/${formatNumber(hunter.maxHp)}
💧 MP: ${formatNumber(hunter.mp)}/${formatNumber(hunter.maxMp)}

👾 ${getMonsterName(session.currentEnemy)}
❤️ HP: ${formatNumber(enemy.hp)}/${formatNumber(enemy.maxHp)}

🔄 الدور: ${formatNumber(status.turn)}
📌 الحالة: ${status.status}

╰━━━━━━━━━━━━━━━━━━╯
`;
}


// ==========================================
// REWARDS
// ==========================================

async function creditTowerRewards(session, rewards) {
    const xp = Math.max(
        0,
        Math.floor(safeNumber(rewards?.xp))
    );

    const gold = Math.max(
        0,
        Math.floor(safeNumber(rewards?.gold))
    );

    let hunter = refreshHunter(
        session.hunter
    );

    if (!hunter) {
        throw new Error("HUNTER_NOT_FOUND");
    }

    if (gold > 0) {
        const hunters = getHunters();

        const entry = findHunterDatabaseEntry(
            hunters,
            hunter
        );

        if (!entry) {
            throw new Error(
                "HUNTER_STORAGE_ENTRY_NOT_FOUND"
            );
        }

        entry.hunter.gold = Math.max(
            0,
            safeNumber(entry.hunter.gold)
        ) + gold;

        entry.hunter.lastActive = Date.now();

        saveHunters(hunters);
    }

    let xpResult = null;

    if (xp > 0) {
        xpResult = addXP(
            hunter.id,
            xp
        );

        if (!xpResult?.success) {
            throw new Error(
                `XP_CREDIT_FAILED: ${xpResult?.reason || "UNKNOWN"}`
            );
        }
    }

    session.hunter = refreshHunter(hunter);

    return {
        xp,
        gold,
        xpResult
    };
}


// ==========================================
// TOWER COMPLETION
// ==========================================

async function finishTower(session) {
    const claim = claimTowerRewards(
        session.hunter.id,
        session.towerId
    );

    if (!claim.success) {
        await sendText(
            session.sock,
            session.chatId,
            `⚠️ اكتمل البرج، لكن تعذر استلام المكافآت.\nالسبب: ${claim.reason}`
        );

        endSession(session);

        return;
    }

    try {
        const credited = await creditTowerRewards(
            session,
            claim.rewards
        );

        const currentHunter = refreshHunter(
            session.hunter
        );

        await sendText(
            session.sock,
            session.chatId,
            `
╭━━━〔 👑 إتمام البرج 〕━━━╮

🎉 مبروك! لقد أنهيت البرج بالكامل!

🏰 البرج: ${session.towerName}
🏢 الطوابق: 100/100

🎁 المكافآت المستلمة:

✨ XP: ${formatNumber(credited.xp)}
💰 Gold: ${formatNumber(credited.gold)}

⭐ المستوى الحالي: ${formatNumber(currentHunter?.level)}
💰 رصيد الذهب: ${formatNumber(currentHunter?.gold)}

╰━━━━━━━━━━━━━━━━━━╯
`
        );

    } catch (error) {
        console.error(
            "[NOVA TOWER REWARD ERROR]",
            error
        );

        await sendText(
            session.sock,
            session.chatId,
            "⚠️ البرج اكتمل، لكن حصل خطأ أثناء إضافة المكافآت. راجع سجل البوت قبل أي محاولة استلام أخرى."
        );
    }

    endSession(session);
}


// ==========================================
// FLOOR COMPLETION
// ==========================================

async function finishCurrentFloor(session) {
    const result = completeTowerFloor(
        session.hunter.id,
        session.towerId,
        true
    );

    if (!result.success) {
        await sendText(
            session.sock,
            session.chatId,
            `❌ تعذر إنهاء الطابق.\nالسبب: ${result.reason}`
        );

        return;
    }

    session.battle = null;
    session.currentEnemy = null;
    session.enemyIndex = 0;

    if (result.status === "completed") {
        await finishTower(session);
        return;
    }

    const rewards = result.floorRewards || {};

    await sendText(
        session.sock,
        session.chatId,
        `
╭━━━〔 ✅ تم اجتياز الطابق 〕━━━╮

🏢 الطابق: ${result.floor.number}/100

✨ XP محفوظة كمكافأة معلقة: ${formatNumber(rewards.xp)}
💰 Gold محفوظ كمكافأة معلقة: ${formatNumber(rewards.gold)}

🏆 أعلى طابق: ${result.floor.number}

اكتب:
التالي

للدخول للطابق التالي.

╰━━━━━━━━━━━━━━━━━━╯
`
    );

    session.waitingNextFloor = true;
}


// ==========================================
// NEXT ENEMY
// ==========================================

async function moveToNextEnemy(session) {
    session.enemyIndex++;

    const enemies = session.floor?.enemies || [];

    if (session.enemyIndex >= enemies.length) {
        await finishCurrentFloor(session);
        return;
    }

    const result = startEnemyBattle(session);

    if (!result.success) {
        await sendText(
            session.sock,
            session.chatId,
            `❌ تعذر بدء المعركة التالية.\nالسبب: ${result.reason}`
        );

        return;
    }

    await sendText(
        session.sock,
        session.chatId,
        `
⚔️ تمت هزيمة الوحش السابق!

👾 الوحش التالي:
${getMonsterName(result.enemy)}

❤️ HP: ${formatNumber(result.enemy.hp)}/${formatNumber(result.enemy.maxHp)}

اكتب هجوم للبدء.
`
    );
}


// ==========================================
// BATTLE RESULT
// ==========================================

async function processBattleResult(session, actionResult) {
    if (!actionResult?.success) return;

    const battle = session.battle;

    if (!battle) return;

    saveHunterVitals(
        session.hunter,
        battle
    );

    if (battle.status === "victory") {
        await sendText(
            session.sock,
            session.chatId,
            `
╭━━━〔 ✅ انتصار 〕━━━╮

👾 تمت هزيمة:
${getMonsterName(session.currentEnemy)}

❤️ HP: ${formatNumber(battle.hunter.hp)}
💧 MP: ${formatNumber(battle.hunter.mp)}

╰━━━━━━━━━━━━━━━━━━╯
`
        );

        await moveToNextEnemy(session);
        return;
    }

    if (
        battle.status === "defeat" ||
        safeNumber(battle.hunter?.hp) <= 0
    ) {
        completeTowerFloor(
            session.hunter.id,
            session.towerId,
            false
        );

        session.battle = null;

        await sendText(
            session.sock,
            session.chatId,
            `
╭━━━〔 💀 هزيمة 〕━━━╮

لقد خسرت المعركة!

🏢 الطابق: ${session.floor.number}/100

يمكنك إعادة المحاولة بكتابة:
اعادة

تقدمك السابق محفوظ.
╰━━━━━━━━━━━━━━━━━━╯
`
        );

        return;
    }

    await sendText(
        session.sock,
        session.chatId,
        getCombatText(session)
    );
}


// ==========================================
// BASIC ATTACK
// ==========================================

async function handleBasicAttack(session) {
    if (!session.battle) {
        await sendText(
            session.sock,
            session.chatId,
            "❌ لا توجد معركة نشطة."
        );

        return;
    }

    if (session.waitingNextFloor) {
        await sendText(
            session.sock,
            session.chatId,
            "اكتب التالي للانتقال للطابق القادم."
        );

        return;
    }

    const result = performBasicAttack(
        session.battle,
        "hunter"
    );

    if (!result?.success) {
        await sendText(
            session.sock,
            session.chatId,
            `❌ فشل الهجوم: ${result?.reason || "UNKNOWN"}`
        );

        return;
    }

    await sendText(
        session.sock,
        session.chatId,
        `
⚔️ هجوم الصياد!

${result.hit ? "🎯 أصبت الوحش!" : "💨 الهجوم أخطأ!"}

💥 الضرر: ${formatNumber(result.damage)}
${result.critical ? "🔥 ضربة حرجة!" : ""}

❤️ HP الوحش المتبقي: ${formatNumber(result.remainingHp)}
`
    );

    if (session.battle.status === "ongoing") {
        const enemyResult = performEnemyAttack(
            session.battle
        );

        if (enemyResult?.success) {
            await sendText(
                session.sock,
                session.chatId,
                `
👾 هجوم الوحش!

💥 الضرر: ${formatNumber(enemyResult.damage)}
${enemyResult.critical ? "🔥 ضربة حرجة!" : ""}

❤️ HP الصياد: ${formatNumber(session.battle.hunter.hp)}
`
            );
        }
    }

    if (session.battle.status === "ongoing") {
        advanceBattleTurn(session.battle);
    }

    await processBattleResult(
        session,
        result
    );
}


// ==========================================
// SKILL
// ==========================================

async function handleSkill(session, skillId) {
    if (!session.battle) {
        await sendText(
            session.sock,
            session.chatId,
            "❌ لا توجد معركة نشطة."
        );

        return;
    }

    if (session.waitingNextFloor) {
        await sendText(
            session.sock,
            session.chatId,
            "اكتب التالي للانتقال للطابق القادم."
        );

        return;
    }

    if (!skillId) {
        await sendText(
            session.sock,
            session.chatId,
            "طريقة الاستخدام:\nمهارة fireball"
        );

        return;
    }

    const result = useHunterSkill(
        session.battle,
        skillId
    );

    if (!result?.success) {
        await sendText(
            session.sock,
            session.chatId,
            `❌ تعذر استخدام المهارة.\nالسبب: ${result?.reason || "UNKNOWN"}`
        );

        return;
    }

    await sendText(
        session.sock,
        session.chatId,
        `
╭━━━〔 ✨ استخدام مهارة 〕━━━╮

⚡ المهارة: ${result.skill?.nameAr || result.skill?.name || skillId}

${result.hit ? "🎯 أصابت الهدف!" : "💨 لم تصب الهدف!"}

💥 الضرر: ${formatNumber(result.damage)}
${result.critical ? "🔥 ضربة حرجة!" : ""}

💧 MP المتبقي: ${formatNumber(session.battle.hunter.mp)}

╰━━━━━━━━━━━━━━━━━━╯
`
    );

    if (session.battle.status === "ongoing") {
        const enemyResult = performEnemyAttack(
            session.battle
        );

        if (enemyResult?.success) {
            await sendText(
                session.sock,
                session.chatId,
                `
👾 هجوم الوحش!

💥 الضرر: ${formatNumber(enemyResult.damage)}

❤️ HP الصياد: ${formatNumber(session.battle.hunter.hp)}
`
            );
        }
    }

    if (session.battle.status === "ongoing") {
        advanceBattleTurn(session.battle);
    }

    await processBattleResult(
        session,
        result
    );
}


// ==========================================
// NEXT FLOOR
// ==========================================

async function handleNextFloor(session) {
    if (!session.waitingNextFloor) {
        await sendText(
            session.sock,
            session.chatId,
            "❌ لازم تنهي الطابق الحالي الأول."
        );

        return;
    }

    const hunter = refreshHunter(
        session.hunter
    );

    if (!hunter) {
        await sendText(
            session.sock,
            session.chatId,
            "❌ لم أتمكن من العثور على بيانات الصياد."
        );

        return;
    }

    const result = advanceTowerFloor(
        hunter,
        session.towerId
    );

    if (!result.success) {
        await sendText(
            session.sock,
            session.chatId,
            `❌ تعذر الانتقال للطابق التالي.\nالسبب: ${result.reason}`
        );

        return;
    }

    session.hunter = hunter;
    session.floor = result.floor;
    session.enemyIndex = 0;
    session.waitingNextFloor = false;

    const battle = startEnemyBattle(session);

    if (!battle.success) {
        await sendText(
            session.sock,
            session.chatId,
            `❌ تعذر بدء معركة الطابق.\nالسبب: ${battle.reason}`
        );

        return;
    }

    await sendText(
        session.sock,
        session.chatId,
        buildFloorMessage(session)
    );
}


// ==========================================
// RETRY FLOOR
// ==========================================

async function handleRetryFloor(session) {
    if (session.battle) {
        await sendText(
            session.sock,
            session.chatId,
            "❌ لا يمكنك إعادة الطابق أثناء وجود معركة نشطة."
        );

        return;
    }

    const hunter = refreshHunter(
        session.hunter
    );

    if (!hunter) {
        await sendText(
            session.sock,
            session.chatId,
            "❌ لم أتمكن من العثور على بيانات الصياد."
        );

        return;
    }

    const result = retryTowerFloor(
        hunter,
        session.towerId
    );

    if (!result.success) {
        await sendText(
            session.sock,
            session.chatId,
            `❌ لا يمكن إعادة الطابق.\nالسبب: ${result.reason}`
        );

        return;
    }

    session.hunter = hunter;
    session.floor = result.floor;
    session.enemyIndex = 0;
    session.waitingNextFloor = false;

    const battle = startEnemyBattle(session);

    if (!battle.success) {
        await sendText(
            session.sock,
            session.chatId,
            `❌ تعذر بدء المعركة.\nالسبب: ${battle.reason}`
        );

        return;
    }

    await sendText(
        session.sock,
        session.chatId,
        `
🔁 تمت إعادة الطابق ${session.floor.number}.

${buildFloorMessage(session)}
`
    );
}


// ==========================================
// SESSION COMMAND HANDLER
// ==========================================

async function handleTowerCommand(session, command) {
    const lower = command.trim().toLowerCase();

    if (
        lower === "خروج" ||
        lower === "انهاء" ||
        lower === "إنهاء" ||
        lower === "إلغاء"
    ) {
        leaveTower(
            session.hunter.id,
            session.towerId
        );

        endSession(
            session,
            "🚪 خرجت من البرج.\nتقدمك محفوظ وتقدر ترجع تكمل لاحقًا."
        );

        return;
    }

    if (
        lower === "حالة" ||
        lower === "status"
    ) {
        if (session.battle) {
            await sendText(
                session.sock,
                session.chatId,
                getCombatText(session)
            );
        } else {
            await sendText(
                session.sock,
                session.chatId,
                `
🏰 البرج: ${session.towerName}
📍 الطابق: ${session.floor.number}/100
📌 الحالة: ${session.waitingNextFloor ? "تم اجتياز الطابق" : "استعداد"}
`
            );
        }

        return;
    }

    if (
        lower === "التالي" ||
        lower === "next"
    ) {
        await handleNextFloor(session);
        return;
    }

    if (
        lower === "اعادة" ||
        lower === "إعادة" ||
        lower === "retry"
    ) {
        await handleRetryFloor(session);
        return;
    }

    if (
        lower === "هجوم" ||
        lower === "attack"
    ) {
        await handleBasicAttack(session);
        return;
    }

    if (
        lower.startsWith("مهارة ") ||
        lower.startsWith("skill ")
    ) {
        const skillId = command
            .trim()
            .split(/\s+/)
            .slice(1)
            .join(" ")
            .trim();

        await handleSkill(
            session,
            skillId
        );

        return;
    }

    if (
        lower === "مساعدة" ||
        lower === "help"
    ) {
        await sendText(
            session.sock,
            session.chatId,
            `
╭━━━〔 📖 مساعدة البرج 〕━━━╮

⚔️ هجوم
استخدام هجوم عادي.

✨ مهارة fireball
استخدام مهارة.

📊 حالة
عرض حالة المعركة.

➡️ التالي
الانتقال للطابق القادم.

🔁 اعادة
إعادة الطابق بعد الخسارة.

🚪 خروج
الخروج مع حفظ التقدم.

╰━━━━━━━━━━━━━━━━━━╯
`
        );

        return;
    }

    await sendText(
        session.sock,
        session.chatId,
        "❓ الأمر غير معروف.\nاكتب مساعدة لعرض الأوامر المتاحة."
    );
}


// ==========================================
// START TOWER SESSION
// ==========================================

async function startTowerSession({
    sock,
    msg,
    hunter,
    tower,
    sender
}) {
    const chatId = msg.key.remoteJid;

    const identity = resolveHunterIdentity({
        msg,
        sender
    });

    const key = getSessionKey(
        chatId,
        hunter.id
    );

    const previous = activeSessions.get(key);

    if (previous) {
        endSession(previous);
    }

    const freshHunter = refreshHunter(hunter);

    if (!freshHunter) {
        await sendText(
            sock,
            chatId,
            "❌ لم أتمكن من العثور على بيانات الصياد."
        );

        return;
    }

    const requirement = canEnterTower(
        freshHunter,
        tower.id
    );

    if (!requirement?.allowed) {
        await sendText(
            sock,
            chatId,
            `🔒 لا يمكنك دخول هذا البرج.\nالسبب: ${requirement?.reason || "REQUIREMENTS_NOT_MET"}`
        );

        return;
    }

    const result = enterTower(
        freshHunter,
        tower.id
    );

    if (!result.success) {
        await sendText(
            sock,
            chatId,
            `❌ تعذر دخول البرج.\nالسبب: ${result.reason}`
        );

        return;
    }

    const session = {
        key,
        sock,
        chatId,

        hunter: freshHunter,

        towerId: tower.id,
        towerName: getTowerDisplayName(tower),

        identities: getHunterIdentities(
            identity,
            freshHunter
        ),

        floor: result.floor,

        enemyIndex: 0,
        currentEnemy: null,
        battle: null,

        waitingNextFloor: false,

        listener: null,
        timeout: null,

        ended: false
    };

    activeSessions.set(key, session);

    // تسجيل المستمع قبل إرسال رسالة الدخول.
    registerSessionListener(
        session,
        async (incoming, text) => {
            await handleTowerCommand(
                session,
                text
            );
        }
    );

    resetSessionTimeout(session);

    if (result.floor.status === "cleared") {
        session.waitingNextFloor = true;

        await sendText(
            sock,
            chatId,
            `
🏰 رجعت للبرج بنجاح!

📍 أنت في الطابق ${result.floor.number}/100.

الطابق ده تم اجتيازه بالفعل.
اكتب التالي للانتقال للطابق القادم.
`
        );

        return;
    }

    const battle = startEnemyBattle(session);

    if (!battle.success) {
        endSession(session);

        await sendText(
            sock,
            chatId,
            `❌ تعذر بدء المعركة.\nالسبب: ${battle.reason}`
        );

        return;
    }

    await sendText(
        sock,
        chatId,
        `
🏰 تم دخول البرج بنجاح!

${result.resumed ? "🔄 تم استئناف تقدمك السابق." : "🆕 بدأت رحلة جديدة."}

${buildFloorMessage(session)}
`
    );
}


// ==========================================
// TOWER SELECTION SESSION
// ==========================================

async function startTowerSelection({
    sock,
    msg,
    hunter,
    identity,
    sender
}) {
    const chatId = msg.key.remoteJid;

    const key = getSessionKey(
        chatId,
        hunter.id
    );

    const oldSession = activeSessions.get(key);

    if (oldSession) {
        endSession(oldSession);
    }

    const session = {
        key,
        sock,
        chatId,

        hunter,

        identities: getHunterIdentities(
            identity,
            hunter
        ),

        listener: null,
        timeout: null,

        ended: false
    };

    activeSessions.set(key, session);

    // تسجيل المستمع قبل إرسال القائمة.
    registerSessionListener(
        session,
        async (incoming, selectedInput) => {
            const selectedTower = findTowerByInput(
                selectedInput
            );

            if (!selectedTower) {
                await sendText(
                    sock,
                    chatId,
                    "❌ البرج غير موجود.\nأرسل اسم البرج أو ID صحيح من القائمة."
                );

                return;
            }

            const refreshedHunter = refreshHunter(
                session.hunter
            );

            if (!refreshedHunter) {
                endSession(session);

                await sendText(
                    sock,
                    chatId,
                    "❌ تعذر العثور على بيانات الصياد."
                );

                return;
            }

            endSession(session);

            await startTowerSession({
                sock,
                msg: incoming,
                hunter: refreshedHunter,
                tower: selectedTower,
                sender: null
            });
        }
    );

    resetSessionTimeout(session);

    await sendText(
        sock,
        chatId,
        buildTowerMenu(hunter),
        msg
    );
}


// ==========================================
// PLUGIN
// ==========================================

export const NovaUltra = {
    command: ["برج", "tower"],
    description: "نظام أبراج الصيادين - 100 طابق",
    usage: ".برج [اسم البرج أو ID]",
    elite: "off",
    group: true,
    prv: false,
    lock: "off",
    category: "NOVA"
};


export default {
    NovaUltra,

    async execute({
        sock,
        msg,
        args,
        sender
    }) {
        try {
            const identity = resolveHunterIdentity({
                msg,
                sender
            });

            if (!identity?.primary) {
                return sendText(
                    sock,
                    msg.key.remoteJid,
                    "❌ تعذر تحديد هوية الصياد.",
                    msg
                );
            }

            const hunter = findHunterFromIdentity(
                identity,
                msg,
                sender
            );

            if (!hunter) {
                return sendText(
                    sock,
                    msg.key.remoteJid,
                    "❌ لم أتمكن من العثور على شخصيتك في قاعدة بيانات NOVA.\n\nلو أنت مستيقظ بالفعل، فلا تحتاج إلى الاستيقاظ مرة أخرى.",
                    msg
                );
            }

            const input = Array.isArray(args)
                ? args.join(" ").trim()
                : String(args || "").trim();

            if (!input) {
                await startTowerSelection({
                    sock,
                    msg,
                    hunter,
                    identity,
                    sender
                });

                return;
            }

            const tower = findTowerByInput(input);

            if (!tower) {
                return sendText(
                    sock,
                    msg.key.remoteJid,
                    `❌ البرج "${input}" غير موجود.\nاستخدم .برج لعرض قائمة الأبراج.`,
                    msg
                );
            }

            await startTowerSession({
                sock,
                msg,
                hunter,
                tower,
                sender
            });

        } catch (error) {
            console.error(
                "[NOVA TOWER PLUGIN ERROR]",
                error
            );

            const errorMessage =
                error.message === "HUNTER_IDENTITY_CONFLICT"
                    ? "⚠️ يوجد تعارض بين هويات الصيادين. تم إيقاف العملية لحماية بياناتك."
                    : `❌ حصل خطأ في نظام البرج.\n${error.message}`;

            await sendText(
                sock,
                msg.key.remoteJid,
                errorMessage,
                msg
            );
        }
    }
};
