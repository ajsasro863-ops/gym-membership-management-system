const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "data", "gym.sqlite");
const DATA_DIR = path.dirname(DB_FILE);

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db;

function persist() {
    const bytes = db.export();
    fs.writeFileSync(DB_FILE, Buffer.from(bytes));
}

function run(sql, params = []) {
    db.run(sql, params);
}

function one(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);

    let result = null;

    if (stmt.step()) {
        result = stmt.getAsObject();
    }

    stmt.free();
    return result;
}

function all(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);

    const rows = [];

    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }

    stmt.free();
    return rows;
}

function id(prefix) {
    return prefix + "-" +
        Date.now().toString(36).toUpperCase() + "-" +
        Math.random().toString(36).slice(2, 6).toUpperCase();
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function addDays(date, days) {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + Number(days));
    return d.toISOString().slice(0, 10);
}

function memberStatus(m) {
    if (m.status === "Inactive") {
        return "Inactive";
    }

    const diff = Math.ceil(
        (new Date(m.expiry_date + "T23:59:59") - new Date()) / 86400000
    );

    return diff < 0
        ? "Expired"
        : diff <= 7
        ? "Expiring soon"
        : "Active";
}

function safeUser(u) {
    return {
        id: u.id,
        name: u.name,
        username: u.username,
        role: u.role
    };
}

function auth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({
            error: "Please sign in."
        });
    }

    next();
}

function admin(req, res, next) {
    if (!req.session.user || req.session.user.role !== "Admin") {
        return res.status(403).json({
            error: "Administrator access required."
        });
    }

    next();
}

(async () => {

    const SQL = await initSqlJs({
        locateFile: file =>
            path.join(__dirname, "node_modules", "sql.js", "dist", file)
    });

    if (fs.existsSync(DB_FILE)) {
        db = new SQL.Database(
            new Uint8Array(fs.readFileSync(DB_FILE))
        );
    } else {
        db = new SQL.Database();
    }

    // DATABASE TABLES

    run(`
        CREATE TABLE IF NOT EXISTS users(
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    `);

    run(`
        CREATE TABLE IF NOT EXISTS plans(
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            duration_days INTEGER NOT NULL,
            price REAL NOT NULL,
            description TEXT DEFAULT ''
        )
    `);

    run(`
        CREATE TABLE IF NOT EXISTS members(
            id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            phone TEXT NOT NULL,
            email TEXT,
            gender TEXT,
            plan_id TEXT,
            plan_name TEXT,
            start_date TEXT NOT NULL,
            expiry_date TEXT NOT NULL,
            status TEXT DEFAULT 'Active',
            notes TEXT,
            created_at TEXT NOT NULL
        )
    `);

    run(`
        CREATE TABLE IF NOT EXISTS payments(
            id TEXT PRIMARY KEY,
            member_id TEXT NOT NULL,
            member_name TEXT NOT NULL,
            amount REAL NOT NULL,
            method TEXT NOT NULL,
            type TEXT NOT NULL,
            payment_date TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    `);

    run(`
        CREATE TABLE IF NOT EXISTS attendance(
            id TEXT PRIMARY KEY,
            member_id TEXT NOT NULL,
            member_name TEXT NOT NULL,
            visit_date TEXT NOT NULL,
            checkin_time TEXT NOT NULL
        )
    `);

    // DEFAULT ACCOUNTS

    if (!one("SELECT id FROM users WHERE username=?", ["admin"])) {
        run(
            "INSERT INTO users VALUES(?,?,?,?,?,?)",
            [
                "U-ADMIN",
                "System Admin",
                "admin",
                bcrypt.hashSync("admin123", 10),
                "Admin",
                today()
            ]
        );

        run(
            "INSERT INTO users VALUES(?,?,?,?,?,?)",
            [
                "U-STAFF",
                "Gym Staff",
                "staff",
                bcrypt.hashSync("staff123", 10),
                "Staff",
                today()
            ]
        );
    }

    // DEFAULT MEMBERSHIP PLANS

    if (!one("SELECT id FROM plans LIMIT 1")) {
        const defaultPlans = [
            ["P-MONTH", "Monthly", 30, 800, "A flexible monthly membership."],
            ["P-QUARTER", "Quarterly", 90, 2100, "Three months of gym access."],
            ["P-ANNUAL", "Annual", 365, 7500, "Best value annual membership."]
        ];

        defaultPlans.forEach(p => {
            run("INSERT INTO plans VALUES(?,?,?,?,?)", p);
        });
    }

    persist();

    // MIDDLEWARE

    app.use(helmet({
        contentSecurityPolicy: false
    }));

    app.use(express.json({
        limit: "1mb"
    }));

    app.use(session({
        name: "fitzone.sid",
        secret: process.env.SESSION_SECRET ||
            "change-this-secret-before-public-deployment",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: false,
            maxAge: 8 * 60 * 60 * 1000
        }
    }));

    app.use(express.static(path.join(__dirname, "public")));

    // LOGIN AND LOGOUT

    app.post("/api/login", (req, res) => {
        const { username, password } = req.body || {};

        const u = one(
            "SELECT * FROM users WHERE username=?",
            [String(username || "").trim()]
        );

        if (!u || !bcrypt.compareSync(
            String(password || ""),
            u.password_hash
        )) {
            return res.status(401).json({
                error: "Incorrect username or password."
            });
        }

        req.session.user = safeUser(u);

        res.json({
            user: req.session.user
        });
    });

    app.post("/api/logout", (req, res) => {
        req.session.destroy(() => {
            res.json({ ok: true });
        });
    });

    app.get("/api/me", (req, res) => {
        res.json({
            user: req.session.user || null
        });
    });

    // DASHBOARD

    app.get("/api/dashboard", auth, (req, res) => {
        const members = all("SELECT * FROM members");

        const active = members.filter(m =>
            ["Active", "Expiring soon"].includes(memberStatus(m))
        ).length;

        const expired = members.filter(m =>
            memberStatus(m) === "Expired"
        ).length;

        const visits = one(
            "SELECT COUNT(*) AS n FROM attendance WHERE visit_date=?",
            [today()]
        ).n;

        const revenue = one(
            "SELECT COALESCE(SUM(amount),0) AS n FROM payments"
        ).n;

        res.json({
            total: members.length,
            active,
            expired,
            visits,
            revenue,

            alerts: members
                .filter(m => ["Expired", "Expiring soon"].includes(memberStatus(m)))
                .map(m => ({
                    ...m,
                    current_status: memberStatus(m)
                }))
                .slice(0, 8),

            recent: members
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .slice(0, 6)
        });
    });

    // MEMBERS

    app.get("/api/members", auth, (req, res) => {
        res.json(
            all("SELECT * FROM members ORDER BY created_at DESC")
                .map(m => ({
                    ...m,
                    current_status: memberStatus(m)
                }))
        );
    });

    app.post("/api/members", auth, (req, res) => {
        const b = req.body || {};

        const plan = one(
            "SELECT * FROM plans WHERE id=?",
            [b.plan_id]
        );

        if (!b.full_name || !b.phone || !b.start_date || !plan) {
            return res.status(400).json({
                error: "Complete all required member fields."
            });
        }

        const mid = id("GYM");
        const expiry = addDays(
            b.start_date,
            plan.duration_days - 1
        );

        run(
            "INSERT INTO members VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                mid,
                b.full_name.trim(),
                b.phone.trim(),
                b.email || "",
                b.gender || "",
                plan.id,
                plan.name,
                b.start_date,
                expiry,
                "Active",
                b.notes || "",
                today()
            ]
        );

        persist();

        res.status(201).json({
            id: mid,
            expiry_date: expiry
        });
    });

    app.put("/api/members/:id", auth, (req, res) => {
        const b = req.body || {};

        const old = one(
            "SELECT * FROM members WHERE id=?",
            [req.params.id]
        );

        if (!old) {
            return res.status(404).json({
                error: "Member not found."
            });
        }

        const p = one(
            "SELECT * FROM plans WHERE id=?",
            [b.plan_id || old.plan_id]
        );

        if (!b.full_name || !b.phone || !p) {
            return res.status(400).json({
                error: "Complete all required fields."
            });
        }

        const start = b.start_date || old.start_date;

        run(
            `UPDATE members
             SET full_name=?, phone=?, email=?, gender=?,
                 plan_id=?, plan_name=?, start_date=?,
                 expiry_date=?, notes=?
             WHERE id=?`,
            [
                b.full_name.trim(),
                b.phone.trim(),
                b.email || "",
                b.gender || "",
                p.id,
                p.name,
                start,
                addDays(start, p.duration_days - 1),
                b.notes || "",
                req.params.id
            ]
        );

        persist();
        res.json({ ok: true });
    });

    app.delete("/api/members/:id", admin, (req, res) => {
        if (!one("SELECT id FROM members WHERE id=?", [req.params.id])) {
            return res.status(404).json({
                error: "Member not found."
            });
        }

        run("DELETE FROM members WHERE id=?", [req.params.id]);

        persist();
        res.json({ ok: true });
    });

    // MEMBERSHIP RENEWAL

    app.post("/api/members/:id/renew", auth, (req, res) => {
        const m = one(
            "SELECT * FROM members WHERE id=?",
            [req.params.id]
        );

        const p = one(
            "SELECT * FROM plans WHERE id=?",
            [req.body.plan_id]
        );

        if (!m || !p) {
            return res.status(404).json({
                error: "Member or plan not found."
            });
        }

        const start = req.body.start_date ||
            (m.expiry_date >= today()
                ? addDays(m.expiry_date, 1)
                : today());

        const expiry = addDays(start, p.duration_days - 1);

        run(
            `UPDATE members
             SET plan_id=?, plan_name=?, start_date=?,
                 expiry_date=?, status='Active'
             WHERE id=?`,
            [p.id, p.name, start, expiry, m.id]
        );

        const receipt = id("RCT");

        run(
            "INSERT INTO payments VALUES(?,?,?,?,?,?,?,?)",
            [
                receipt,
                m.id,
                m.full_name,
                p.price,
                req.body.method || "Cash",
                "Renewal",
                today(),
                new Date().toISOString()
            ]
        );

        persist();

        res.json({
            ok: true,
            receipt,
            expiry_date: expiry
        });
    });

    // MEMBERSHIP PLANS

    app.get("/api/plans", auth, (req, res) => {
        res.json(all("SELECT * FROM plans ORDER BY price"));
    });

    app.post("/api/plans", admin, (req, res) => {
        const b = req.body || {};

        if (!b.name || Number(b.duration_days) < 1 || Number(b.price) < 0) {
            return res.status(400).json({
                error: "Enter a valid plan name, duration and price."
            });
        }

        const pid = id("PLN");

        run(
            "INSERT INTO plans VALUES(?,?,?,?,?)",
            [
                pid,
                b.name,
                Number(b.duration_days),
                Number(b.price),
                b.description || ""
            ]
        );

        persist();
        res.status(201).json({ id: pid });
    });

    app.put("/api/plans/:id", admin, (req, res) => {
        const b = req.body || {};

        run(
            `UPDATE plans
             SET name=?, duration_days=?, price=?, description=?
             WHERE id=?`,
            [
                b.name,
                Number(b.duration_days),
                Number(b.price),
                b.description || "",
                req.params.id
            ]
        );

        persist();
        res.json({ ok: true });
    });

    app.delete("/api/plans/:id", admin, (req, res) => {
        if (one("SELECT id FROM members WHERE plan_id=?", [req.params.id])) {
            return res.status(409).json({
                error: "This plan is assigned to a member."
            });
        }

        run("DELETE FROM plans WHERE id=?", [req.params.id]);

        persist();
        res.json({ ok: true });
    });

    // PAYMENTS

    app.get("/api/payments", auth, (req, res) => {
        res.json(
            all("SELECT * FROM payments ORDER BY created_at DESC")
        );
    });

    app.post("/api/payments", auth, (req, res) => {
        const b = req.body || {};

        const m = one(
            "SELECT * FROM members WHERE id=?",
            [b.member_id]
        );

        if (!m || Number(b.amount) <= 0) {
            return res.status(400).json({
                error: "Select a member and enter a valid amount."
            });
        }

        const pid = id("RCT");

        run(
            "INSERT INTO payments VALUES(?,?,?,?,?,?,?,?)",
            [
                pid,
                m.id,
                m.full_name,
                Number(b.amount),
                b.method || "Cash",
                b.type || "Membership",
                b.payment_date || today(),
                new Date().toISOString()
            ]
        );

        persist();
        res.status(201).json({ id: pid });
    });

    // ATTENDANCE

    app.get("/api/attendance", auth, (req, res) => {
        res.json(
            all("SELECT * FROM attendance ORDER BY visit_date DESC, checkin_time DESC")
        );
    });

    app.post("/api/attendance", auth, (req, res) => {
        const m = one(
            "SELECT * FROM members WHERE id=?",
            [String(req.body.member_id || "").trim()]
        );

        if (!m) {
            return res.status(404).json({
                error: "Member ID not found."
            });
        }

        const s = memberStatus(m);

        if (s === "Expired" || s === "Inactive") {
            return res.status(403).json({
                error: "Membership is not active. Renew before check-in."
            });
        }

        if (one(
            "SELECT id FROM attendance WHERE member_id=? AND visit_date=?",
            [m.id, today()]
        )) {
            return res.status(409).json({
                error: "This member has already checked in today."
            });
        }

        const time = new Date().toLocaleTimeString("en-PH", {
            hour: "2-digit",
            minute: "2-digit"
        });

        run(
            "INSERT INTO attendance VALUES(?,?,?,?,?)",
            [
                id("ATT"),
                m.id,
                m.full_name,
                today(),
                time
            ]
        );

        persist();

        res.status(201).json({
            ok: true,
            member: m.full_name,
            time
        });
    });

    // USER ACCOUNTS

    app.get("/api/users", admin, (req, res) => {
        res.json(
            all("SELECT id,name,username,role,created_at FROM users")
        );
    });

    app.post("/api/users", admin, (req, res) => {
        const b = req.body || {};

        if (!b.name || !b.username || String(b.password || "").length < 6) {
            return res.status(400).json({
                error: "Name, username and password (at least 6 characters) are required."
            });
        }

        if (one("SELECT id FROM users WHERE username=?", [b.username])) {
            return res.status(409).json({
                error: "Username already exists."
            });
        }

        const uid = id("USR");

        run(
            "INSERT INTO users VALUES(?,?,?,?,?,?)",
            [
                uid,
                b.name,
                b.username,
                bcrypt.hashSync(b.password, 10),
                b.role === "Admin" ? "Admin" : "Staff",
                today()
            ]
        );

        persist();
        res.status(201).json({ id: uid });
    });

    app.delete("/api/users/:id", admin, (req, res) => {
        if (req.params.id === "U-ADMIN") {
            return res.status(400).json({
                error: "The primary admin account cannot be deleted."
            });
        }

        run("DELETE FROM users WHERE id=?", [req.params.id]);

        persist();
        res.json({ ok: true });
    });

    // REPORTS

    app.get("/api/reports", admin, (req, res) => {
        const payments = all(
            "SELECT * FROM payments ORDER BY created_at DESC"
        );

        const members = all(
            "SELECT * FROM members"
        ).map(m => ({
            ...m,
            current_status: memberStatus(m)
        }));

        const attendance = all(
            "SELECT * FROM attendance ORDER BY visit_date DESC"
        );

        const methods = ["Cash", "GCash", "Bank transfer", "Card"].map(method => ({
            method,
            total: payments
                .filter(p => p.method === method)
                .reduce((s, p) => s + Number(p.amount), 0)
        }));

        res.json({
            payments,
            members,
            attendance,
            methods,
            revenue: payments.reduce((s, p) => s + Number(p.amount), 0),
            renewals: payments.filter(p => p.type === "Renewal").length
        });
    });

    // OPEN SYSTEM

    app.get("*", (req, res) => {
        res.sendFile(
            path.join(__dirname, "public", "index.html")
        );
    });

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`FitZone running at http://localhost:${PORT}`);
    });

})().catch(err => {
    console.error(err);
    process.exit(1);
});