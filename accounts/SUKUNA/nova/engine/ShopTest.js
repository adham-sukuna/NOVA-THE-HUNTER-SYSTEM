import fs from "fs";
import os from "os";
import path from "path";
import assert from "assert";
import { fileURLToPath, pathToFileURL } from "url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_ENGINE = __dirname;
const SOURCE_DATABASE = path.resolve(
    __dirname,
    "../database"
);

const TEST_HUNTER_ID = "nova-shop-test-hunter";
const TEST_HUNTER_PN = "201000000000@s.whatsapp.net";


let TEMP_ROOT = null;
let passed = 0;
let failed = 0;


function logSuccess(message) {
    passed++;
    console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
}


function logFailure(message, error) {
    failed++;
    console.log(`\x1b[31m[FAIL]\x1b[0m ${message}`);

    if (error) {
        console.log("       ", error.message);
    }
}


function test(name, callback) {
    try {
        callback();
        logSuccess(name);
    } catch (error) {
        logFailure(name, error);
    }
}


function createTestEnvironment() {
    TEMP_ROOT = fs.mkdtempSync(
        path.join(os.tmpdir(), "nova-shop-test-")
    );

    const engineDir = path.join(
        TEMP_ROOT,
        "nova",
        "engine"
    );

    const databaseDir = path.join(
        TEMP_ROOT,
        "nova",
        "database"
    );

    const dataDir = path.join(
        TEMP_ROOT,
        "nova",
        "data"
    );

    fs.mkdirSync(engineDir, { recursive: true });
    fs.mkdirSync(databaseDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    // نسخ ملفات المحرك المطلوبة فقط.
    for (const file of [
        "ShopEngine.js",
        "InventoryEngine.js",
        "storage.js"
    ]) {
        fs.copyFileSync(
            path.join(SOURCE_ENGINE, file),
            path.join(engineDir, file)
        );
    }

    // نسخ قواعد بيانات العناصر والمتجر.
    for (const file of [
        "items.json",
        "shop.json"
    ]) {
        fs.copyFileSync(
            path.join(SOURCE_DATABASE, file),
            path.join(databaseDir, file)
        );
    }

    // إنشاء صياد تجريبي مستقل.
    const hunters = {
        [TEST_HUNTER_PN]: {
            id: TEST_HUNTER_ID,
            name: "NOVA TEST HUNTER",

            identities: {
                pn: TEST_HUNTER_PN,
                lid: null
            },

            level: 10,
            gold: 0,
            lastActive: Date.now()
        }
    };

    fs.writeFileSync(
        path.join(dataDir, "hunter_profiles.json"),
        JSON.stringify(hunters, null, 2)
    );

    return {
        engineDir,
        dataDir
    };
}


async function runTests() {
    console.log("\n================================");
    console.log("       NOVA SHOP TEST");
    console.log("================================\n");

    const environment = createTestEnvironment();

    const shopPath = pathToFileURL(
        path.join(environment.engineDir, "ShopEngine.js")
    ).href;

    const inventoryPath = pathToFileURL(
        path.join(environment.engineDir, "InventoryEngine.js")
    ).href;

    const storagePath = pathToFileURL(
        path.join(environment.engineDir, "storage.js")
    ).href;

    const Shop = await import(shopPath);
    const Inventory = await import(inventoryPath);
    const Storage = await import(storagePath);

    const identity = TEST_HUNTER_PN;

    // =====================================
    // TEST 1: SHOP DATABASE
    // =====================================

    const shopItems = Shop.getShopItems();

    test(
        "تحميل منتجات المتجر",
        () => {
            assert.ok(Array.isArray(shopItems));
            assert.ok(shopItems.length > 0);
        }
    );

    const testItem = shopItems.find(item =>
        item.buyPrice > 0 &&
        item.sellPrice > 0
    );

    test(
        "وجود منتج قابل للشراء والبيع",
        () => {
            assert.ok(testItem);
        }
    );

    if (!testItem) {
        throw new Error(
            "لا يوجد منتج بأسعار شراء وبيع صالحة للاختبار."
        );
    }

    test(
        "قراءة معلومات المنتج",
        () => {
            const info = Shop.getShopItemInfo(testItem.id);

            assert.ok(info);
            assert.strictEqual(info.id, testItem.id);
            assert.ok(info.buyPrice > 0);
        }
    );

    // =====================================
    // TEST 2: HUNTER
    // =====================================

    test(
        "قراءة بيانات الصياد التجريبي",
        () => {
            const info = Shop.getShopPlayerInfo(identity);

            assert.ok(info);
            assert.strictEqual(
                info.hunterId,
                TEST_HUNTER_ID
            );

            assert.strictEqual(info.gold, 0);
        }
    );

    // =====================================
    // TEST 3: INVALID PURCHASES
    // =====================================

    test(
        "رفض الكمية غير الصالحة",
        () => {
            const result = Shop.buyItem(
                identity,
                testItem.id,
                0
            );

            assert.strictEqual(result.success, false);
            assert.strictEqual(
                result.reason,
                "INVALID_QUANTITY"
            );
        }
    );

    test(
        "رفض شراء منتج غير موجود",
        () => {
            const result = Shop.buyItem(
                identity,
                "nova_invalid_item",
                1
            );

            assert.strictEqual(result.success, false);
            assert.strictEqual(
                result.reason,
                "ITEM_NOT_AVAILABLE"
            );
        }
    );

    test(
        "منع الشراء عند عدم كفاية الذهب",
        () => {
            const result = Shop.buyItem(
                identity,
                testItem.id,
                1
            );

            assert.strictEqual(result.success, false);
            assert.strictEqual(
                result.reason,
                "NOT_ENOUGH_GOLD"
            );
        }
    );

    // =====================================
    // TEST 4: ADD TEST GOLD
    // =====================================

    const hunters = Storage.getHunters();

    hunters[TEST_HUNTER_PN].gold = 10000;

    Storage.saveHunters(hunters);

    const startingGold = 10000;

    // =====================================
    // TEST 5: BUY
    // =====================================

    const purchase = Shop.buyItem(
        identity,
        testItem.id,
        1
    );

    test(
        "شراء منتج بنجاح",
        () => {
            assert.strictEqual(purchase.success, true);
            assert.strictEqual(purchase.itemId, testItem.id);
            assert.strictEqual(purchase.quantity, 1);
            assert.strictEqual(
                purchase.totalPrice,
                testItem.buyPrice
            );
        }
    );

    test(
        "خصم الذهب بعد الشراء",
        () => {
            const info = Shop.getShopPlayerInfo(identity);

            assert.strictEqual(
                info.gold,
                startingGold - testItem.buyPrice
            );
        }
    );

    test(
        "إضافة المنتج للمخزون",
        () => {
            assert.strictEqual(
                Inventory.getItemQuantity(
                    TEST_HUNTER_ID,
                    testItem.id
                ),
                1
            );
        }
    );

    // =====================================
    // TEST 6: SELL
    // =====================================

    const sale = Shop.sellItem(
        identity,
        testItem.id,
        1
    );

    test(
        "بيع المنتج بنجاح",
        () => {
            assert.strictEqual(sale.success, true);
            assert.strictEqual(sale.itemId, testItem.id);
            assert.strictEqual(sale.quantity, 1);
            assert.strictEqual(
                sale.totalPrice,
                testItem.sellPrice
            );
        }
    );

    test(
        "إضافة الذهب بعد البيع",
        () => {
            const info = Shop.getShopPlayerInfo(identity);

            assert.strictEqual(
                info.gold,
                startingGold -
                testItem.buyPrice +
                testItem.sellPrice
            );
        }
    );

    test(
        "إزالة المنتج من المخزون بعد البيع",
        () => {
            assert.strictEqual(
                Inventory.getItemQuantity(
                    TEST_HUNTER_ID,
                    testItem.id
                ),
                0
            );
        }
    );

    // =====================================
    // TEST 7: INVALID SALES
    // =====================================

    test(
        "رفض بيع منتج غير موجود في المخزون",
        () => {
            const result = Shop.sellItem(
                identity,
                testItem.id,
                1
            );

            assert.strictEqual(result.success, false);
            assert.strictEqual(
                result.reason,
                "NOT_ENOUGH_ITEMS"
            );
        }
    );

    test(
        "رفض كمية بيع غير صالحة",
        () => {
            const result = Shop.sellItem(
                identity,
                testItem.id,
                -1
            );

            assert.strictEqual(result.success, false);
            assert.strictEqual(
                result.reason,
                "INVALID_QUANTITY"
            );
        }
    );
}


try {
    await runTests();
} catch (error) {
    console.log("\n\x1b[31m[TEST ERROR]\x1b[0m");
    console.error(error);
    failed++;
} finally {
    if (TEMP_ROOT && fs.existsSync(TEMP_ROOT)) {
        fs.rmSync(TEMP_ROOT, {
            recursive: true,
            force: true
        });
    }

    console.log("\n================================");
    console.log(`PASS: ${passed}`);
    console.log(`FAIL: ${failed}`);
    console.log("================================\n");

    if (failed > 0) {
        process.exitCode = 1;
    }
}
