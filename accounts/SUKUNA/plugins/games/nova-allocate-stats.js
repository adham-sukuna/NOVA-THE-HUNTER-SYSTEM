import {
    getHunterByIdentity,
    resolveHunterIdentity
} from "../../nova/engine/PlayerEngine.js";

import {
    allocateStats,
    getStatDefinitions
} from "../../nova/engine/StatEngine.js";


export const NovaUltra = {
    command: "تطوير",
    description: "توزيع نقاط التطوير على خصائص الصياد",
    usage: ".تطوير STR 5 AGI 3",
    elite: "off",
    group: true,
    prv: false,
    lock: "off",
    category: "NOVA"
};


const STAT_ALIASES = {
    STR: "STR",
    AGI: "AGI",
    INT: "INT",
    VIT: "VIT",
    LUK: "LUK",

    القوة: "STR",
    الرشاقة: "AGI",
    الذكاء: "INT",
    الحيوية: "VIT",
    الحظ: "LUK"
};


const STAT_ICONS = {
    STR: "💪",
    AGI: "⚡",
    INT: "🧠",
    VIT: "❤️",
    LUK: "🍀"
};


function parseAllocations(args = []) {
    const allocations = {};

    if (!Array.isArray(args) || !args.length) {
        return {
            success: false,
            reason: "EMPTY_INPUT"
        };
    }

    const tokens = args.map(value =>
        String(value).trim()
    );

    const expanded = [];

    for (const token of tokens) {
        if (token.includes("=")) {
            const parts = token.split("=");

            if (parts.length !== 2 || !parts[0] || !parts[1]) {
                return {
                    success: false,
                    reason: "INVALID_FORMAT"
                };
            }

            expanded.push(parts[0], parts[1]);
        } else {
            expanded.push(token);
        }
    }

    if (expanded.length % 2 !== 0) {
        return {
            success: false,
            reason: "INVALID_FORMAT"
        };
    }

    for (let i = 0; i < expanded.length; i += 2) {
        const rawStat = expanded[i].trim();

        const stat =
            STAT_ALIASES[rawStat.toUpperCase()] ||
            STAT_ALIASES[rawStat];

        if (!stat) {
            return {
                success: false,
                reason: "INVALID_STAT",
                stat: rawStat
            };
        }

        const amount = Number(expanded[i + 1]);

        if (
            !Number.isSafeInteger(amount) ||
            amount <= 0
        ) {
            return {
                success: false,
                reason: "INVALID_AMOUNT",
                stat
            };
        }

        allocations[stat] =
            (allocations[stat] || 0) + amount;
    }

    return {
        success: true,
        allocations
    };
}


function getHelpMessage() {
    return `
╭━━━〔 𝐍𝐎𝐕𝐀 𝐒𝐓𝐀𝐓 𝐒𝐘𝐒𝐓𝐄𝐌 〕━━━╮

📌 طريقة تطوير الخصائص:

.تطوير STR 5
.تطوير AGI 3 VIT 2

أو باستخدام الأسماء العربية:

.تطوير القوة 5 الحيوية 3

━━━〔 ATTRIBUTES 〕━━━

💪 STR - القوة
⚡ AGI - الرشاقة
🧠 INT - الذكاء
❤️ VIT - الحيوية
🍀 LUK - الحظ

━━━〔 EXAMPLE 〕━━━

.تطوير INT 5 AGI 3

╰━━━━━━━━━━━━━━━━━━╯
`.trim();
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
                        text: "❌ تعذر تحديد هوية الصياد."
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
                            "❌ لا تمتلك شخصية في عالم NOVA.\n\n" +
                            "استخدم .استيقاظ أولاً."
                    },
                    { quoted: msg }
                );
            }

            if (!Array.isArray(args) || args.length === 0) {
                return sock.sendMessage(
                    jid,
                    {
                        text: getHelpMessage()
                    },
                    { quoted: msg }
                );
            }

            const parsed = parseAllocations(args);

            if (!parsed.success) {
                let errorMessage = "❌ صيغة التطوير غير صحيحة.";

                if (parsed.reason === "INVALID_STAT") {
                    errorMessage =
                        `❌ الخاصية غير معروفة: ${parsed.stat}`;
                }

                if (parsed.reason === "INVALID_AMOUNT") {
                    errorMessage =
                        "❌ يجب أن تكون قيمة التطوير رقمًا صحيحًا أكبر من صفر.";
                }

                return sock.sendMessage(
                    jid,
                    {
                        text: `${errorMessage}\n\n${getHelpMessage()}`
                    },
                    { quoted: msg }
                );
            }

            const result = allocateStats(
                hunter.id,
                parsed.allocations
            );

            if (!result.success) {
                let errorMessage = "❌ تعذر تنفيذ التطوير.";

                if (result.reason === "NOT_ENOUGH_POINTS") {
                    errorMessage =
                        `❌ نقاط التطوير غير كافية.\n\n` +
                        `المتاح: ${result.available}\n` +
                        `المطلوب: ${result.required}`;
                }

                if (result.reason === "HUNTER_NOT_FOUND") {
                    errorMessage =
                        "❌ لم يتم العثور على بيانات الصياد.";
                }

                return sock.sendMessage(
                    jid,
                    {
                        text: errorMessage
                    },
                    { quoted: msg }
                );
            }

            const definitions = getStatDefinitions();

            const allocatedText = Object.entries(result.allocated)
                .map(([stat, amount]) => {
                    const newValue = result.summary.effective[stat];

                    return (
                        `${STAT_ICONS[stat]} ${definitions[stat].name}: +${amount}\n` +
                        `   القيمة الفعلية الجديدة: ${newValue}`
                    );
                })
                .join("\n\n");

            const updatedHunter = result.hunter;

            const response = `
╭━━━〔 𝐍𝐎𝐕𝐀 𝐒𝐓𝐀𝐓 𝐔𝐏𝐃𝐀𝐓𝐄 〕━━━╮

✨ تم تطوير خصائص الصياد بنجاح!

👤 الصياد: ${updatedHunter.name}
⭐ المستوى: ${updatedHunter.level}

━━━〔 DEVELOPED STATS 〕━━━

${allocatedText}

━━━〔 REMAINING POINTS 〕━━━

🔹 نقاط التطوير المتبقية: ${result.remainingPoints}

━━━〔 COMBAT STATUS 〕━━━

❤️ HP: ${updatedHunter.hp}/${updatedHunter.maxHp}
🔮 MP: ${updatedHunter.mp}/${updatedHunter.maxMp}

╰━━━━━━━━━━━━━━━━━━╯
`.trim();

            return sock.sendMessage(
                jid,
                {
                    text: response
                },
                { quoted: msg }
            );

        } catch (error) {
            console.error("[NOVA STAT ALLOCATION]", error);

            return sock.sendMessage(
                jid,
                {
                    text: "❌ حدث خطأ أثناء تطوير خصائص الصياد."
                },
                { quoted: msg }
            );
        }
    }
};
