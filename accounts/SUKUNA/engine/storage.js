import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// تحديد مكان الملف الحالي
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// مجلد بيانات NOVA
const DATA_DIR = path.resolve(__dirname, "../data");

// ملفات قاعدة البيانات
export const DATA_FILES = {
    hunters: path.join(DATA_DIR, "hunter_profiles.json")
};

// إنشاء مجلد البيانات عند الحاجة
fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * قراءة ملف JSON
 */
export function readData(file, fallback = {}) {
    if (!fs.existsSync(file)) {
        writeData(file, fallback);
        return structuredClone(fallback);
    }

    try {
        const content = fs.readFileSync(file, "utf8");

        if (!content.trim()) {
            throw new Error("File is empty");
        }

        return JSON.parse(content);

    } catch (error) {
        throw new Error(
            `NOVA STORAGE: Invalid JSON in ${file}: ${error.message}`
        );
    }
}

/**
 * حفظ البيانات بطريقة تقلل احتمالية تلف الملف
 */
export function writeData(file, data) {
    fs.mkdirSync(path.dirname(file), {
        recursive: true
    });

    const temp = `${file}.${process.pid}.tmp`;

    try {
        fs.writeFileSync(
            temp,
            JSON.stringify(data, null, 2),
            "utf8"
        );

        fs.renameSync(temp, file);

    } catch (error) {
        if (fs.existsSync(temp)) {
            fs.unlinkSync(temp);
        }

        throw error;
    }
}

/**
 * بيانات الصيادين
 */
export function getHunters() {
    return readData(DATA_FILES.hunters, {});
}

/**
 * حفظ بيانات الصيادين
 */
export function saveHunters(data) {
    writeData(DATA_FILES.hunters, data);
}

/**
 * مسار قاعدة البيانات
 */
export function getDataDirectory() {
    return DATA_DIR;
}
