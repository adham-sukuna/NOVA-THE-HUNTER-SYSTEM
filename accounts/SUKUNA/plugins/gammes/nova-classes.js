import { getClassList } from "../../nova/engine/ClassEngine.js";

export const NovaUltra = {
    command: "الفئات",
    description: "عرض جميع فئات الصيادين المتاحة",
    usage: ".الفئات",
    elite: "off",
    group: true,
    prv: false,
    lock: "off",
    category: "games"
};

export default {
    NovaUltra,

    async execute({ sock, msg }) {
        const jid = msg.chat;

        try {
            const classes = getClassList();

            if (!classes.length) {
                return sock.sendMessage(
                    jid,
                    { text: "❌ لا توجد فئات مسجلة في قاعدة بيانات NOVA." },
                    { quoted: msg }
                );
            }

            let text = `╭━━━〔 𝐍𝐎𝐕𝐀 𝐂𝐋𝐀𝐒𝐒𝐄𝐒 〕━━━╮\n\n`;

            for (const cls of classes) {
                text += `${cls.icon || "⚔️"} *${cls.nameAr || cls.name}*\n`;
                text += `▪ الاسم: ${cls.name}\n`;
                text += `▪ المعرّف: ${cls.id}\n`;
                text += `▪ الدور: ${cls.role || "غير محدد"}\n`;
                text += `▪ الندرة: ${cls.rarity || "عادي"}\n`;
                text += `${cls.description || ""}\n\n`;
            }

            text += `╰━━━━━━━━━━━━━━━━━━╯\n`;
            text += `📌 لاختيار فئة:\n`;
            text += `.اختيار-فئة warrior`;

            return sock.sendMessage(
                jid,
                { text },
                { quoted: msg }
            );

        } catch (error) {
            console.error("[NOVA CLASSES]", error);

            return sock.sendMessage(
                jid,
                { text: "❌ حدث خطأ أثناء تحميل الفئات." },
                { quoted: msg }
            );
        }
    }
};
