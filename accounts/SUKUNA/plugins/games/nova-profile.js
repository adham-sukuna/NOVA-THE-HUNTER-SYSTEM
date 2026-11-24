import {
    getHunterByIdentity,
    resolveHunterIdentity,
    getXPRequired
} from "../../nova/engine/PlayerEngine.js";

import {
    getHunterClass
} from "../../nova/engine/ClassEngine.js";

import {
    getStatSummary
} from "../../nova/engine/StatEngine.js";


export const NovaUltra = {
    command: "صياد",
    description: "عرض ملف الصياد وإحصائياته.",
    elite: "off",
    group: false,
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
                            "لم تستيقظ بعد!\n" +
                            "ابدأ رحلتك باستخدام .استيقاظ"
                    },
                    { quoted: msg }
                );
            }

            // الخصائص الفعلية بعد احتساب الفئة والمعدات والمهارات
            const summary = getStatSummary(hunter);

            const stats = summary?.effective || hunter.stats || {};

            const derived = summary?.derived || {};

            const talent = hunter.talent || {};

            const classData = getHunterClass(hunter);

            const level = hunter.level || 1;

            const xpRequired = getXPRequired(level);

            const text = `
╭━━━『 𝐍𝐎𝐕𝐀 𝐇𝐔𝐍𝐓𝐄𝐑 』━━━╮
┃
┃ ⚔️ ${hunter.name || "Unknown Hunter"}
┃ 🏅 Rank: ${hunter.rank || "E"}
┃ ⭐ Level: ${level}
┃ ✨ XP: ${hunter.xp || 0}/${xpRequired}
┃
┣━━━━━━━━━━━━━━━━━━
┃ ❤️ HP: ${hunter.hp ?? 0}/${derived.maxHp ?? hunter.maxHp ?? 0}
┃ 🔮 MP: ${hunter.mp ?? 0}/${derived.maxMp ?? hunter.maxMp ?? 0}
┃
┣━━━━━━━━━━━━━━━━━━
┃ 💪 STR: ${stats.STR ?? 0}
┃ ⚡ AGI: ${stats.AGI ?? 0}
┃ 🧠 INT: ${stats.INT ?? 0}
┃ 🛡️ VIT: ${stats.VIT ?? 0}
┃ 🍀 LUK: ${stats.LUK ?? 0}
┃
┣━━━━━━━━━━━━━━━━━━
┃ 💰 Gold: ${hunter.gold ?? 0}
┃ 💎 Gems: ${hunter.gems ?? 0}
┃ ⭐ SP: ${hunter.skillPoints ?? 0}
┃ 📌 Stat Points: ${hunter.statPoints ?? 0}
┃
┣━━━━━━━━━━━━━━━━━━
┃ 🎭 Class: ${classData?.name || "Unselected"}
┃ ✨ Talent: ${talent.name || "Unknown"}
┃ 💠 Rarity: ${talent.rarity || "Common"}
┃
╰━━━━━━━━━━━━━━━━━━╯
`.trim();

            return sock.sendMessage(
                jid,
                {
                    text
                },
                { quoted: msg }
            );

        } catch (error) {
            console.error("[NOVA PROFILE]", error);

            return sock.sendMessage(
                jid,
                {
                    text: "❌ حدث خطأ أثناء تحميل ملف الصياد."
                },
                { quoted: msg }
            );
        }
    }
};
