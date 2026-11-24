import {
    getHunters,
    saveHunters
} from "../../nova/engine/storage.js";

import {
    resolveHunterIdentity,
    addXP
} from "../../nova/engine/PlayerEngine.js";

import {
    getAvailableGates,
    getGateInfo,
    canEnterGate,
    enterGate,
    retryGate,
    leaveGate,
    completeGateWave,
    openGateChest,
    claimGateRewards,
    getActiveGate
} from "../../nova/engine/GateEngine.js";

import {
    createBattle,
    performBasicAttack,
    performEnemyAttack,
    useHunterSkill,
    advanceBattleTurn,
    restoreMana,
    getBattleStatus
} from "../../nova/engine/CombatEngine.js";

import {
    getSkill
} from "../../nova/engine/SkillEngine.js";


const activeSessions = new Map();


// ==========================================
// GENERAL HELPERS
// ==========================================

function getMessageText(message) {
    const content = message?.message;

    return (
        content?.conversation ||
        content?.extendedTextMessage?.text ||
        content?.imageMessage?.caption ||
        content?.videoMessage?.caption ||
        content?.documentMessage?.caption ||
        ""
    ).trim();
}


function normalizeIdentity(value) {
    if (!value) return null;

    let id = String(value).trim();

    if (!id) return null;

    if (
        id.endsWith("@s.whatsapp.net") ||
        id.endsWith("@lid")
    ) {
        return id;
    }

    return `${id}@s.whatsapp.net`;
}


function getSessionKey(chat, identity) {
    return `${chat}:${identity}`;
}


function getMessageIdentity(message) {
    const key = message?.key || {};

    const participant = key.participant;
    const remoteJid = key.remoteJid;

    if (participant) {
        return normalizeIdentity(participant);
    }

    return normalizeIdentity(remoteJid);
}


function formatNumber(number) {
    return Math.floor(
        Number(number) || 0
    ).toLocaleString("en-US");
}


function getHunterName(hunter) {
    return (
        hunter?.name ||
        hunter?.nickname ||
        "الصياد"
    );
}


function getHunterEntry(identity) {
    const hunters = getHunters();

    const pn = normalizeIdentity(identity?.pn);
    const lid = normalizeIdentity(identity?.lid);
    const primary = normalizeIdentity(identity?.primary);

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

    if (matches.length !== 1) {
        return null;
    }

    return matches[0];
}


function getHunter(identity) {
    const entry = getHunterEntry(identity);

    return entry?.hunter || null;
}


function saveHunterVitals(identity, hp, mp) {
    const entry = getHunterEntry(identity);

    if (!entry) {
        return false;
    }

    const hunters = getHunters();

    const hunter = hunters[entry.key];

    if (!hunter) {
        return false;
    }

    hunter.hp = Math.max(
        0,
        Math.min(
            Number(hunter.maxHp) || 999999,
            Number(hp) || 0
        )
    );

    hunter.mp = Math.max(
        0,
        Math.min(
            Number(hunter.maxMp) || 999999,
            Number(mp) || 0
        )
    );

    hunter.lastActive = Date.now();

    saveHunters(hunters);

    return true;
}


function getHunterRank(hunter) {
    return String(
        hunter?.rank ||
        hunter?.hunterRank ||
        "E"
    ).toUpperCase();
}


function getHunterLevel(hunter) {
    return Math.max(
        1,
        Number(hunter?.level) || 1
    );
}


function getRankName(rank) {
    const names = {
        E: "E",
        D: "D",
        C: "C",
        B: "B",
        A: "A",
        S: "S",
        SS: "SS",
        SSS: "SSS",
        NATIONAL: "National"
    };

    return names[rank] || rank;
}


function getGateDifficulty(difficulty) {
    const value = Number(difficulty) || 1;

    if (value <= 0.8) return "سهل";
    if (value <= 1.1) return "عادي";
    if (value <= 1.3) return "صعب";
    if (value <= 1.5) return "خطير";

    return "كارثي";
}


function getReasonText(reason) {
    const reasons = {
        HUNTER_NOT_FOUND: "لم يتم العثور على بيانات الصياد.",
        GATE_NOT_FOUND: "البوابة غير موجودة.",
        LEVEL_TOO_LOW: "مستواك أقل من المستوى المطلوب.",
        LEVEL_TOO_HIGH: "مستواك أعلى من الحد المسموح لهذه البوابة.",
        RANK_TOO_LOW: "رتبتك لا تسمح بدخول هذه البوابة.",
        INVALID_GATE_RANK: "رتبة البوابة غير صحيحة.",
        INVALID_GATE_WAVES: "بيانات موجات البوابة غير صالحة.",
        ANOTHER_GATE_ACTIVE: "لديك بوابة أخرى نشطة بالفعل.",
        GATE_NOT_FAILED: "هذه البوابة ليست في حالة فشل.",
        GATE_PROGRESS_NOT_FOUND: "لا يوجد تقدم محفوظ لهذه البوابة.",
        GATE_NOT_ACTIVE: "البوابة ليست نشطة.",
        WAVE_NOT_FOUND: "لم يتم العثور على الموجة الحالية.",
        WAVE_ALREADY_CLEARED: "تم إنهاء هذه الموجة بالفعل.",
        NO_CHEST_AVAILABLE: "لا يوجد صندوق مكافآت متاح.",
        CHEST_ALREADY_OPENED: "تم فتح الصندوق بالفعل.",
        CHEST_NOT_OPENED: "يجب فتح الصندوق أولًا."
    };

    return reasons[reason] || `حدث خطأ: ${reason || "UNKNOWN"}`;
}


async function sendText(sock, chat, text, quoted = null) {
    return sock.sendMessage(
        chat,
        { text },
        quoted ? { quoted } : {}
    );
}


// ==========================================
// GATE DISPLAY
// ==========================================

function buildGateList(hunter) {
    const gates = getAvailableGates(hunter);

    if (!gates.length) {
        return {
            gates: [],
            text:
                "╭━━━〔 🔰 بوابات NOVA 〕━━━╮\n\n" +
                "لا توجد بوابات متاحة حاليًا.\n" +
                "ارفع مستواك أو رتبتك لفتح بوابات جديدة.\n\n" +
                "╰━━━━━━━━━━━━━━━━━━╯"
        };
    }

    let text =
        "╭━━━〔 🔰 بوابات NOVA 〕━━━╮\n\n";

    gates.forEach((gate, index) => {
        text +=
            `『${index + 1}』 ${gate.nameAr || gate.name}\n` +
            `   الرتبة: ${getRankName(gate.rank)}\n` +
            `   المستوى: ${gate.minLevel} - ${gate.maxLevel || "∞"}\n` +
            `   الصعوبة: ${getGateDifficulty(gate.difficulty)}\n\n`;
    });

    text +=
        "━━━━━━━━━━━━━━━━━━\n" +
        "أرسل رقم البوابة لعرض تفاصيلها.\n" +
        "أو اكتب إحصائياتي لعرض سجلك.";

    return {
        gates,
        text
    };
}


function buildGateDetails(gate) {
    const info = getGateInfo(gate.id);

    if (!info) {
        return "تعذر تحميل بيانات البوابة.";
    }

    return (
        "╭━━━〔 🌀 تفاصيل البوابة 〕━━━╮\n\n" +

        `الاسم: ${info.nameAr || info.name}\n` +
        `الرتبة: ${getRankName(info.rank)}\n` +
        `المستوى: ${info.minLevel} - ${info.maxLevel || "∞"}\n` +
        `الصعوبة: ${getGateDifficulty(info.difficulty)}\n` +
        `عدد الموجات: ${info.totalWaves}\n\n` +

        "〔 المكافآت الأساسية 〕\n" +
        `XP: ${formatNumber(info.rewards.xp)}\n` +
        `Gold: ${formatNumber(info.rewards.gold)}\n` +
        `فرصة الصندوق: ${info.chestChance}%\n\n` +

        "━━━━━━━━━━━━━━━━━━\n" +
        "1 - دخول البوابة\n" +
        "2 - العودة للقائمة\n" +
        "0 - إلغاء"
    );
}


// ==========================================
// BATTLE DISPLAY
// ==========================================

function buildBattleDisplay(session) {
    const battle = session.battle;

    if (!battle) {
        return "لا توجد معركة نشطة.";
    }

    const status = getBattleStatus(battle);

    const monster = session.currentMonster;

    const wave = session.currentWave;

    const hunterHpPercent = Math.floor(
        status.hunter.hp /
        Math.max(1, status.hunter.maxHp) * 100
    );

    const enemyHpPercent = Math.floor(
        status.enemy.hp /
        Math.max(1, status.enemy.maxHp) * 100
    );

    return (
        "╭━━━〔 ⚔️ NOVA COMBAT 〕━━━╮\n\n" +

        `البوابة: ${session.gate.nameAr || session.gate.name}\n` +
        `الموجة: ${wave.index + 1}/${session.progress.totalWaves}\n` +
        `الوحش: ${session.monsterIndex + 1}/${wave.monsters.length}\n\n` +

        "〔 الصياد 〕\n" +
        `${status.hunter.name}\n` +
        `HP: ${formatNumber(status.hunter.hp)}/${formatNumber(status.hunter.maxHp)} (${hunterHpPercent}%)\n` +
        `MP: ${formatNumber(status.hunter.mp)}/${formatNumber(status.hunter.maxMp)}\n\n` +

        "〔 العدو 〕\n" +
        `${monster.nameAr || monster.name}\n` +
        `المستوى: ${monster.level}\n` +
        `HP: ${formatNumber(status.enemy.hp)}/${formatNumber(status.enemy.maxHp)} (${enemyHpPercent}%)\n\n` +

        "━━━━━━━━━━━━━━━━━━\n" +
        "1 - هجوم عادي\n" +
        "2 - استخدام مهارة\n" +
        "3 - استعادة 20 MP\n" +
        "4 - حالة المعركة\n" +
        "0 - مغادرة البوابة"
    );
}


function getLearnedActiveSkills(hunter) {
    if (!Array.isArray(hunter?.skills)) {
        return [];
    }

    return hunter.skills
        .map(skillId => getSkill(skillId))
        .filter(skill => {
            return skill && skill.type === "active";
        });
}


function buildSkillMenu(hunter) {
    const skills = getLearnedActiveSkills(hunter);

    if (!skills.length) {
        return {
            skills: [],
            text: "لا تمتلك مهارات هجومية أو نشطة متاحة."
        };
    }

    let text =
        "╭━━━〔 ✨ مهارات الصياد 〕━━━╮\n\n";

    skills.forEach((skill, index) => {
        text +=
            `${index + 1} - ${skill.nameAr || skill.name}\n` +
            `   MP: ${skill.mpCost || 0}\n` +
            `   Cooldown: ${skill.cooldown || 0}\n\n`;
    });

    text +=
        "━━━━━━━━━━━━━━━━━━\n" +
        "أرسل رقم المهارة.\n" +
        "0 - رجوع للقتال";

    return {
        skills,
        text
    };
}


// ==========================================
// SESSION CLEANUP
// ==========================================

function closeSession(session) {
    if (!session) return;

    if (session.listener) {
        session.sock.ev.off(
            "messages.upsert",
            session.listener
        );

        session.listener = null;
    }

    activeSessions.delete(session.key);
}


// ==========================================
// HUNTER VITALS
// ==========================================

function syncHunterVitals(session) {
    if (!session.battle) {
        return false;
    }

    return saveHunterVitals(
        session.identity,
        session.battle.hunter.hp,
        session.battle.hunter.mp
    );
}


// ==========================================
// BATTLE FLOW
// ==========================================

async function startCurrentMonster(session) {
    const wave = session.currentWave;

    if (!wave || !Array.isArray(wave.monsters)) {
        await sendText(
            session.sock,
            session.chat,
            "تعذر تحميل وحوش الموجة الحالية."
        );

        closeSession(session);

        return;
    }

    while (
        session.monsterIndex < wave.monsters.length &&
        Number(wave.monsters[session.monsterIndex].hp) <= 0
    ) {
        session.monsterIndex++;
    }

    if (session.monsterIndex >= wave.monsters.length) {
        await finishCurrentWave(session);
        return;
    }

    const hunter = getHunter(session.identity);

    if (!hunter) {
        await sendText(
            session.sock,
            session.chat,
            "تعذر العثور على بيانات الصياد."
        );

        closeSession(session);

        return;
    }

    const monster = wave.monsters[session.monsterIndex];

    const result = createBattle(
        hunter,
        monster
    );

    if (!result.success) {
        await sendText(
            session.sock,
            session.chat,
            "تعذر بدء المعركة.\n" +
            `السبب: ${result.reason}`
        );

        closeSession(session);

        return;
    }

    session.battle = result.battle;
    session.currentMonster = monster;
    session.stage = "battle";

    await sendText(
        session.sock,
        session.chat,
        buildBattleDisplay(session)
    );
}


async function finishCurrentWave(session) {
    const result = completeGateWave(
        session.identity.primary,
        session.gate.id,
        true
    );

    if (!result.success) {
        await sendText(
            session.sock,
            session.chat,
            `تعذر إنهاء الموجة.\n${getReasonText(result.reason)}`
        );

        closeSession(session);

        return;
    }

    session.battle = null;

    if (result.completed) {
        session.stage = "rewards";

        let text =
            "╭━━━〔 🏆 اكتملت البوابة 〕━━━╮\n\n" +
            "لقد نجحت في اجتياز جميع موجات البوابة!\n\n" +
            `XP الأساسي: ${formatNumber(result.pendingRewards.xp)}\n` +
            `Gold الأساسي: ${formatNumber(result.pendingRewards.gold)}\n\n`;

        if (result.chestAvailable) {
            text +=
                "🎁 يوجد صندوق مكافآت متاح!\n\n" +
                "1 - فتح الصندوق\n" +
                "0 - إنهاء";
        } else {
            text +=
                "1 - استلام المكافآت\n" +
                "0 - إنهاء";
        }

        await sendText(
            session.sock,
            session.chat,
            text
        );

        return;
    }

    session.currentWave = result.currentWave;

    session.monsterIndex = 0;

    await sendText(
        session.sock,
        session.chat,
        `✅ تم اجتياز الموجة ${result.clearedWave.index + 1}!\n` +
        "استعد للموجة التالية..."
    );

    await startCurrentMonster(session);
}


async function finishBattle(session) {
    const battle = session.battle;

    if (!battle) return;

    syncHunterVitals(session);

    const status = battle.status;

    if (status === "victory") {
        session.currentMonster.hp = 0;
        session.currentMonster.currentHP = 0;

        session.monsterIndex++;

        session.battle = null;

        await sendText(
            session.sock,
            session.chat,
            "✅ تمت هزيمة الوحش!\n" +
            "جارٍ تجهيز المواجهة التالية..."
        );

        await startCurrentMonster(session);

        return;
    }

    if (
        status === "defeat" ||
        status === "draw"
    ) {
        const result = completeGateWave(
            session.identity.primary,
            session.gate.id,
            false
        );

        const hunter = getHunter(session.identity);

        await sendText(
            session.sock,
            session.chat,
            "╭━━━〔 ❌ انتهت الرحلة 〕━━━╮\n\n" +
            (
                status === "draw"
                    ? "انتهت المواجهة بالتعادل."
                    : "لم يتمكن الصياد من إكمال المواجهة."
            ) +
            "\n\n" +
            `HP المتبقي: ${formatNumber(hunter?.hp || 0)}\n` +
            `MP المتبقي: ${formatNumber(hunter?.mp || 0)}\n\n` +
            "يمكنك إعادة المحاولة لاحقًا."
        );

        closeSession(session);

        return;
    }
}


async function processHunterAction(session, actionType, skillId = null) {
    const battle = session.battle;

    if (!battle || battle.status !== "ongoing") {
        return;
    }

    let result;

    if (actionType === "attack") {
        result = performBasicAttack(
            battle,
            "hunter"
        );
    }

    if (actionType === "skill") {
        result = useHunterSkill(
            battle,
            skillId
        );
    }

    if (actionType === "mana") {
        result = restoreMana(
            battle,
            "hunter",
            20
        );
    }

    if (!result?.success) {
        const reasons = {
            BATTLE_NOT_ACTIVE: "المعركة غير نشطة.",
            SKILL_NOT_FOUND: "المهارة غير موجودة.",
            NOT_ACTIVE_SKILL: "هذه ليست مهارة نشطة.",
            SKILL_NOT_LEARNED: "لم تتعلم هذه المهارة.",
            CLASS_NOT_ALLOWED: "فئتك لا تسمح باستخدام هذه المهارة.",
            SKILL_ON_COOLDOWN: `المهارة في فترة انتظار. الأدوار المتبقية: ${result?.remainingTurns || 0}`,
            NOT_ENOUGH_MP: `MP غير كافٍ. المطلوب: ${result?.required || 0}`,
            INVALID_SKILL_POWER: "قوة المهارة غير صالحة."
        };

        await sendText(
            session.sock,
            session.chat,
            reasons[result.reason] || `تعذر تنفيذ الحركة: ${result.reason}`
        );

        return;
    }

    if (battle.status === "ongoing") {
        performEnemyAttack(battle);
    }

    if (battle.status === "ongoing") {
        advanceBattleTurn(battle);
    }

    syncHunterVitals(session);

    if (
        battle.status === "victory" ||
        battle.status === "defeat" ||
        battle.status === "draw"
    ) {
        await finishBattle(session);
        return;
    }

    await sendText(
        session.sock,
        session.chat,
        buildBattleDisplay(session)
    );
}


// ==========================================
// REWARD FLOW
// ==========================================

async function claimRewards(session) {
    const result = claimGateRewards(
        session.identity.primary,
        session.gate.id
    );

    if (!result.success) {
        await sendText(
            session.sock,
            session.chat,
            getReasonText(result.reason)
        );

        return;
    }

    let xpResult = null;

    if (result.rewards.xp > 0) {
        xpResult = addXP(
            session.identity.primary,
            result.rewards.xp
        );
    }

    const entry = getHunterEntry(session.identity);

    if (!entry) {
        await sendText(
            session.sock,
            session.chat,
            "تم تسجيل استلام المكافآت، لكن تعذر الوصول إلى سجل الذهب."
        );

        closeSession(session);

        return;
    }

    const hunters = getHunters();

    const hunter = hunters[entry.key];

    hunter.gold = Math.max(
        0,
        Number(hunter.gold) || 0
    ) + result.rewards.gold;

    saveHunters(hunters);

    const updatedHunter = getHunter(session.identity);

    await sendText(
        session.sock,
        session.chat,
        "╭━━━〔 🎁 مكافآت البوابة 〕━━━╮\n\n" +
        `XP: +${formatNumber(result.rewards.xp)}\n` +
        `Gold: +${formatNumber(result.rewards.gold)}\n\n` +
        `المستوى الحالي: ${updatedHunter?.level || 1}\n` +
        `الذهب الحالي: ${formatNumber(updatedHunter?.gold || 0)}\n\n` +
        (
            xpResult?.levelsGained
                ? `🎉 ارتفع مستواك ${xpResult.levelsGained} مستوى!\n\n`
                : ""
        ) +
        "تم إنهاء رحلة البوابة بنجاح.\n" +
        "╰━━━━━━━━━━━━━━━━━━╯"
    );

    closeSession(session);
}


// ==========================================
// MESSAGE HANDLER
// ==========================================

async function handleSessionMessage(session, message) {
    const text = getMessageText(message);

    if (!text) return;

    const input = text.trim();

    const lower = input.toLowerCase();

    if (
        lower === "الغاء" ||
        lower === "إلغاء" ||
        lower === "cancel"
    ) {
        await sendText(
            session.sock,
            session.chat,
            "تم إلغاء التفاعل."
        );

        closeSession(session);

        return;
    }

    // --------------------------------------
    // GATE LIST
    // --------------------------------------

    if (session.stage === "gate_list") {
        const number = Number(input);

        if (
            !Number.isInteger(number) ||
            number < 1 ||
            number > session.gates.length
        ) {
            if (
                lower === "إحصائياتي" ||
                lower === "احصائياتي"
            ) {
                await sendText(
                    session.sock,
                    session.chat,
                    "إحصائيات البوابات متاحة من المحرك، وسيتم إضافتها في واجهة مستقلة."
                );

                return;
            }

            await sendText(
                session.sock,
                session.chat,
                "اختار رقم بوابة صحيح."
            );

            return;
        }

        const gate = session.gates[number - 1];

        session.gate = gate;
        session.stage = "gate_details";

        await sendText(
            session.sock,
            session.chat,
            buildGateDetails(gate)
        );

        return;
    }

    // --------------------------------------
    // GATE DETAILS
    // --------------------------------------

    if (session.stage === "gate_details") {
        if (input === "2" || lower === "رجوع") {
            session.stage = "gate_list";

            const list = buildGateList(
                getHunter(session.identity)
            );

            session.gates = list.gates;

            await sendText(
                session.sock,
                session.chat,
                list.text
            );

            return;
        }

        if (input === "0") {
            closeSession(session);
            return;
        }

        if (
            input !== "1" &&
            lower !== "دخول"
        ) {
            await sendText(
                session.sock,
                session.chat,
                "أرسل 1 للدخول أو 2 للعودة."
            );

            return;
        }

        const hunter = getHunter(session.identity);

        const requirement = canEnterGate(
            hunter,
            session.gate.id
        );

        if (!requirement.allowed) {
            await sendText(
                session.sock,
                session.chat,
                getReasonText(requirement.reason)
            );

            closeSession(session);

            return;
        }

        let result;

        try {
            result = enterGate(
                session.identity.primary,
                hunter,
                session.gate.id
            );
        } catch (error) {
            await sendText(
                session.sock,
                session.chat,
                `تعذر دخول البوابة:\n${error.message}`
            );

            closeSession(session);

            return;
        }

        if (!result.success) {
            await sendText(
                session.sock,
                session.chat,
                getReasonText(result.reason)
            );

            closeSession(session);

            return;
        }

        session.progress = result.progress;
        session.currentWave = result.currentWave;
        session.monsterIndex = 0;

        session.stage = "battle";

        await sendText(
            session.sock,
            session.chat,
            result.resumed
                ? "تم استكمال رحلتك السابقة من الموجة المحفوظة."
                : "تم دخول البوابة بنجاح!\nاستعد للمواجهة الأولى."
        );

        await startCurrentMonster(session);

        return;
    }

    // --------------------------------------
    // BATTLE
    // --------------------------------------

    if (session.stage === "battle") {
        if (input === "0" || lower === "مغادرة") {
            leaveGate(
                session.identity.primary,
                session.gate.id
            );

            syncHunterVitals(session);

            await sendText(
                session.sock,
                session.chat,
                "تمت مغادرة البوابة.\nتقدمك في الموجات محفوظ."
            );

            closeSession(session);

            return;
        }

        if (input === "1" || lower === "هجوم") {
            await processHunterAction(
                session,
                "attack"
            );

            return;
        }

        if (input === "2" || lower === "مهارة") {
            const hunter = getHunter(session.identity);

            const menu = buildSkillMenu(hunter);

            if (!menu.skills.length) {
                await sendText(
                    session.sock,
                    session.chat,
                    menu.text
                );

                return;
            }

            session.skills = menu.skills;
            session.stage = "skill_list";

            await sendText(
                session.sock,
                session.chat,
                menu.text
            );

            return;
        }

        if (input === "3" || lower === "مانا") {
            await processHunterAction(
                session,
                "mana"
            );

            return;
        }

        if (input === "4" || lower === "حالة") {
            await sendText(
                session.sock,
                session.chat,
                buildBattleDisplay(session)
            );

            return;
        }

        await sendText(
            session.sock,
            session.chat,
            "اختار حركة صحيحة من القائمة."
        );

        return;
    }

    // --------------------------------------
    // SKILL LIST
    // --------------------------------------

    if (session.stage === "skill_list") {
        if (input === "0" || lower === "رجوع") {
            session.stage = "battle";

            await sendText(
                session.sock,
                session.chat,
                buildBattleDisplay(session)
            );

            return;
        }

        const number = Number(input);

        if (
            !Number.isInteger(number) ||
            number < 1 ||
            number > session.skills.length
        ) {
            await sendText(
                session.sock,
                session.chat,
                "اختار رقم مهارة صحيح."
            );

            return;
        }

        const skill = session.skills[number - 1];

        session.stage = "battle";

        await processHunterAction(
            session,
            "skill",
            skill.id
        );

        return;
    }

    // --------------------------------------
    // REWARDS
    // --------------------------------------

    if (session.stage === "rewards") {
        if (input === "0") {
            closeSession(session);
            return;
        }

        if (input !== "1") {
            await sendText(
                session.sock,
                session.chat,
                "أرسل 1 للمتابعة أو 0 للإنهاء."
            );

            return;
        }

        const progress = session.progress;

        if (
            progress.chest?.available &&
            !progress.chest.opened
        ) {
            const chestResult = openGateChest(
                session.identity.primary,
                session.gate.id
            );

            if (!chestResult.success) {
                await sendText(
                    session.sock,
                    session.chat,
                    getReasonText(chestResult.reason)
                );

                return;
            }

            await sendText(
                session.sock,
                session.chat,
                "╭━━━〔 🎁 صندوق المكافآت 〕━━━╮\n\n" +
                `الصندوق: ${chestResult.chest.nameAr}\n\n` +
                `XP إضافي: +${formatNumber(chestResult.rewards.xp)}\n` +
                `Gold إضافي: +${formatNumber(chestResult.rewards.gold)}\n\n` +
                "أرسل 1 لاستلام كل المكافآت."
            );

            session.progress.chest.opened = true;

            return;
        }

        await claimRewards(session);

        return;
    }
}


// ==========================================
// PLUGIN
// ==========================================

export const NovaUltra = {
    command: ["بوابات", "البوابات"],
    description: "استكشاف بوابات الصيادين وخوض المواجهات",
    usage: ".بوابات",
    elite: "off",
    group: true,
    prv: false,
    lock: "off",
    category: "NOVA"
};


export default {
    NovaUltra,

    async execute({ sock, msg, args, BIDS, sender }) {
        const identity = resolveHunterIdentity({
            msg,
            sender
        });

        if (!identity?.primary) {
            return sock.sendMessage(
                msg.chat,
                {
                    text: "تعذر تحديد هوية الصياد."
                },
                {
                    quoted: msg
                }
            );
        }

        const hunter = getHunter(identity);

        if (!hunter) {
            return sock.sendMessage(
                msg.chat,
                {
                    text:
                        "لم يتم العثور على ملف صيادك.\n" +
                        "استخدم أمر التسجيل أو الاستيقاظ أولًا."
                },
                {
                    quoted: msg
                }
            );
        }

        const chat = msg.chat;

        const key = getSessionKey(
            chat,
            identity.primary
        );

        if (activeSessions.has(key)) {
            return sock.sendMessage(
                chat,
                {
                    text: "لديك تفاعل بوابة مفتوح بالفعل. أكمل الاختيارات الحالية."
                },
                {
                    quoted: msg
                }
            );
        }

        const list = buildGateList(hunter);

        if (!list.gates.length) {
            return sock.sendMessage(
                chat,
                {
                    text: list.text
                },
                {
                    quoted: msg
                }
            );
        }

        const session = {
            key,

            sock,
            chat,

            identity,

            hunter,

            gates: list.gates,

            gate: null,

            progress: null,

            currentWave: null,

            monsterIndex: 0,

            currentMonster: null,

            battle: null,

            skills: [],

            stage: "gate_list",

            listener: null
        };

        session.listener = async update => {
            if (update.type !== "notify") {
                return;
            }

            for (const incoming of update.messages || []) {
                if (!incoming?.message) continue;

                if (incoming.key?.fromMe) continue;

                if (
                    incoming.key?.remoteJid !== chat
                ) {
                    continue;
                }

                const incomingIdentity = getMessageIdentity(
                    incoming
                );

                const sameIdentity = (
                    incomingIdentity === normalizeIdentity(identity.pn) ||
                    incomingIdentity === normalizeIdentity(identity.lid) ||
                    incomingIdentity === normalizeIdentity(identity.primary)
                );

                if (!sameIdentity) {
                    continue;
                }

                try {
                    await handleSessionMessage(
                        session,
                        incoming
                    );
                } catch (error) {
                    await sendText(
                        sock,
                        chat,
                        `حدث خطأ أثناء تنفيذ الاختيار:\n${error.message}`
                    );

                    closeSession(session);
                }
            }
        };

        activeSessions.set(key, session);

        sock.ev.on(
            "messages.upsert",
            session.listener
        );

        await sock.sendMessage(
            chat,
            {
                text:
                    `الصياد: ${getHunterName(hunter)}\n` +
                    `المستوى: ${getHunterLevel(hunter)}\n` +
                    `الرتبة: ${getHunterRank(hunter)}\n\n` +
                    list.text
            },
            {
                quoted: msg
            }
        );
    }
};
