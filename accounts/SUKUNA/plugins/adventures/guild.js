import {
    resolveHunterIdentity,
    getHunterByIdentity
} from "../../nova/engine/PlayerEngine.js";

import {
    getGuildConfig,
    getGuilds,
    getGuildByHunter,
    getHunterGuildInfo,
    getGuildStatistics,
    createGuild,
    inviteHunter,
    acceptGuildInvitation,
    declineGuildInvitation,
    leaveGuild,
    kickGuildMember,
    setGuildMemberRank,
    transferGuildLeadership,
    updateGuildDescription,
    disbandGuild
} from "../../nova/engine/GuildEngine.js";


export const NovaUltra = {
    command: "نقابة",
    description: "إدارة النقابات بنظام القوائم التفاعلية",
    usage: ".نقابة",
    elite: "off",
    group: true,
    prv: false,
    lock: "off",
    category: "NOVA"
};


const activeSessions = new Map();

const SESSION_TIMEOUT = 180000;


const ARABIC_NUMBERS = {
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9"
};


function normalizeText(value) {
    return String(value || "")
        .trim()
        .replace(/[٠-٩]/g, digit => ARABIC_NUMBERS[digit])
        .replace(/\s+/g, " ")
        .toLowerCase();
}


function normalizeJid(value) {
    if (typeof value !== "string") return "";

    return value
        .trim()
        .split(":")[0]
        .toLowerCase();
}


function unwrapMessage(message) {
    let current = message;

    while (current) {
        const next =
            current.ephemeralMessage?.message ||
            current.viewOnceMessage?.message ||
            current.viewOnceMessageV2?.message ||
            current.documentWithCaptionMessage?.message;

        if (!next) break;

        current = next;
    }

    return current || {};
}


function getMessageText(msg) {
    const message = unwrapMessage(msg?.message);

    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        ""
    );
}


function getMentions(msg) {
    const message = unwrapMessage(msg?.message);

    const context =
        message.extendedTextMessage?.contextInfo ||
        message.imageMessage?.contextInfo ||
        message.videoMessage?.contextInfo ||
        {};

    return Array.isArray(context.mentionedJid)
        ? context.mentionedJid
        : [];
}


function getIdentity(msg, sender) {
    const result = resolveHunterIdentity({
        msg,
        sender
    });

    return {
        pn: result?.pn || null,
        lid: result?.lid || null,
        primary: result?.primary || null
    };
}


function sameIdentity(first, second) {
    const a = [
        first?.pn,
        first?.lid,
        first?.primary
    ]
        .map(normalizeJid)
        .filter(Boolean);

    const b = [
        second?.pn,
        second?.lid,
        second?.primary
    ]
        .map(normalizeJid)
        .filter(Boolean);

    return a.some(value => b.includes(value));
}


function getSessionKey(chatId, identity) {
    return `${chatId}:${identity.primary}`;
}


function clearSession(session) {
    if (!session) return;

    if (session.timeout) {
        clearTimeout(session.timeout);
    }

    if (session.listener) {
        session.sock.ev.off(
            "messages.upsert",
            session.listener
        );
    }

    activeSessions.delete(session.key);
}


function refreshTimeout(session) {
    if (session.timeout) {
        clearTimeout(session.timeout);
    }

    session.timeout = setTimeout(() => {
        clearSession(session);

        session.sock.sendMessage(
            session.chatId,
            {
                text: "⌛ انتهت جلسة النقابة بسبب عدم التفاعل."
            }
        ).catch(() => {});
    }, SESSION_TIMEOUT);
}


async function send(session, text) {
    await session.sock.sendMessage(
        session.chatId,
        {
            text
        },
        {
            quoted: session.lastMessage
        }
    );
}


function menu(title, content) {
    return [
        `╭━━━「 ${title} 」━━━╮`,
        "",
        content,
        "",
        "╰━━━━━━━━━━━━━━━━━━╯",
        "",
        "↳ اكتب رقم الاختيار أو اسمه بالعربي.",
        "↳ للرجوع اكتب: رجوع",
        "↳ لإنهاء الجلسة اكتب: إلغاء"
    ].join("\n");
}


function getHunterId(identity) {
    const hunter = getHunterByIdentity(identity);

    return hunter?.id || null;
}


function getRankName(rank) {
    const ranks = {
        master: "قائد النقابة",
        vice: "نائب القائد",
        officer: "مسؤول",
        elite: "عضو نخبة",
        member: "عضو"
    };

    return ranks[rank] || "غير معروف";
}


function getErrorText(reason) {
    const errors = {
        INVALID_IDENTITY: "تعذر تحديد هوية الصياد.",
        HUNTER_NOT_FOUND: "الصياد غير مسجل في NOVA.",
        HUNTER_IDENTITY_CONFLICT: "يوجد تعارض في هوية الصياد.",

        GUILD_SYSTEM_DISABLED: "نظام النقابات متوقف حاليًا.",
        ALREADY_IN_GUILD: "أنت عضو بالفعل في نقابة.",
        NOT_IN_GUILD: "أنت لست عضوًا في نقابة.",

        LEVEL_TOO_LOW: "مستواك أقل من المستوى المطلوب لإنشاء نقابة.",
        NOT_ENOUGH_GOLD: "الذهب غير كافٍ لإنشاء النقابة.",

        INVALID_GUILD_NAME: "اسم النقابة غير صالح.",
        INVALID_GUILD_NAME_LENGTH: "طول اسم النقابة غير مناسب.",
        INVALID_GUILD_NAME_CHARACTERS: "اسم النقابة يحتوي على رموز غير مسموحة.",
        GUILD_NAME_TAKEN: "اسم النقابة مستخدم بالفعل.",

        DESCRIPTION_TOO_LONG: "الوصف أطول من 300 حرف.",

        GOLD_SAVE_FAILED: "فشل حفظ الذهب.",
        GUILD_SAVE_FAILED: "فشل حفظ بيانات النقابة.",

        GUILD_NOT_FOUND: "النقابة غير موجودة.",
        NO_PERMISSION: "لا تمتلك صلاحية تنفيذ العملية.",

        TARGET_ALREADY_IN_GUILD: "الصياد عضو بالفعل في نقابة أخرى.",
        TARGET_NOT_MEMBER: "هذا الصياد ليس عضوًا في نقابتك.",

        GUILD_FULL: "النقابة وصلت للحد الأقصى للأعضاء.",

        INVITATION_NOT_FOUND: "لا توجد دعوة صالحة.",
        INVITATION_EXPIRED: "انتهت صلاحية الدعوة.",

        MASTER_CANNOT_LEAVE: "لا يستطيع القائد مغادرة النقابة قبل نقل القيادة.",

        CANNOT_KICK_MASTER: "لا يمكن طرد قائد النقابة.",
        TARGET_RANK_TOO_HIGH: "رتبة العضو أعلى من رتبتك أو مساوية لها.",

        INVALID_RANK: "الرتبة المحددة غير صالحة.",
        OFFICER_LIMIT_REACHED: "وصلت النقابة للحد الأقصى للمناصب الإدارية."
    };

    return errors[reason] || `حدث خطأ أثناء تنفيذ العملية.\nالسبب: ${reason || "UNKNOWN"}`;
}


function getResultMessage(result, successMessage) {
    if (!result?.success) {
        return `❌ ${getErrorText(result?.reason)}`;
    }

    return `✅ ${successMessage}`;
}


function getGuildMemberEntries(guild) {
    return Object.entries(guild?.members || {});
}


function findOption(text, options) {
    const value = normalizeText(text);

    if (!value) return null;

    const number = Number(value);

    if (
        Number.isInteger(number) &&
        number >= 1 &&
        number <= options.length
    ) {
        return options[number - 1];
    }

    return options.find(option =>
        option.aliases?.some(alias =>
            normalizeText(alias) === value
        )
    ) || null;
}


function getGuildForHunter(identity) {
    return getGuildByHunter(identity);
}


// ==========================================
// MAIN MENU
// ==========================================

async function showMain(session) {
    session.state = "main";

    const info = getHunterGuildInfo(session.identity);

    if (!info.success) {
        await send(
            session,
            `❌ ${getErrorText(info.reason)}`
        );
        return;
    }

    const content = [
        "1 - نقابتي",
        "2 - إنشاء نقابة",
        "3 - استكشاف النقابات",
        "4 - الدعوات",
        "5 - معلومات النظام"
    ].join("\n");

    await send(
        session,
        menu("نظام النقابات", content)
    );
}


// ==========================================
// MY GUILD
// ==========================================

async function showMyGuild(session) {
    const info = getHunterGuildInfo(session.identity);

    if (!info.success) {
        await send(session, `❌ ${getErrorText(info.reason)}`);
        return;
    }

    if (!info.inGuild) {
        await send(
            session,
            "❌ أنت لست عضوًا في أي نقابة حاليًا."
        );
        await showMain(session);
        return;
    }

    session.guildId = info.guild.id;
    session.state = "myGuild";

    const guild = info.guild;
    const stats = getGuildStatistics(guild.id);

    const content = [
        `🏰 النقابة: ${guild.name}`,
        `⭐ المستوى: ${guild.level}`,
        `👥 الأعضاء: ${stats?.memberCount || 0}/${stats?.maximumMembers || 0}`,
        `👑 القائد: ${guild.members[guild.masterId]?.name || "غير معروف"}`,
        "",
        "1 - معلومات النقابة",
        "2 - قائمة الأعضاء",
        "3 - دعوة صياد",
        "4 - تعديل الوصف",
        "5 - إدارة الأعضاء",
        "6 - مغادرة النقابة",
        "7 - حل النقابة",
        "8 - القائمة الرئيسية"
    ].join("\n");

    await send(
        session,
        menu("نقابتي", content)
    );
}


// ==========================================
// GUILD INFORMATION
// ==========================================

async function showGuildInfo(session) {
    const guild = getGuildForHunter(session.identity);

    if (!guild) {
        await send(session, "❌ لم يتم العثور على نقابتك.");
        return showMain(session);
    }

    const stats = getGuildStatistics(guild.id);

    const createdAt = guild.createdAt
        ? new Date(guild.createdAt).toLocaleDateString("ar-EG")
        : "غير معروف";

    const content = [
        `🏰 الاسم: ${guild.name}`,
        `📝 الوصف: ${guild.description || "لا يوجد وصف"}`,
        `⭐ المستوى: ${guild.level}`,
        `✨ الخبرة: ${guild.experience}`,
        `💰 خزينة النقابة: ${guild.gold}`,
        `👥 الأعضاء: ${stats?.memberCount || 0}`,
        `📅 تاريخ الإنشاء: ${createdAt}`,
        "",
        "↳ اكتب رجوع للعودة."
    ].join("\n");

    session.state = "guildInfo";

    await send(
        session,
        menu("معلومات النقابة", content)
    );
}


// ==========================================
// MEMBERS
// ==========================================

async function showMembers(session) {
    const guild = getGuildForHunter(session.identity);

    if (!guild) {
        await send(session, "❌ لم يتم العثور على نقابتك.");
        return showMain(session);
    }

    const members = getGuildMemberEntries(guild);

    let content = `👥 عدد الأعضاء: ${members.length}\n\n`;

    members.forEach(([hunterId, member], index) => {
        content += [
            `${index + 1} - ${member.name || "صياد"}`,
            `   الرتبة: ${getRankName(member.rank)}`,
            `   المساهمة: ${member.contribution || 0}`,
            ""
        ].join("\n");
    });

    session.memberEntries = members;
    session.state = "members";

    await send(
        session,
        menu("أعضاء النقابة", content)
    );
}


// ==========================================
// CREATE GUILD
// ==========================================

async function startCreateGuild(session) {
    const info = getHunterGuildInfo(session.identity);

    if (!info.success) {
        await send(session, `❌ ${getErrorText(info.reason)}`);
        return showMain(session);
    }

    if (info.inGuild) {
        await send(session, "❌ أنت عضو بالفعل في نقابة.");
        return showMain(session);
    }

    const config = getGuildConfig();

    session.state = "createName";

    await send(
        session,
        menu(
            "إنشاء نقابة",
            [
                `💰 تكلفة الإنشاء: ${config.settings.creationCost}`,
                `⭐ المستوى المطلوب: ${config.settings.minimumLevel}`,
                "",
                "↳ أرسل اسم النقابة الآن."
            ].join("\n")
        )
    );
}


// ==========================================
// EXPLORE GUILDS
// ==========================================

async function showExplore(session) {
    const guilds = getGuilds();

    if (!guilds.length) {
        await send(
            session,
            "لا توجد نقابات مسجلة في الوقت الحالي."
        );
        return showMain(session);
    }

    session.exploreGuilds = guilds.slice(0, 10);
    session.state = "explore";

    let content = "";

    session.exploreGuilds.forEach((guild, index) => {
        const count = Object.keys(guild.members || {}).length;

        content += [
            `${index + 1} - ${guild.name}`,
            `   المستوى: ${guild.level}`,
            `   الأعضاء: ${count}`,
            ""
        ].join("\n");
    });

    content += "↳ أرسل رقم النقابة لعرض تفاصيلها.";

    await send(
        session,
        menu("استكشاف النقابات", content)
    );
}


async function showExploreDetails(session, guild) {
    if (!guild) {
        await send(session, "❌ النقابة غير موجودة.");
        return showExplore(session);
    }

    session.selectedGuildId = guild.id;
    session.state = "exploreDetails";

    const count = Object.keys(guild.members || {}).length;

    const content = [
        `🏰 الاسم: ${guild.name}`,
        `📝 الوصف: ${guild.description || "لا يوجد وصف"}`,
        `⭐ المستوى: ${guild.level}`,
        `👥 الأعضاء: ${count}`,
        "",
        "1 - عرض الأعضاء",
        "2 - رجوع"
    ].join("\n");

    await send(
        session,
        menu("تفاصيل النقابة", content)
    );
}


// ==========================================
// INVITATIONS
// ==========================================

async function showInvitations(session) {
    const hunterId = getHunterId(session.identity);

    if (!hunterId) {
        await send(session, "❌ لم يتم العثور على بيانات الصياد.");
        return showMain(session);
    }

    const guilds = getGuilds();

    const invitations = [];

    for (const guild of guilds) {
        const invitation = guild.invitations?.[hunterId];

        if (!invitation) continue;

        if (Date.now() > invitation.expiresAt) continue;

        invitations.push({
            guild,
            invitation
        });
    }

    if (!invitations.length) {
        await send(
            session,
            "📭 لا توجد دعوات نقابة متاحة لك حاليًا."
        );
        return showMain(session);
    }

    session.invitations = invitations;
    session.state = "invitations";

    let content = "";

    invitations.forEach((entry, index) => {
        content += [
            `${index + 1} - ${entry.guild.name}`,
            `   الداعي: ${entry.invitation.invitedBy}`,
            ""
        ].join("\n");
    });

    content += "↳ أرسل رقم الدعوة لعرض خياراتها.";

    await send(
        session,
        menu("دعوات النقابات", content)
    );
}


async function showInvitationDetails(session, index) {
    const entry = session.invitations?.[index];

    if (!entry) {
        await send(session, "❌ الدعوة غير موجودة.");
        return showInvitations(session);
    }

    session.selectedInvitation = entry;
    session.state = "invitationDetails";

    await send(
        session,
        menu(
            "دعوة نقابة",
            [
                `🏰 النقابة: ${entry.guild.name}`,
                `📝 الوصف: ${entry.guild.description || "لا يوجد وصف"}`,
                "",
                "1 - قبول الدعوة",
                "2 - رفض الدعوة"
            ].join("\n")
        )
    );
}


// ==========================================
// MANAGEMENT MENU
// ==========================================

async function showManagement(session) {
    session.state = "management";

    const content = [
        "1 - دعوة عضو",
        "2 - طرد عضو",
        "3 - تغيير رتبة عضو",
        "4 - نقل القيادة",
        "5 - تعديل الوصف",
        "6 - رجوع"
    ].join("\n");

    await send(
        session,
        menu("إدارة النقابة", content)
    );
}


// ==========================================
// SELECT MEMBER
// ==========================================

async function selectMember(session, action) {
    const guild = getGuildForHunter(session.identity);

    if (!guild) {
        await send(session, "❌ لم يتم العثور على نقابتك.");
        return showMain(session);
    }

    const members = getGuildMemberEntries(guild)
        .filter(([hunterId]) => hunterId !== getHunterId(session.identity));

    if (!members.length) {
        await send(session, "❌ لا يوجد أعضاء آخرون في النقابة.");
        return showManagement(session);
    }

    session.targetMembers = members;
    session.memberAction = action;
    session.state = "selectMember";

    let content = "";

    members.forEach(([hunterId, member], index) => {
        content += [
            `${index + 1} - ${member.name || "صياد"}`,
            `   الرتبة: ${getRankName(member.rank)}`,
            ""
        ].join("\n");
    });

    content += "↳ أرسل رقم العضو.";

    await send(
        session,
        menu("اختيار عضو", content)
    );
}


// ==========================================
// INVITE
// ==========================================

async function startInvite(session) {
    session.state = "inviteTarget";

    await send(
        session,
        menu(
            "دعوة صياد",
            [
                "↳ قم بعمل منشن للصياد الذي تريد دعوته.",
                "",
                "أو أرسل رقم هاتفه مع مفتاح الدولة.",
                "",
                "مثال: 201000000000"
            ].join("\n")
        )
    );
}


// ==========================================
// DESCRIPTION
// ==========================================

async function startDescription(session) {
    session.state = "description";

    await send(
        session,
        menu(
            "تعديل الوصف",
            "↳ أرسل الوصف الجديد للنقابة.\n↳ الحد الأقصى 300 حرف."
        )
    );
}


// ==========================================
// LEAVE / DISBAND
// ==========================================

async function confirmAction(session, action) {
    session.confirmAction = action;
    session.state = "confirm";

    const descriptions = {
        leave: "هل أنت متأكد أنك تريد مغادرة النقابة؟",
        disband: "هل أنت متأكد أنك تريد حل النقابة نهائيًا؟"
    };

    await send(
        session,
        menu(
            "تأكيد العملية",
            [
                descriptions[action],
                "",
                "1 - تأكيد",
                "2 - إلغاء العملية"
            ].join("\n")
        )
    );
}


// ==========================================
// RANK SELECTION
// ==========================================

async function showRanks(session) {
    session.state = "selectRank";

    const content = [
        "1 - نائب القائد",
        "2 - مسؤول",
        "3 - عضو نخبة",
        "4 - عضو"
    ].join("\n");

    await send(
        session,
        menu("اختيار الرتبة", content)
    );
}


// ==========================================
// PROCESS INPUT
// ==========================================

async function processInput(session, incomingMsg) {
    session.lastMessage = incomingMsg;

    const text = normalizeText(getMessageText(incomingMsg));

    if (!text && !getMentions(incomingMsg).length) {
        return;
    }

    if (
        text === "إلغاء" ||
        text === "الغاء" ||
        text === "انهاء" ||
        text === "إنهاء"
    ) {
        await send(session, "تم إلغاء جلسة النقابة.");
        clearSession(session);
        return;
    }

    if (
        text === "رجوع" ||
        text === "عودة" ||
        text === "القائمة"
    ) {
        switch (session.state) {
            case "main":
                return showMain(session);

            case "myGuild":
            case "explore":
            case "invitations":
                return showMain(session);

            case "guildInfo":
            case "members":
            case "management":
                return showMyGuild(session);

            case "exploreDetails":
                return showExplore(session);

            case "invitationDetails":
                return showInvitations(session);

            case "createName":
            case "createDescription":
                return showMain(session);

            case "inviteTarget":
            case "description":
            case "selectMember":
            case "selectRank":
                return showManagement(session);

            case "confirm":
                if (session.confirmAction === "leave" ||
                    session.confirmAction === "disband") {
                    return showMyGuild(session);
                }

                return showManagement(session);

            default:
                return showMain(session);
        }
    }


    // ======================================
    // MAIN
    // ======================================

    if (session.state === "main") {
        const options = [
            {
                id: "myGuild",
                aliases: ["نقابتي", "نقابة", "1"]
            },
            {
                id: "create",
                aliases: ["إنشاء نقابة", "انشاء نقابة", "إنشاء", "2"]
            },
            {
                id: "explore",
                aliases: ["استكشاف النقابات", "استكشاف", "النقابات", "3"]
            },
            {
                id: "invitations",
                aliases: ["الدعوات", "دعوات", "4"]
            },
            {
                id: "help",
                aliases: ["معلومات النظام", "مساعدة", "5"]
            }
        ];

        const selected = findOption(text, options);

        if (!selected) {
            await send(session, "❌ اختيار غير صحيح. اكتب رقمًا أو اسم الاختيار.");
            return showMain(session);
        }

        if (selected.id === "myGuild") {
            return showMyGuild(session);
        }

        if (selected.id === "create") {
            return startCreateGuild(session);
        }

        if (selected.id === "explore") {
            return showExplore(session);
        }

        if (selected.id === "invitations") {
            return showInvitations(session);
        }

        if (selected.id === "help") {
            await send(
                session,
                menu(
                    "مساعدة النقابات",
                    [
                        "نظام النقابات يسمح للصيادين بإنشاء نقابات والانضمام إليها.",
                        "",
                        "• إنشاء نقابة يتطلب مستوى وذهب.",
                        "• يمكن للقادة دعوة الصيادين.",
                        "• يمكن إدارة الأعضاء والرتب.",
                        "• لكل نقابة مستوى وخبرة وخزينة."
                    ].join("\n")
                )
            );

            return;
        }
    }


    // ======================================
    // MY GUILD
    // ======================================

    if (session.state === "myGuild") {
        const options = [
            { id: "info", aliases: ["1", "معلومات النقابة", "معلومات"] },
            { id: "members", aliases: ["2", "قائمة الأعضاء", "الأعضاء", "اعضاء"] },
            { id: "invite", aliases: ["3", "دعوة صياد", "دعوة"] },
            { id: "description", aliases: ["4", "تعديل الوصف", "الوصف"] },
            { id: "management", aliases: ["5", "إدارة الأعضاء", "الإدارة", "ادارة"] },
            { id: "leave", aliases: ["6", "مغادرة النقابة", "مغادرة"] },
            { id: "disband", aliases: ["7", "حل النقابة", "حل"] },
            { id: "main", aliases: ["8", "القائمة الرئيسية", "الرئيسية"] }
        ];

        const selected = findOption(text, options);

        if (!selected) {
            await send(session, "❌ اختيار غير صحيح.");
            return showMyGuild(session);
        }

        switch (selected.id) {
            case "info":
                return showGuildInfo(session);

            case "members":
                return showMembers(session);

            case "invite":
                return startInvite(session);

            case "description":
                return startDescription(session);

            case "management":
                return showManagement(session);

            case "leave":
                return confirmAction(session, "leave");

            case "disband":
                return confirmAction(session, "disband");

            case "main":
                return showMain(session);
        }
    }


    // ======================================
    // GUILD INFO
    // ======================================

    if (session.state === "guildInfo") {
        return showMyGuild(session);
    }


    // ======================================
    // MEMBERS
    // ======================================

    if (session.state === "members") {
        return showMyGuild(session);
    }


    // ======================================
    // CREATE NAME
    // ======================================

    if (session.state === "createName") {
        if (!text) {
            await send(session, "❌ أرسل اسمًا صالحًا للنقابة.");
            return;
        }

        session.guildName = text;
        session.state = "createDescription";

        await send(
            session,
            menu(
                "وصف النقابة",
                [
                    "↳ أرسل وصف النقابة.",
                    "",
                    "أو اكتب تخطي لإنشاء النقابة بدون وصف."
                ].join("\n")
            )
        );

        return;
    }


    // ======================================
    // CREATE DESCRIPTION
    // ======================================

    if (session.state === "createDescription") {
        const description = [
            "تخطي",
            "تخطي الوصف",
            "بدون"
        ].includes(text)
            ? ""
            : getMessageText(incomingMsg).trim();

        const result = createGuild(
            session.identity,
            session.guildName,
            description
        );

        if (!result.success) {
            await send(
                session,
                `❌ ${getErrorText(result.reason)}`
            );

            return showMain(session);
        }

        await send(
            session,
            [
                "╭━━━「 تم إنشاء النقابة 」━━━╮",
                "",
                `🏰 الاسم: ${result.guild.name}`,
                `⭐ المستوى: ${result.guild.level}`,
                `💰 تكلفة الإنشاء: ${result.creationCost}`,
                `💵 الذهب المتبقي: ${result.remainingGold}`,
                "",
                "👑 أصبحت قائد النقابة!",
                "",
                "╰━━━━━━━━━━━━━━━━━━╯"
            ].join("\n")
        );

        return showMyGuild(session);
    }


    // ======================================
    // EXPLORE
    // ======================================

    if (session.state === "explore") {
        const index = Number(text) - 1;

        if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= session.exploreGuilds.length
        ) {
            await send(session, "❌ رقم النقابة غير صحيح.");
            return showExplore(session);
        }

        return showExploreDetails(
            session,
            session.exploreGuilds[index]
        );
    }


    // ======================================
    // EXPLORE DETAILS
    // ======================================

    if (session.state === "exploreDetails") {
        const options = [
            { id: "members", aliases: ["1", "الأعضاء", "اعضاء"] },
            { id: "back", aliases: ["2", "رجوع"] }
        ];

        const selected = findOption(text, options);

        if (!selected) {
            await send(session, "❌ اختيار غير صحيح.");
            return;
        }

        if (selected.id === "back") {
            return showExplore(session);
        }

        const guild = getGuildForHunter(session.identity);

        const selectedGuild = getGuilds().find(
            item => item.id === session.selectedGuildId
        );

        if (!selectedGuild) {
            await send(session, "❌ النقابة غير موجودة.");
            return showExplore(session);
        }

        const members = Object.values(selectedGuild.members || {});

        let content = "";

        members.forEach((member, index) => {
            content += `${index + 1} - ${member.name || "صياد"} (${getRankName(member.rank)})\n`;
        });

        await send(
            session,
            menu("أعضاء النقابة", content || "لا يوجد أعضاء.")
        );

        return;
    }


    // ======================================
    // INVITATIONS
    // ======================================

    if (session.state === "invitations") {
        const index = Number(text) - 1;

        if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= session.invitations.length
        ) {
            await send(session, "❌ رقم الدعوة غير صحيح.");
            return showInvitations(session);
        }

        return showInvitationDetails(session, index);
    }


    // ======================================
    // INVITATION DETAILS
    // ======================================

    if (session.state === "invitationDetails") {
        const options = [
            { id: "accept", aliases: ["1", "قبول", "اقبل"] },
            { id: "decline", aliases: ["2", "رفض", "ارفض"] }
        ];

        const selected = findOption(text, options);

        if (!selected) {
            await send(session, "❌ اكتب قبول أو رفض.");
            return;
        }

        const entry = session.selectedInvitation;

        const result = selected.id === "accept"
            ? acceptGuildInvitation(
                session.identity,
                entry.guild.id
            )
            : declineGuildInvitation(
                session.identity,
                entry.guild.id
            );

        await send(
            session,
            getResultMessage(
                result,
                selected.id === "accept"
                    ? `تم قبول دعوتك والانضمام إلى ${entry.guild.name}.`
                    : "تم رفض الدعوة."
            )
        );

        return showMain(session);
    }


    // ======================================
    // MANAGEMENT
    // ======================================

    if (session.state === "management") {
        const options = [
            { id: "invite", aliases: ["1", "دعوة عضو", "دعوة"] },
            { id: "kick", aliases: ["2", "طرد عضو", "طرد"] },
            { id: "rank", aliases: ["3", "تغيير رتبة عضو", "رتبة"] },
            { id: "transfer", aliases: ["4", "نقل القيادة", "القيادة"] },
            { id: "description", aliases: ["5", "تعديل الوصف", "الوصف"] },
            { id: "back", aliases: ["6", "رجوع"] }
        ];

        const selected = findOption(text, options);

        if (!selected) {
            await send(session, "❌ اختيار غير صحيح.");
            return showManagement(session);
        }

        if (selected.id === "back") {
            return showMyGuild(session);
        }

        if (selected.id === "invite") {
            return startInvite(session);
        }

        if (selected.id === "description") {
            return startDescription(session);
        }

        return selectMember(session, selected.id);
    }


    // ======================================
    // INVITE TARGET
    // ======================================

    if (session.state === "inviteTarget") {
        const mentions = getMentions(incomingMsg);

        let targetIdentity;

        if (mentions.length) {
            const jid = normalizeJid(mentions[0]);

            targetIdentity = {
                pn: jid.endsWith("@s.whatsapp.net") ? jid : null,
                lid: jid.endsWith("@lid") ? jid : null,
                primary: jid
            };
        } else {
            const raw = text.replace(/\D/g, "");

            if (!raw || raw.length < 7) {
                await send(session, "❌ أرسل منشن أو رقم هاتف صحيح.");
                return;
            }

            targetIdentity = {
                pn: `${raw}@s.whatsapp.net`,
                primary: `${raw}@s.whatsapp.net`
            };
        }

        const targetHunter = getHunterByIdentity(targetIdentity);

        if (!targetHunter) {
            await send(session, "❌ الصياد غير مسجل في NOVA.");
            return showManagement(session);
        }

        const guild = getGuildForHunter(session.identity);

        if (!guild) {
            await send(session, "❌ لم يتم العثور على نقابتك.");
            return showMain(session);
        }

        const result = inviteHunter(
            session.identity,
            targetIdentity,
            guild.id
        );

        await send(
            session,
            getResultMessage(
                result,
                `تم إرسال دعوة إلى ${targetHunter.name || "الصياد"}.`
            )
        );

        return showMyGuild(session);
    }


    // ======================================
    // DESCRIPTION
    // ======================================

    if (session.state === "description") {
        const guild = getGuildForHunter(session.identity);

        if (!guild) {
            await send(session, "❌ لم يتم العثور على نقابتك.");
            return showMain(session);
        }

        const result = updateGuildDescription(
            session.identity,
            guild.id,
            getMessageText(incomingMsg).trim()
        );

        await send(
            session,
            getResultMessage(
                result,
                "تم تحديث وصف النقابة."
            )
        );

        return showMyGuild(session);
    }


    // ======================================
    // SELECT MEMBER
    // ======================================

    if (session.state === "selectMember") {
        const index = Number(text) - 1;

        if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= session.targetMembers.length
        ) {
            await send(session, "❌ رقم العضو غير صحيح.");
            return;
        }

        const [targetHunterId, targetMember] =
            session.targetMembers[index];

        session.targetHunterId = targetHunterId;
        session.targetMemberName = targetMember.name;

        if (session.memberAction === "kick") {
            const guild = getGuildForHunter(session.identity);

            const result = kickGuildMember(
                session.identity,
                targetHunterId,
                guild.id
            );

            await send(
                session,
                getResultMessage(
                    result,
                    `تم طرد ${targetMember.name} من النقابة.`
                )
            );

            return showManagement(session);
        }

        if (session.memberAction === "rank") {
            return showRanks(session);
        }

        if (session.memberAction === "transfer") {
            session.state = "confirmTransfer";

            await send(
                session,
                menu(
                    "نقل القيادة",
                    [
                        `هل تريد نقل قيادة النقابة إلى ${targetMember.name}؟`,
                        "",
                        "1 - تأكيد نقل القيادة",
                        "2 - إلغاء"
                    ].join("\n")
                )
            );

            return;
        }
    }


    // ======================================
    // SELECT RANK
    // ======================================

    if (session.state === "selectRank") {
        const options = [
            { id: "vice", aliases: ["1", "نائب القائد", "نائب"] },
            { id: "officer", aliases: ["2", "مسؤول", "اداري", "إداري"] },
            { id: "elite", aliases: ["3", "عضو نخبة", "نخبة"] },
            { id: "member", aliases: ["4", "عضو"] }
        ];

        const selected = findOption(text, options);

        if (!selected) {
            await send(session, "❌ الرتبة غير صحيحة.");
            return showRanks(session);
        }

        const guild = getGuildForHunter(session.identity);

        const result = setGuildMemberRank(
            session.identity,
            session.targetHunterId,
            selected.id,
            guild.id
        );

        await send(
            session,
            getResultMessage(
                result,
                `تم تغيير رتبة ${session.targetMemberName} إلى ${getRankName(selected.id)}.`
            )
        );

        return showManagement(session);
    }


    // ======================================
    // CONFIRM TRANSFER
    // ======================================

    if (session.state === "confirmTransfer") {
        const options = [
            { id: "yes", aliases: ["1", "تأكيد", "نعم", "موافق"] },
            { id: "no", aliases: ["2", "إلغاء", "لا"] }
        ];

        const selected = findOption(text, options);

        if (!selected) {
            await send(session, "❌ اكتب تأكيد أو إلغاء.");
            return;
        }

        if (selected.id === "no") {
            await send(session, "تم إلغاء نقل القيادة.");
            return showManagement(session);
        }

        const guild = getGuildForHunter(session.identity);

        const result = transferGuildLeadership(
            session.identity,
            session.targetHunterId,
            guild.id
        );

        await send(
            session,
            getResultMessage(
                result,
                `تم نقل قيادة النقابة إلى ${session.targetMemberName}.`
            )
        );

        return showMain(session);
    }


    // ======================================
    // CONFIRM LEAVE / DISBAND
    // ======================================

    if (session.state === "confirm") {
        const options = [
            { id: "yes", aliases: ["1", "تأكيد", "نعم", "موافق"] },
            { id: "no", aliases: ["2", "إلغاء", "لا"] }
        ];

        const selected = findOption(text, options);

        if (!selected) {
            await send(session, "❌ اكتب تأكيد أو إلغاء.");
            return;
        }

        if (selected.id === "no") {
            await send(session, "تم إلغاء العملية.");
            return showMyGuild(session);
        }

        if (session.confirmAction === "leave") {
            const result = leaveGuild(session.identity);

            await send(
                session,
                getResultMessage(
                    result,
                    "غادرت النقابة بنجاح."
                )
            );

            return showMain(session);
        }

        if (session.confirmAction === "disband") {
            const guild = getGuildForHunter(session.identity);

            if (!guild) {
                await send(session, "❌ لم يتم العثور على نقابتك.");
                return showMain(session);
            }

            const result = disbandGuild(
                session.identity,
                guild.id
            );

            await send(
                session,
                getResultMessage(
                    result,
                    "تم حل النقابة بنجاح."
                )
            );

            return showMain(session);
        }
    }


    await send(
        session,
        "❌ لم أفهم اختيارك. اكتب رقم الاختيار أو اسمه بالعربي."
    );
}


// ==========================================
// PLUGIN EXECUTION
// ==========================================

export default {
    NovaUltra,

    async execute({ sock, msg, sender }) {
        const chatId = msg?.key?.remoteJid;

        if (!chatId) return;

        const identity = getIdentity(msg, sender);

        if (!identity.primary) {
            await sock.sendMessage(
                chatId,
                {
                    text: "❌ تعذر تحديد هوية الصياد."
                },
                {
                    quoted: msg
                }
            );

            return;
        }

        const key = getSessionKey(
            chatId,
            identity
        );

        const oldSession = activeSessions.get(key);

        if (oldSession) {
            clearSession(oldSession);
        }

        const session = {
            key,
            chatId,
            identity,
            sock,
            lastMessage: msg,
            state: "main",
            timeout: null,
            listener: null
        };

        activeSessions.set(key, session);

        session.listener = async update => {
            if (!activeSessions.has(key)) return;

            if (!Array.isArray(update.messages)) return;

            for (const incomingMsg of update.messages) {
                if (!incomingMsg?.message) continue;
                if (incomingMsg.key?.fromMe) continue;

                if (
                    incomingMsg.key?.remoteJid !== chatId
                ) {
                    continue;
                }

                const incomingIdentity = getIdentity(
                    incomingMsg,
                    null
                );

                if (
                    !sameIdentity(
                        identity,
                        incomingIdentity
                    )
                ) {
                    continue;
                }

                refreshTimeout(session);

                try {
                    await processInput(
                        session,
                        incomingMsg
                    );
                } catch (error) {
                    console.error(
                        "[NOVA GUILD PLUGIN]",
                        error
                    );

                    await send(
                        session,
                        "❌ حصل خطأ أثناء تنفيذ العملية. حاول مرة أخرى."
                    ).catch(() => {});
                }

                if (!activeSessions.has(key)) {
                    return;
                }
            }
        };

        sock.ev.on(
            "messages.upsert",
            session.listener
        );

        refreshTimeout(session);

        try {
            await showMain(session);
        } catch (error) {
            console.error(
                "[NOVA GUILD PLUGIN]",
                error
            );

            clearSession(session);

            await sock.sendMessage(
                chatId,
                {
                    text: "❌ تعذر فتح قائمة النقابات. راجع ملفات إعدادات النقابة."
                },
                {
                    quoted: msg
                }
            );
        }
    }
};
