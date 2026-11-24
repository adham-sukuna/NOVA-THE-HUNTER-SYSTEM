import {
    getHunterByIdentity,
    resolveHunterIdentity
} from "../../nova/engine/PlayerEngine.js";

import {
    getHunterSkills,
    getSkill,
    findSkill,
    learnSkill,
    upgradeSkill,
    equipSkill,
    unequipSkill
} from "../../nova/engine/SkillEngine.js";


export const NovaUltra = {
    command: "مهارات",
    description: "إدارة مهارات الصياد وتعلمها وتطويرها وتجهيزها.",
    usage: ".مهارات | .مهارات تعلم <اسم المهارة>",
    elite: "off",
    group: true,
    prv: false,
    lock: "off",
    category: "NOVA"
};


const TYPE_NAMES = {
    active: "نشطة",
    passive: "سلبية"
};


const REASON_MESSAGES = {
    HUNTER_NOT_FOUND: "❌ لم يتم العثور على شخصية الصياد.",
    SKILL_NOT_FOUND: "❌ المهارة غير موجودة.",
    INVALID_ARGUMENTS: "❌ البيانات المدخلة غير صحيحة.",
    INVALID_SKILL_TYPE: "❌ نوع المهارة غير صالح.",
    SKILL_ALREADY_LEARNED: "❌ أنت تعلمت المهارة بالفعل.",
    CLASS_NOT_ALLOWED: "❌ هذه المهارة غير متاحة لفئتك.",
    LEVEL_TOO_LOW: "❌ مستواك الحالي لا يسمح بتعلم المهارة.",
    RANK_TOO_LOW: "❌ رتبتك الحالية لا تسمح بتعلم المهارة.",
    INVALID_SKILL_CONFIGURATION: "❌ إعدادات المهارة غير صحيحة.",
    NOT_ENOUGH_SKILL_POINTS: "❌ نقاط المهارات غير كافية.",
    SKILL_NOT_LEARNED: "❌ لم تتعلم هذه المهارة بعد.",
    MAX_SKILL_LEVEL: "❌ وصلت المهارة إلى أقصى مستوى.",
    PASSIVE_CANNOT_BE_EQUIPPED: "❌ المهارات السلبية لا تحتاج إلى تجهيز.",
    SKILL_ALREADY_EQUIPPED: "❌ المهارة مجهزة بالفعل.",
    MAX_EQUIPPED_SKILLS: "❌ وصلت إلى الحد الأقصى للمهارات المجهزة.",
    SKILL_NOT_EQUIPPED: "❌ هذه المهارة غير مجهزة."
};


function getSkillName(skill) {
    return skill?.nameAr || skill?.name || skill?.id;
}


function getSkillFromInput(input) {
    if (!input) return null;

    return (
        getSkill(input) ||
        findSkill(input)
    );
}


function formatSkill(skill, index = null) {
    const prefix = index !== null
        ? `${index + 1}. `
        : "";

    const status = skill.equipped
        ? " 🟢 مجهزة"
        : "";

    return (
        `${prefix}*${getSkillName(skill)}*\n` +
        `   النوع: ${TYPE_NAMES[skill.type] || skill.type}\n` +
        `   المستوى: ${skill.level || 1}/${skill.maxLevel || 1}\n` +
        `   الندرة: ${skill.rarity || "Common"}${status}\n` +
        `   ${skill.description || "لا يوجد وصف."}`
    );
}


function getOverview(data, hunter) {
    const passive = data.learned.filter(
        skill => skill.type === "passive"
    );

    const active = data.learned.filter(
        skill => skill.type === "active"
    );

    const available = data.available;

    let text = `
╭━━━〔 ⚔️ NOVA SKILLS 〕━━━╮

👤 الصياد: ${hunter.name}
📊 المستوى: ${hunter.level}
🎖️ الرتبة: ${hunter.rank}

✨ نقاط المهارات: ${data.skillPoints}

╰━━━━━━━━━━━━━━━━━━━━╯

`;

    text += `*◆ المهارات السلبية (${passive.length})*\n\n`;

    if (!passive.length) {
        text += "لا توجد مهارات سلبية.\n\n";
    } else {
        text += passive
            .map((skill, index) => formatSkill(skill, index))
            .join("\n\n") + "\n\n";
    }

    text += `*◆ المهارات النشطة (${active.length})*\n\n`;

    if (!active.length) {
        text += "لم تتعلم أي مهارات نشطة.\n\n";
    } else {
        text += active
            .map((skill, index) => formatSkill(skill, index))
            .join("\n\n") + "\n\n";
    }

    text += `*◆ المهارات المجهزة (${data.equipped.length}/${data.maxEquipped})*\n`;

    if (!data.equipped.length) {
        text += "لا توجد مهارات مجهزة حاليًا.\n";
    } else {
        text += data.equipped
            .map(skill => `• ${getSkillName(skill)}`)
            .join("\n") + "\n";
    }

    text += `
━━━━━━━━━━━━━━━━━━━━
📚 المهارات المتاحة للتعلم: ${available.length}

*الأوامر:*
.مهارات تعلم <اسم المهارة>
.مهارات تطوير <اسم المهارة>
.مهارات تجهيز <اسم المهارة>
.مهارات إزالة <اسم المهارة>
.مهارات متاحة
`;

    return text;
}


function getAvailableSkillsText(data) {
    const available = data.available;

    let text = `
╭━━━〔 📚 SKILL LIBRARY 〕━━━╮

`;

    if (!available.length) {
        return text + "لا توجد مهارات متاحة حاليًا.";
    }

    for (const skill of available) {
        text +=
            `\n*${getSkillName(skill)}*\n` +
            `المعرف: ${skill.id}\n` +
            `النوع: ${TYPE_NAMES[skill.type] || skill.type}\n` +
            `الفئة: ${skill.class || "جميع الفئات"}\n` +
            `المستوى المطلوب: ${skill.unlockLevel || 1}\n` +
            `الرتبة المطلوبة: ${skill.unlockRank || "E"}\n` +
            `تكلفة التعلم: ${skill.skillPointCost || 0} نقطة\n` +
            `الوصف: ${skill.description || "لا يوجد وصف."}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n`;
    }

    return text;
}


export default {
    NovaUltra,

    async execute({ sock, msg, args, sender }) {
        const jid = msg.chat || msg.key?.remoteJid;

        try {
            const identity = resolveHunterIdentity({
                msg,
                sender
            });

            if (!identity.primary) {
                return sock.sendMessage(
                    jid,
                    {
                        text: "❌ لم أتمكن من تحديد هوية الصياد."
                    },
                    {
                        quoted: msg
                    }
                );
            }

            const hunter = getHunterByIdentity([
                identity.pn,
                identity.lid
            ]);

            if (!hunter) {
                return sock.sendMessage(
                    jid,
                    {
                        text: "❌ لم تستيقظ بعد داخل عالم NOVA.\nاستخدم أمر .استيقاظ أولًا."
                    },
                    {
                        quoted: msg
                    }
                );
            }

            const action = String(args?.[0] || "")
                .trim()
                .toLowerCase();

            const query = args?.slice(1)
                .join(" ")
                .trim();

            // عرض المهارات.
            if (!action || action === "عرض") {
                const data = getHunterSkills(hunter.id);

                if (!data) {
                    throw new Error("HUNTER_NOT_FOUND");
                }

                return sock.sendMessage(
                    jid,
                    {
                        text: getOverview(data, hunter)
                    },
                    {
                        quoted: msg
                    }
                );
            }

            // عرض مكتبة المهارات.
            if (action === "متاحة" || action === "قائمة") {
                const data = getHunterSkills(hunter.id);

                return sock.sendMessage(
                    jid,
                    {
                        text: getAvailableSkillsText(data)
                    },
                    {
                        quoted: msg
                    }
                );
            }

            if (!query) {
                return sock.sendMessage(
                    jid,
                    {
                        text:
                            "❌ اكتب اسم المهارة.\n\n" +
                            "مثال:\n" +
                            ".مهارات تعلم fireball"
                    },
                    {
                        quoted: msg
                    }
                );
            }

            const skill = getSkillFromInput(query);

            if (!skill) {
                return sock.sendMessage(
                    jid,
                    {
                        text: "❌ لم أجد المهارة المطلوبة في قاعدة البيانات."
                    },
                    {
                        quoted: msg
                    }
                );
            }

            let result;

            // تعلم مهارة.
            if (action === "تعلم") {
                result = learnSkill(
                    hunter.id,
                    skill.id
                );

                if (result.success) {
                    return sock.sendMessage(
                        jid,
                        {
                            text:
                                `╭━━━〔 ✨ SKILL LEARNED 〕━━━╮\n\n` +
                                `🎯 المهارة: ${getSkillName(skill)}\n` +
                                `📈 المستوى: 1\n` +
                                `💠 النقاط المستخدمة: ${result.pointsSpent}\n` +
                                `✨ النقاط المتبقية: ${result.remainingPoints}\n\n` +
                                `تم تعلم المهارة بنجاح.\n` +
                                `╰━━━━━━━━━━━━━━━━━━━━╯`
                        },
                        {
                            quoted: msg
                        }
                    );
                }
            }

            // ترقية مهارة.
            else if (
                action === "تطوير" ||
                action === "ترقية"
            ) {
                result = upgradeSkill(
                    hunter.id,
                    skill.id
                );

                if (result.success) {
                    return sock.sendMessage(
                        jid,
                        {
                            text:
                                `╭━━━〔 ⬆️ SKILL UPGRADE 〕━━━╮\n\n` +
                                `🎯 المهارة: ${getSkillName(skill)}\n` +
                                `📈 المستوى السابق: ${result.previousLevel}\n` +
                                `📈 المستوى الجديد: ${result.currentLevel}\n` +
                                `💠 النقاط المستخدمة: ${result.pointsSpent}\n` +
                                `✨ النقاط المتبقية: ${result.remainingPoints}\n\n` +
                                `تم تطوير المهارة بنجاح.\n` +
                                `╰━━━━━━━━━━━━━━━━━━━━╯`
                        },
                        {
                            quoted: msg
                        }
                    );
                }
            }

            // تجهيز مهارة.
            else if (
                action === "تجهيز" ||
                action === "اضافة" ||
                action === "إضافة"
            ) {
                result = equipSkill(
                    hunter.id,
                    skill.id
                );

                if (result.success) {
                    return sock.sendMessage(
                        jid,
                        {
                            text:
                                `╭━━━〔 ⚔️ SKILL EQUIPPED 〕━━━╮\n\n` +
                                `🎯 المهارة: ${getSkillName(skill)}\n` +
                                `📦 المهارات المجهزة: ${result.equippedSkills.length}/4\n\n` +
                                `تم تجهيز المهارة بنجاح.\n` +
                                `╰━━━━━━━━━━━━━━━━━━━━╯`
                        },
                        {
                            quoted: msg
                        }
                    );
                }
            }

            // إزالة مهارة.
            else if (
                action === "إزالة" ||
                action === "ازالة" ||
                action === "خلع"
            ) {
                result = unequipSkill(
                    hunter.id,
                    skill.id
                );

                if (result.success) {
                    return sock.sendMessage(
                        jid,
                        {
                            text:
                                `╭━━━〔 📦 SKILL REMOVED 〕━━━╮\n\n` +
                                `🎯 المهارة: ${getSkillName(skill)}\n` +
                                `تمت إزالة المهارة من التجهيز.\n` +
                                `╰━━━━━━━━━━━━━━━━━━━━╯`
                        },
                        {
                            quoted: msg
                        }
                    );
                }
            } else {
                return sock.sendMessage(
                    jid,
                    {
                        text:
                            "❌ أمر غير معروف.\n\n" +
                            "استخدم:\n" +
                            ".مهارات\n" +
                            ".مهارات متاحة\n" +
                            ".مهارات تعلم <اسم>\n" +
                            ".مهارات تطوير <اسم>\n" +
                            ".مهارات تجهيز <اسم>\n" +
                            ".مهارات إزالة <اسم>"
                    },
                    {
                        quoted: msg
                    }
                );
            }

            if (result && !result.success) {
                return sock.sendMessage(
                    jid,
                    {
                        text: REASON_MESSAGES[result.reason] ||
                            "❌ لم نتمكن من تنفيذ العملية."
                    },
                    {
                        quoted: msg
                    }
                );
            }

        } catch (error) {
            console.error(
                "[NOVA SKILLS ERROR]",
                error
            );

            return sock.sendMessage(
                jid,
                {
                    text: "❌ حدث خطأ أثناء إدارة المهارات."
                },
                {
                    quoted: msg
                }
            );
        }
    }
};
