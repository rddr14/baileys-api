const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'global_directory.db');
const INVALID_NAMES = new Set([
    'você',
    'cliente whatsapp',
    'desconhecido',
    'sem nome',
    '-',
    'null',
    'undefined'
]);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');
db.pragma('cache_size = -8000');

db.exec(`
    CREATE TABLE IF NOT EXISTS identities (
        phone_e164 TEXT PRIMARY KEY,
        phone_last8 TEXT,
        jid TEXT,
        lid TEXT,
        crm_name TEXT,
        crm_context TEXT,
        addressbook_name TEXT,
        verified_name TEXT,
        push_name TEXT,
        vcard_name TEXT,
        is_business INTEGER DEFAULT 0,
        updated_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_identities_last8 ON identities(phone_last8);
    CREATE INDEX IF NOT EXISTS idx_identities_lid ON identities(lid);

    CREATE TABLE IF NOT EXISTS lid_pn_map (
        lid TEXT PRIMARY KEY,
        phone_e164 TEXT NOT NULL,
        jid TEXT NOT NULL,
        updated_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_lid_pn_map_phone ON lid_pn_map(phone_e164);
`);

const stmts = {
    upsertLidMap: db.prepare(`
        INSERT OR REPLACE INTO lid_pn_map (lid, phone_e164, jid, updated_at)
        VALUES (?, ?, ?, ?)
    `),
    getPhoneByLid: db.prepare(`
        SELECT phone_e164, jid FROM lid_pn_map WHERE lid = ?
    `),
    getLidByPhoneExact: db.prepare(`
        SELECT lid FROM lid_pn_map WHERE phone_e164 = ? ORDER BY updated_at DESC LIMIT 1
    `),
    getLidByPhoneLast8Prefix: db.prepare(`
        SELECT lid FROM lid_pn_map
        WHERE substr(phone_e164, -8) = ? AND substr(phone_e164, 1, 4) = ?
        ORDER BY updated_at DESC LIMIT 1
    `),
    getIdentityByPhone: db.prepare(`
        SELECT * FROM identities WHERE phone_e164 = ?
    `),
    getIdentityByLast8Prefix: db.prepare(`
        SELECT * FROM identities
        WHERE phone_last8 = ? AND substr(phone_e164, 1, 4) = ?
        ORDER BY length(phone_e164) DESC, updated_at DESC LIMIT 1
    `),
    getIdentityByLid: db.prepare(`
        SELECT * FROM identities WHERE lid = ? LIMIT 1
    `),
    insertIdentity: db.prepare(`
        INSERT INTO identities (
            phone_e164, phone_last8, jid, lid,
            crm_name, crm_context, addressbook_name, verified_name, push_name, vcard_name,
            is_business, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateIdentity: db.prepare(`
        UPDATE identities SET
            phone_last8 = ?,
            jid = ?,
            lid = ?,
            crm_name = ?,
            crm_context = ?,
            addressbook_name = ?,
            verified_name = ?,
            push_name = ?,
            vcard_name = ?,
            is_business = ?,
            updated_at = ?
        WHERE phone_e164 = ?
    `),
    updateIdentityLid: db.prepare(`
        UPDATE identities SET lid = ?, updated_at = ? WHERE phone_e164 = ?
    `),
    statsTotalIdentities: db.prepare(`SELECT COUNT(*) AS cnt FROM identities`),
    statsTotalLidMappings: db.prepare(`SELECT COUNT(*) AS cnt FROM lid_pn_map`),
    statsTotalCrmNamed: db.prepare(`SELECT COUNT(*) AS cnt FROM identities WHERE crm_name IS NOT NULL AND crm_name != ''`),
    statsTotalPushNamed: db.prepare(`SELECT COUNT(*) AS cnt FROM identities WHERE push_name IS NOT NULL AND push_name != ''`),
    statsTotalAddressbookNamed: db.prepare(`SELECT COUNT(*) AS cnt FROM identities WHERE addressbook_name IS NOT NULL AND addressbook_name != ''`),
    searchIdentitiesByText: db.prepare(`
        SELECT phone_e164 FROM identities
        WHERE lower(coalesce(crm_name, '')) LIKE ?
           OR lower(coalesce(addressbook_name, '')) LIKE ?
           OR lower(coalesce(push_name, '')) LIKE ?
           OR lower(coalesce(verified_name, '')) LIKE ?
           OR lower(coalesce(vcard_name, '')) LIKE ?
           OR phone_e164 LIKE ?
        ORDER BY updated_at DESC
        LIMIT ?
    `)
};

/**
 * Normalizes a phone number or JID into E.164 digits only.
 * Ignores group, lid, broadcast, and newsletter JIDs.
 */
function normalizePhone(raw) {
    if (raw === null || raw === undefined) return null;
    const str = String(raw).trim();
    if (!str) return null;
    if (
        str.includes('@lid') ||
        str.includes('@g.us') ||
        str.includes('@broadcast') ||
        str.includes('@newsletter')
    ) {
        return null;
    }
    const clean = str.replace(/@.*/g, '').replace(/\D/g, '');
    if (clean.length < 8) return null;
    return clean;
}

/**
 * Normalizes a WhatsApp LID string to `<id>@lid`.
 */
function normalizeLid(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed.includes('@lid')) return null;
    const user = trimmed.split('@')[0].split(':')[0];
    if (!user) return null;
    return `${user}@lid`;
}

/**
 * Returns the last 8 digits of a phone string.
 */
function last8(phone) {
    if (!phone || typeof phone !== 'string') return null;
    return phone.length >= 8 ? phone.slice(-8) : phone;
}

/**
 * Checks whether a candidate display name is empty, placeholder, or lacks letters.
 */
function isInvalidName(name) {
    if (!name || typeof name !== 'string') return true;
    const trimmed = name.trim();
    if (!trimmed) return true;
    if (INVALID_NAMES.has(trimmed.toLowerCase())) return true;
    // Reject names made solely of digits/punctuation/symbols with no alphabetic characters
    if (!/\p{L}/u.test(trimmed)) return true;
    return false;
}

function cleanValidName(name) {
    if (isInvalidName(name)) return null;
    return name.trim();
}

function findExistingIdentityRow(phone) {
    if (!phone) return null;
    const exact = stmts.getIdentityByPhone.get(phone);
    if (exact) return exact;
    if (phone.startsWith('55') && (phone.length === 12 || phone.length === 13)) {
        return stmts.getIdentityByLast8Prefix.get(last8(phone), phone.slice(0, 4)) || null;
    }
    return null;
}

/**
 * Records a LID <-> phone mapping and links it in the identities table.
 */
function recordLidMapping(lid, pnOrJid) {
    const normLid = normalizeLid(lid);
    const normPhone = normalizePhone(pnOrJid);
    if (!normLid || !normPhone) return false;

    const now = Date.now();
    const jid = `${normPhone}@s.whatsapp.net`;

    stmts.upsertLidMap.run(normLid, normPhone, jid, now);

    const existing = findExistingIdentityRow(normPhone);
    if (existing) {
        if (existing.lid !== normLid) {
            stmts.updateIdentityLid.run(normLid, now, existing.phone_e164);
        }
    } else {
        stmts.insertIdentity.run(
            normPhone,
            last8(normPhone),
            jid,
            normLid,
            null,
            null,
            null,
            null,
            null,
            null,
            0,
            now
        );
    }
    return true;
}

/**
 * Resolves a phone and JID from a LID via `lid_pn_map`.
 */
function resolvePhoneFromLid(lid) {
    const normLid = normalizeLid(lid);
    if (!normLid) return null;
    const row = stmts.getPhoneByLid.get(normLid);
    if (!row) return null;
    return { phone: row.phone_e164, jid: row.jid };
}

/**
 * Resolves a LID from a phone number or JID via `lid_pn_map`.
 */
function resolveLidFromPhone(phone) {
    const normPhone = normalizePhone(phone);
    if (!normPhone) return null;
    const exact = stmts.getLidByPhoneExact.get(normPhone);
    if (exact?.lid) return exact.lid;
    if (normPhone.startsWith('55') && (normPhone.length === 12 || normPhone.length === 13)) {
        const fuzzy = stmts.getLidByPhoneLast8Prefix.get(last8(normPhone), normPhone.slice(0, 4));
        if (fuzzy?.lid) return fuzzy.lid;
    }
    return null;
}

/**
 * Inserts or non-destructively merges an identity record into the global directory.
 */
function upsertIdentity({
    phone,
    lid,
    crmName,
    crmContext,
    addressbookName,
    verifiedName,
    pushName,
    vcardName,
    isBusiness
} = {}) {
    let normPhone = normalizePhone(phone);
    const normLid = normalizeLid(lid);

    if (!normPhone && normLid) {
        const mapped = resolvePhoneFromLid(normLid);
        if (mapped?.phone) {
            normPhone = mapped.phone;
        }
    }

    if (!normPhone) return null;

    if (normLid) {
        recordLidMapping(normLid, normPhone);
    }

    const now = Date.now();
    const validCrmName = cleanValidName(crmName);
    const validAddressbookName = cleanValidName(addressbookName);
    const validVerifiedName = cleanValidName(verifiedName);
    const validPushName = cleanValidName(pushName);
    const validVcardName = cleanValidName(vcardName);

    let serializedContext = null;
    if (crmContext !== undefined && crmContext !== null) {
        serializedContext = typeof crmContext === 'string' ? crmContext : JSON.stringify(crmContext);
    }

    const existing = findExistingIdentityRow(normPhone);
    if (existing) {
        stmts.updateIdentity.run(
            existing.phone_last8 || last8(existing.phone_e164),
            existing.jid || `${existing.phone_e164}@s.whatsapp.net`,
            normLid || existing.lid || null,
            validCrmName || existing.crm_name || null,
            serializedContext !== null ? serializedContext : (existing.crm_context || null),
            validAddressbookName || existing.addressbook_name || null,
            validVerifiedName || existing.verified_name || null,
            validPushName || existing.push_name || null,
            validVcardName || existing.vcard_name || null,
            existing.is_business || (isBusiness ? 1 : 0),
            now,
            existing.phone_e164
        );
        return existing.phone_e164;
    }

    const jid = `${normPhone}@s.whatsapp.net`;
    stmts.insertIdentity.run(
        normPhone,
        last8(normPhone),
        jid,
        normLid || resolveLidFromPhone(normPhone) || null,
        validCrmName,
        serializedContext,
        validAddressbookName,
        validVerifiedName,
        validPushName,
        validVcardName,
        isBusiness ? 1 : 0,
        now
    );
    return normPhone;
}

const bulkSyncTransaction = db.transaction((records) => {
    let synced = 0;
    for (const rec of records) {
        if (!rec) continue;
        const result = upsertIdentity({
            phone: rec.phone,
            crmName: rec.crmName,
            crmContext: rec.crmContext
        });
        if (result) synced++;
    }
    return synced;
});

/**
 * Bulk-syncs CRM records inside a single SQLite transaction.
 */
function bulkSyncCrm(records) {
    if (!Array.isArray(records) || records.length === 0) return 0;
    return bulkSyncTransaction(records);
}

function safeParseJson(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try {
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

/**
 * Resolves a unified identity by phone number, JID, or LID.
 */
function resolveIdentity(phoneOrJidOrLid) {
    if (!phoneOrJidOrLid) return null;

    const normLid = normalizeLid(String(phoneOrJidOrLid));
    let normPhone = normalizePhone(phoneOrJidOrLid);
    let row = null;

    if (normLid) {
        const mapped = resolvePhoneFromLid(normLid);
        if (mapped?.phone) {
            normPhone = mapped.phone;
        }
        row = stmts.getIdentityByLid.get(normLid) || null;
    }

    if (!row && normPhone) {
        row = findExistingIdentityRow(normPhone);
    }

    if (!row) return null;

    const resolvedLid = row.lid || normLid || resolveLidFromPhone(row.phone_e164) || null;
    const bestName =
        row.addressbook_name ||
        row.crm_name ||
        row.verified_name ||
        row.push_name ||
        row.vcard_name ||
        null;
    const bestPushName =
        row.push_name ||
        row.verified_name ||
        row.vcard_name ||
        row.addressbook_name ||
        row.crm_name ||
        null;

    return {
        phone: row.phone_e164,
        jid: row.jid,
        lid: resolvedLid,
        name: bestName,
        pushName: bestPushName,
        crmName: row.crm_name || null,
        crmContext: safeParseJson(row.crm_context),
        addressbookName: row.addressbook_name || null,
        verifiedName: row.verified_name || null,
        vcardName: row.vcard_name || null,
        isBusiness: Boolean(row.is_business)
    };
}

/**
 * Searches identities in the global directory by phone fragment or display name.
 */
function searchIdentities(term, limit = 50) {
    if (!term || typeof term !== 'string') return [];
    const trimmed = term.trim().toLowerCase();
    if (!trimmed) return [];
    const like = `%${trimmed}%`;
    const rows = stmts.searchIdentitiesByText.all(like, like, like, like, like, like, limit);
    const results = [];
    for (const r of rows) {
        const resolved = resolveIdentity(r.phone_e164);
        if (resolved) results.push(resolved);
    }
    return results;
}

/**
 * Returns aggregate counts from the global directory database.
 */
function getStats() {
    return {
        totalIdentities: stmts.statsTotalIdentities.get().cnt,
        totalLidMappings: stmts.statsTotalLidMappings.get().cnt,
        totalCrmNamed: stmts.statsTotalCrmNamed.get().cnt,
        totalPushNamed: stmts.statsTotalPushNamed.get().cnt,
        totalAddressbookNamed: stmts.statsTotalAddressbookNamed.get().cnt
    };
}

module.exports = {
    db,
    normalizePhone,
    normalizeLid,
    last8,
    isInvalidName,
    recordLidMapping,
    resolvePhoneFromLid,
    resolveLidFromPhone,
    upsertIdentity,
    bulkSyncCrm,
    resolveIdentity,
    searchIdentities,
    getStats
};
