import {
    createHunter,
    resolveHunterIdentity
} from "../../nova/engine/PlayerEngine.js";

export const NovaUltra = {
    command: "استيقاظ",
    description: "ابدأ رحلتك واستيقظ داخل عالم NOVA.",
    usage: ".استيقاظ",
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

        if (!jid) return;

        try {
            const identity = resolveHunterIdentity({
                msg,
                sender
            });

            if (!identity?.primary) {
                return sock.sendMessage(
                    jid,
                    {
                        text: "❌ تعذر تحديد هوية الصياد."
                    },
                    { quoted: msg }
                );
            }

            const name =
                msg.pushName ||
                sender?.name ||
                "Unknown Hunter";

            const hunter = createHunter(
                identity,
                name
            );

            if (!hunter) {
                return sock.sendMessage(
                    jid,
                    {
                        text:
                            "⚠️ أنت مستيقظ بالفعل!\n\n" +
                            "استخدم .احصائياتي لعرض إحصائيات شخصيتك."
                    },
                    { quoted: msg }
                );
            }

            const talent = hunter.talent || {};

            const text = [
                "╭━━━『 𝐍𝐎𝐕𝐀 𝐀𝐖𝐀𝐊𝐄𝐍𝐈𝐍𝐆 』━━━╮",
                "┃",
                "┃ ✨ تم رصد استيقاظ جديد!",
                "┃",
                "┃ 👤 Hunter: " + (hunter.name || name),
                "┃ 🏅 Rank: " + (hunter.rank || "E"),
                "┃ ⭐ Level: " + (hunter.level || 1),
                "┃",
                "┃ 🎁 الموهبة الفطرية:",
                "┃ " + (talent.name || talent.id || "موهبة مجهولة"),
                "┃ Rarity: " + (talent.rarity || "Common"),
                "┃",
                "┃ ❤️ HP: " + (hunter.hp ?? 100) +
                    "/" + (hunter.maxHp ?? 100),
                "┃ 🔮 MP: " + (hunter.mp ?? 50) +
                    "/" + (hunter.maxMp ?? 50),
                "┃",
                "┃ 💰 Gold: " + (hunter.gold ?? 0),
                "┃ 💎 Gems: " + (hunter.gems ?? 0),
                "┃",
                "┃ 🔹 Stat Points: " +
                    (hunter.statPoints ?? 0),
                "┃ 🔹 Skill Points: " +
                    (hunter.skillPoints ?? 0),
                "┃",
                "╰━━━━━━━━━━━━━━━━━━━━╯",
                "",
                "لقد بدأت رحلتك في عالم NOVA.",
                "",
                "📌 استخدم:",
                ".الفئات - عرض الفئات",
                ".احصائياتي - عرض إحصائياتك",
                ".تطوير - توزيع نقاط الخصائص"
            ].join("\n");

            return sock.sendMessage(
                jid,
                { text },
                { quoted: msg }
            );

        } catch (error) {
            console.error("[NOVA AWAKENING]", error);

            let errorMessage =
                "❌ حدث خطأ أثناء عملية الاستيقاظ.";

            if (
                error.message === "HUNTER_IDENTITY_CONFLICT"
            ) {
                errorMessage =
                    "⚠️ تعارض في هويات الصياد.\n" +
                    "تم إيقاف العملية لحماية بيانات شخصيتك.";
            }

            return sock.sendMessage(
                jid,
                { text: errorMessage },
                { quoted: msg }
            );
        }
    }
};
