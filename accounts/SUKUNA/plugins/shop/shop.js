import {
    resolveHunterIdentity,
    getHunterByIdentity
} from "../../nova/engine/PlayerEngine.js";

import {
    getShopItems,
    buyItem,
    sellItem,
    getShopPlayerInfo
} from "../../nova/engine/ShopEngine.js";


export const NovaUltra = {
    command: "متجر",
    description: "متجر الصيادين للشراء والبيع",
    usage: ".متجر",
    elite: "off",
    group: true,
    prv: false,
    lock: "off",
    category: "NOVA"
};


const activeSessions = new Map();

const SESSION_TIMEOUT = 120000;


// ==========================================
// MESSAGE HELPERS
// ==========================================

function unwrapMessage(message) {
    let current = message;

    while (current && typeof current === "object") {
        if (current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
            continue;
        }

        if (current.viewOnceMessage?.message) {
            current = current.viewOnceMessage.message;
            continue;
        }

        if (current.viewOnceMessageV2?.message) {
            current = current.viewOnceMessageV2.message;
            continue;
        }

        if (current.documentWithCaptionMessage?.message) {
            current = current.documentWithCaptionMessage.message;
            continue;
        }

        break;
    }

    return current;
}


function getMessageText(msg) {
    const message = unwrapMessage(msg?.message);

    if (!message) return "";

    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        message.buttonsResponseMessage?.selectedButtonId ||
        message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        message.templateButtonReplyMessage?.selectedId ||
        ""
    ).trim();
}


function normalizeJid(jid) {
    if (typeof jid !== "string") return null;

    const clean = jid.trim().split(":")[0].toLowerCase();

    return clean || null;
}


function getMessageSender(msg) {
    const remoteJid = msg?.key?.remoteJid;
    const participant = msg?.key?.participant;

    if (
        typeof remoteJid !== "string" ||
        remoteJid.endsWith("@g.us")
    ) {
        return normalizeJid(participant);
    }

    return normalizeJid(remoteJid);
}


function isSameSender(msg, session) {
    const remoteJid = normalizeJid(
        msg?.key?.remoteJid
    );

    if (remoteJid !== session.chatId) {
        return false;
    }

    const participant = normalizeJid(
        msg?.key?.participant
    );

    const remoteIsGroup = remoteJid?.endsWith("@g.us");

    if (!remoteIsGroup) {
        return session.identities.includes(remoteJid);
    }

    return (
        participant &&
        session.identities.includes(participant)
    );
}


function getSessionKey(chatId, senderId) {
    return `${chatId}:${senderId}`;
}


// ==========================================
// DISPLAY
// ==========================================

function getShopText() {
    const items = getShopItems();

    const lines = items.map((item, index) => {
        const name = item.nameAr || item.name || item.id;

        return (
            `${index + 1}. ${name}\n` +
            `   ID: ${item.id}\n` +
            `   شراء: ${item.buyPrice} ذهب | بيع: ${item.sellPrice} ذهب`
        );
    });

    return [
        "╭━━━『 𝐍𝐎𝐕𝐀 𝐒𝐇𝐎𝐏 』━━━╮",
        "┃ 🛒 متجر الصيادين",
        "┃",
        ...lines.map(line => `┃ ${line.replace(/\n/g, "\n┃ ")}`),
        "┃",
        "┃ ━━━━━━━━━━━━━━━",
        "┃ الاستخدامات:",
        "┃ شراء",
        "┃ بيع",
        "┃",
        "┃ بعد الاختيار اكتب:",
        "┃ شراء rusty_sword",
        "┃ بيع small_health_potion",
        "┃",
        "┃ لإلغاء العملية اكتب: إلغاء",
        "╰━━━━━━━━━━━━━━━━━━╯"
    ].join("\n");
}


function getActionText(action) {
    if (action === "buy") {
        return [
            "╭━━━『 شراء العناصر 』━━━╮",
            "┃ اكتب اسم العنصر أو ID",
            "┃ بالشكل التالي:",
            "┃",
            "┃ شراء rusty_sword",
            "┃",
            "┃ مثال آخر:",
            "┃ شراء small_health_potion",
            "┃",
            "┃ لإلغاء العملية اكتب: إلغاء",
            "╰━━━━━━━━━━━━━━━━━━╯"
        ].join("\n");
    }

    return [
        "╭━━━『 بيع العناصر 』━━━╮",
        "┃ اكتب اسم العنصر أو ID",
        "┃ بالشكل التالي:",
        "┃",
        "┃ بيع rusty_sword",
        "┃",
        "┃ مثال آخر:",
        "┃ بيع small_health_potion",
        "┃",
        "┃ لا يمكن بيع المعدات المجهزة.",
        "┃ لإلغاء العملية اكتب: إلغاء",
        "╰━━━━━━━━━━━━━━━━━━╯"
    ].join("\n");
}


// ==========================================
// SESSION MANAGEMENT
// ==========================================

function clearSession(sock, sessionKey) {
    const session = activeSessions.get(sessionKey);

    if (!session) return;

    clearTimeout(session.timeout);

    if (session.listener) {
        sock.ev.off(
            "messages.upsert",
            session.listener
        );
    }

    activeSessions.delete(sessionKey);
}


function refreshTimeout(sock, sessionKey) {
    const session = activeSessions.get(sessionKey);

    if (!session) return;

    clearTimeout(session.timeout);

    session.timeout = setTimeout(() => {
        clearSession(sock, sessionKey);

        sock.sendMessage(
            session.chatId,
            {
                text: "⌛ انتهت مهلة المتجر. افتح المتجر مرة أخرى باستخدام .متجر"
            }
        ).catch(() => {});
    }, SESSION_TIMEOUT);
}


function parseAction(text) {
    const value = text.trim().toLowerCase();

    if (
        value === "شراء" ||
        value === "buy"
    ) {
        return "buy";
    }

    if (
        value === "بيع" ||
        value === "بيع" ||
        value === "sell"
    ) {
        return "sell";
    }

    return null;
}


function parseItemRequest(text, expectedAction) {
    const parts = text.trim().split(/\s+/);

    if (parts.length < 2) {
        return null;
    }

    const action = parseAction(parts[0]);

    if (!action || action !== expectedAction) {
        return null;
    }

    const itemId = parts[1];

    let quantity = 1;

    if (parts.length >= 3) {
        quantity = Number(parts[2]);

        if (
            !Number.isSafeInteger(quantity) ||
            quantity <= 0
        ) {
            return {
                error: "INVALID_QUANTITY"
            };
        }
    }

    if (parts.length > 3) {
        return null;
    }

    return {
        itemId,
        quantity
    };
}


// ==========================================
// ITEM PROCESSING
// ==========================================

async function processItemRequest(
    sock,
    session,
    sessionKey,
    text
) {
    const request = parseItemRequest(
        text,
        session.action
    );

    if (!request) {
        if (request?.error === "INVALID_QUANTITY") {
            await sock.sendMessage(
                session.chatId,
                {
                    text: "❌ الكمية غير صحيحة. استخدم رقمًا صحيحًا أكبر من صفر."
                }
            );

            return;
        }

        await sock.sendMessage(
            session.chatId,
            {
                text: session.action === "buy"
                    ? "❌ الصيغة غير صحيحة.\nمثال: شراء rusty_sword"
                    : "❌ الصيغة غير صحيحة.\nمثال: بيع small_health_potion"
            }
        );

        return;
    }

    const item = getShopItems().find(
        entry => entry.id === request.itemId
    );

    if (!item) {
        await sock.sendMessage(
            session.chatId,
            {
                text: "❌ العنصر غير موجود في المتجر أو غير متاح للبيع."
            }
        );

        return;
    }

    const result = session.action === "buy"
        ? buyItem(
            session.hunterId,
            request.itemId,
            request.quantity
        )
        : sellItem(
            session.hunterId,
            request.itemId,
            request.quantity
        );

    if (!result.success) {
        const errors = {
            NOT_ENOUGH_GOLD: "❌ الذهب غير كافٍ لإتمام عملية الشراء.",
            INVENTORY_FULL: "❌ مساحة المخزون غير كافية.",
            ITEM_NOT_AVAILABLE: "❌ العنصر غير متاح في المتجر.",
            ITEM_NOT_FOR_SALE: "❌ هذا العنصر غير متاح للشراء.",
            ITEM_NOT_SELLABLE: "❌ هذا العنصر غير متاح للبيع.",
            NOT_ENOUGH_ITEMS: "❌ لا تملك كمية كافية من هذا العنصر.",
            HUNTER_NOT_FOUND: "❌ لم يتم العثور على شخصية الصياد.",
            GOLD_LIMIT_REACHED: "❌ لا يمكن إضافة هذه الكمية من الذهب.",
            PURCHASE_FAILED: "❌ فشلت عملية الشراء، وتمت إعادة الذهب."
        };

        await sock.sendMessage(
            session.chatId,
            {
                text: errors[result.reason] ||
                    `❌ فشلت العملية.\nالسبب: ${result.reason || "UNKNOWN_ERROR"}`
            }
        );

        return;
    }

    const itemName = item.nameAr || item.name || item.id;

    const actionName = session.action === "buy"
        ? "شراء"
        : "بيع";

    const totalLabel = session.action === "buy"
        ? "التكلفة"
        : "المبلغ المستلم";

    const playerInfo = getShopPlayerInfo(
        session.hunterId
    );

    await sock.sendMessage(
        session.chatId,
        {
            text: [
                "╭━━━『 𝐍𝐎𝐕𝐀 𝐒𝐇𝐎𝐏 』━━━╮",
                `┃ ✅ تمت عملية ${actionName} بنجاح`,
                "┃",
                `┃ العنصر: ${itemName}`,
                `┃ الكمية: ${result.quantity}`,
                `┃ سعر الوحدة: ${result.unitPrice}`,
                `┃ ${totalLabel}: ${result.totalPrice} ذهب`,
                "┃",
                `┃ رصيدك: ${playerInfo?.gold ?? result.remainingGold} ذهب`,
                "╰━━━━━━━━━━━━━━━━━━╯"
            ].join("\n")
        }
    );

    clearSession(sock, sessionKey);
}


// ==========================================
// SESSION LISTENER
// ==========================================

function registerSessionListener(
    sock,
    session,
    sessionKey
) {
    session.listener = async update => {
        if (!update?.messages) return;

        for (const msg of update.messages) {
            if (
                !msg?.message ||
                msg.key?.fromMe
            ) {
                continue;
            }

            if (!isSameSender(msg, session)) {
                continue;
            }

            if (session.processing) {
                continue;
            }

            const text = getMessageText(msg);

            if (!text) continue;

            session.processing = true;

            try {
                if (
                    ["إلغاء", "الغاء", "cancel"].includes(
                        text.toLowerCase()
                    )
                ) {
                    await sock.sendMessage(
                        session.chatId,
                        {
                            text: "تم إلغاء عملية المتجر."
                        }
                    );

                    clearSession(sock, sessionKey);
                    return;
                }

                refreshTimeout(sock, sessionKey);

                if (session.step === "action") {
                    const action = parseAction(text);

                    if (!action) {
                        await sock.sendMessage(
                            session.chatId,
                            {
                                text: "❌ اختر عملية صحيحة: شراء أو بيع."
                            }
                        );

                        continue;
                    }

                    session.action = action;
                    session.step = "item";

                    await sock.sendMessage(
                        session.chatId,
                        {
                            text: getActionText(action)
                        }
                    );

                    continue;
                }

                if (session.step === "item") {
                    await processItemRequest(
                        sock,
                        session,
                        sessionKey,
                        text
                    );

                    if (!activeSessions.has(sessionKey)) {
                        return;
                    }
                }
            } catch (error) {
                console.error(
                    "[NOVA SHOP SESSION]",
                    error
                );

                await sock.sendMessage(
                    session.chatId,
                    {
                        text: "❌ حصل خطأ أثناء تنفيذ عملية المتجر."
                    }
                ).catch(() => {});
            } finally {
                session.processing = false;
            }
        }
    };

    sock.ev.on(
        "messages.upsert",
        session.listener
    );
}


// ==========================================
// START SHOP
// ==========================================

async function startShop(sock, msg, sender) {
    const chatId = msg.key.remoteJid;

    const identity = resolveHunterIdentity({
        msg,
        sender
    });

    if (!identity.primary) {
        await sock.sendMessage(
            chatId,
            {
                text: "❌ لم أتمكن من تحديد هوية الصياد."
            },
            {
                quoted: msg
            }
        );

        return;
    }

    const hunter = getHunterByIdentity({
        pn: identity.pn,
        lid: identity.lid
    });

    if (!hunter) {
        await sock.sendMessage(
            chatId,
            {
                text: "❌ ليس لديك شخصية صياد في نظام NOVA. أنشئ شخصيتك أولًا."
            },
            {
                quoted: msg
            }
        );

        return;
    }

    const hunterId = hunter.id || identity.primary;

    const sessionKey = getSessionKey(
        normalizeJid(chatId),
        normalizeJid(identity.primary)
    );

    if (activeSessions.has(sessionKey)) {
        clearSession(sock, sessionKey);
    }

    const session = {
        chatId,
        hunterId,

        identities: [
            identity.pn,
            identity.lid,
            identity.primary
        ]
            .map(normalizeJid)
            .filter(Boolean),

        step: "action",
        action: null,

        processing: false,
        listener: null,
        timeout: null
    };

    activeSessions.set(
        sessionKey,
        session
    );

    // نسجل المستمع قبل إرسال القائمة.
    registerSessionListener(
        sock,
        session,
        sessionKey
    );

    refreshTimeout(
        sock,
        sessionKey
    );

    const playerInfo = getShopPlayerInfo(hunterId);

    await sock.sendMessage(
        chatId,
        {
            text:
                getShopText() +
                `\n\n💰 رصيدك الحالي: ${playerInfo?.gold ?? 0} ذهب`
        },
        {
            quoted: msg
        }
    );
}


// ==========================================
// EXPORT
// ==========================================

export default {
    NovaUltra,

    async execute({ sock, msg, sender }) {
        await startShop(
            sock,
            msg,
            sender
        );
    }
};
