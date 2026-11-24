import {
    getHunterByIdentity,
    resolveHunterIdentity,
    getXPRequired
} from "../../nova/engine/PlayerEngine.js";

import {
    getStatSummary,
    getStatDefinitions
} from "../../nova/engine/StatEngine.js";

import {
    getHunterClass
} from "../../nova/engine/ClassEngine.js";


export const NovaUltra = {
    command: "احصائياتي",
    description: "عرض إحصائيات الصياد وقدراته",
    usage: ".احصائياتي",
    elite: "off",
    group: true,
    prv: false,
    lock: "off",
    category: "NOVA"
};


export default {
    NovaUltra,

    async execute({ sock, msg, sender }) {
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
                    { quoted: msg }
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
                        text:
                            "❌ لم يتم العثور على شخصيتك.\n\n" +
                            "استخدم .استيقاظ لبدء رحلتك في عالم NOVA."
                    },
                    { quoted: msg }
                );
            }

            const summary = getStatSummary(hunter);

            if (!summary) {
                throw new Error("STAT_SUMMARY_FAILED");
            }

            const definitions = getStatDefinitions();

            const classData = getHunterClass(hunter);

            const xpRequired = getXPRequired(
                hunter.level
            );

            const statIcons = {
                STR: "💪",
                AGI: "⚡",
                INT: "🧠",
                VIT: "❤️",
                LUK: "🍀"
            };

            let text =
                `╭━━━〔 𝐍𝐎𝐕𝐀 𝐇𝐔𝐍𝐓𝐄𝐑 〕━━━╮\n\n`;

            text += `👤 *${hunter.name || "Unknown Hunter"}*\n`;
            text += `🏅 الرتبة: ${hunter.rank || "E"}\n`;
            text += `⭐ المستوى: ${hunter.level || 1}\n`;
            text += `📈 الخبرة: ${hunter.xp || 0}/${xpRequired}\n\n`;

            text += `━━━〔 CLASS 〕━━━\n`;

            if (classData) {
                text +=
                    `${classData.icon || "⚔️"} ${classData.nameAr || classData.name}\n`;
            } else {
                text += `❌ لم تختر فئة بعد.\n`;
            }

            text += `\n━━━〔 ATTRIBUTES 〕━━━\n`;

            for (const stat of Object.keys(definitions)) {
                const base = summary.base[stat];

                const effective = summary.effective[stat];

                text +=
                    `${statIcons[stat] || "🔹"} *${stat} - ${definitions[stat].name}*\n`;

                text += `▪ الأساسي: ${base}\n`;
                text += `▪ الفعلي: ${effective}\n`;
                text += `▪ ${definitions[stat].description}\n\n`;
            }

            const derived = summary.derived;

            text += `━━━〔 COMBAT STATUS 〕━━━\n`;

            text += `❤️ HP: ${hunter.hp ?? 0}/${derived.maxHp}\n`;
            text += `🔮 MP: ${hunter.mp ?? 0}/${derived.maxMp}\n`;
            text += `⚔️ الضرر الجسدي: ${derived.physicalDamage}\n`;
            text += `✨ الضرر السحري: ${derived.magicDamage}\n`;
            text += `🛡️ الدفاع: ${derived.defense}\n`;
            text += `🎯 الضربة الحرجة: ${derived.criticalRate}%\n`;
            text += `💥 ضرر الضربة الحرجة: ${Math.floor(derived.criticalDamage)}%\n`;
            text += `⚡ السرعة: ${derived.speed}\n`;
            text += `🎯 الدقة: ${derived.accuracy}\n`;
            text += `🌀 المراوغة: ${derived.evasion}\n\n`;

            text += `━━━〔 DEVELOPMENT 〕━━━\n`;

            text += `🔹 نقاط التطوير المتاحة: ${summary.availablePoints}\n`;
            text += `✨ نقاط المهارات: ${hunter.skillPoints || 0}\n\n`;

            text += `╰━━━━━━━━━━━━━━━━━━╯`;

            return sock.sendMessage(
                jid,
                {
                    text
                },
                { quoted: msg }
            );

        } catch (error) {
            console.error("[NOVA STATS]", error);

            return sock.sendMessage(
                jid,
                {
                    text: "❌ حدث خطأ أثناء تحميل إحصائيات الصياد."
                },
                { quoted: msg }
            );
        }
    }
};
