import {
    getHunterByIdentity,
    resolveHunterIdentity
} from "../../nova/engine/PlayerEngine.js";

import {
    chooseClass,
    getClass
} from "../../nova/engine/ClassEngine.js";

import {
    updateHunterVitals
} from "../../nova/engine/StatEngine.js";

import {
    getHunters,
    saveHunters
} from "../../nova/engine/storage.js";


export const NovaUltra = {
    command: "اختيار-فئة",
    description: "اختيار فئة الصياد",
    usage: ".اختيار-فئة warrior",
    elite: "off",
    group: true,
    prv: false,
    lock: "off",
    category: "NOVA"
};


const REASONS = {
    HUNTER_NOT_FOUND:
        "لم يتم العثور على ملف الصياد الخاص بك.",

    CLASS_NOT_FOUND:
        "الفئة التي أدخلتها غير موجودة.",

    CLASS_ALREADY_SELECTED:
        "لقد اخترت فئتك بالفعل.",

    LEVEL_TOO_LOW:
        "مستواك الحالي لا يسمح باختيار هذه الفئة.",

    RANK_TOO_LOW:
        "رتبتك الحالية لا تسمح باختيار هذه الفئة.",

    INVALID_ARGUMENTS:
        "البيانات المدخلة غير صحيحة.",

    INVALID_CLASS_CONFIGURATION:
        "إعدادات هذه الفئة غير صحيحة."
};


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
                            "❌ لم يتم العثور على شخصيتك.\n" +
                            "يجب عليك إكمال مرحلة الاستيقاظ أولاً."
                    },
                    { quoted: msg }
                );
            }

            const classId = String(args?.[0] || "")
                .trim()
                .toLowerCase();

            if (!classId) {
                return sock.sendMessage(
                    jid,
                    {
                        text:
                            "╭━━━〔 NOVA CLASS SYSTEM 〕━━━╮\n\n" +
                            "📌 طريقة الاستخدام:\n" +
                            ".اختيار-فئة warrior\n\n" +
                            "الفئات المتاحة:\n" +
                            "⚔️ warrior\n" +
                            "🗡️ assassin\n" +
                            "🔮 mage\n" +
                            "🏹 archer\n\n" +
                            "لعرض تفاصيل الفئات:\n" +
                            ".الفئات\n\n" +
                            "╰━━━━━━━━━━━━━━━━━━━━╯"
                    },
                    { quoted: msg }
                );
            }

            const classData = getClass(classId);

            if (!classData) {
                return sock.sendMessage(
                    jid,
                    {
                        text:
                            "❌ هذه الفئة غير موجودة.\n" +
                            "استخدم .الفئات لعرض الفئات المتاحة."
                    },
                    { quoted: msg }
                );
            }

            // تحديد مفتاح الصياد الفعلي داخل قاعدة البيانات.
            const hunters = getHunters();

            const hunterEntry = Object.entries(hunters).find(
                ([key, item]) => {
                    return (
                        key === identity.pn ||
                        key === identity.lid ||
                        item?.id === hunter.id
                    );
                }
            );

            if (!hunterEntry) {
                return sock.sendMessage(
                    jid,
                    {
                        text: "❌ تعذر تحديد سجل الصياد داخل قاعدة البيانات."
                    },
                    { quoted: msg }
                );
            }

            const hunterKey = hunterEntry[0];

            const result = chooseClass(
                hunterKey,
                classId
            );

            if (!result.success) {
                const reason =
                    REASONS[result.reason] ||
                    "حدث خطأ غير معروف.";

                return sock.sendMessage(
                    jid,
                    {
                        text:
                            `❌ *تعذر اختيار الفئة*\n\n` +
                            `${reason}` +
                            (
                                result.required
                                    ? `\nالمطلوب: ${result.required}`
                                    : ""
                            )
                    },
                    { quoted: msg }
                );
            }

            // استخدام الصياد الذي أعاده المحرك.
            const updated = result.hunter;

            // تحديث الصحة والمانا بعد اختيار الفئة.
            updateHunterVitals(updated, true);

            updated.lastActive = Date.now();

            // حفظ التحديثات الجديدة.
            const updatedHunters = getHunters();

            const savedHunter = updatedHunters[hunterKey];

            if (!savedHunter) {
                throw new Error(
                    "Hunter data missing after class selection."
                );
            }

            Object.assign(savedHunter, updated);

            saveHunters(updatedHunters);

            let text =
                `╭━━━〔 𝐂𝐋𝐀𝐒𝐒 𝐔𝐍𝐋𝐎𝐂𝐊𝐄𝐃 〕━━━╮\n\n`;

            text +=
                `${classData.icon || "⚔️"} *${classData.nameAr || classData.name}*\n\n`;

            text +=
                `▪ الفئة: ${classData.name}\n`;

            text +=
                `▪ المستوى: ${updated.level}\n`;

            text +=
                `▪ الرتبة: ${updated.rank}\n\n`;

            text +=
                `❤️ HP: ${updated.hp}/${updated.maxHp}\n`;

            text +=
                `🔮 MP: ${updated.mp}/${updated.maxMp}\n\n`;

            text +=
                `✦ تم اختيار فئتك بنجاح!\n`;

            text +=
                `✦ تمت إضافة المهارات السلبية الخاصة بالفئة.\n`;

            text +=
                `✦ تم تحديث قدراتك الأساسية.\n\n`;

            text +=
                `استخدم .احصائياتي لمشاهدة قدراتك الجديدة.\n`;

            text +=
                `╰━━━━━━━━━━━━━━━━━━━━╯`;

            return sock.sendMessage(
                jid,
                { text },
                { quoted: msg }
            );

        } catch (error) {
            console.error(
                "[NOVA CHOOSE CLASS]",
                error
            );

            return sock.sendMessage(
                jid,
                {
                    text:
                        "❌ حدث خطأ أثناء اختيار الفئة.\n" +
                        "راجع سجل البوت لمعرفة التفاصيل."
                },
                { quoted: msg }
            );
        }
    }
};
