const $ = id => document.getElementById(id);

const money = n =>
    "₱" + Number(n || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));

const today = () => new Date().toISOString().slice(0, 10);

let me = null;

let cache = {
    members: [],
    plans: [],
    payments: [],
    attendance: [],
    users: [],
    reports: null
};

// API REQUEST

async function api(url, opts = {}) {
    const r = await fetch(url, {
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
            ...(opts.headers || {})
        },
        ...opts
    });

    let data = {};

    try {
        data = await r.json();
    } catch {}

    if (!r.ok) {
        throw Error(data.error || "Request failed");
    }

    return data;
}

// MESSAGE

function toast(s) {
    const t = $("toast");

    t.textContent = s;
    t.classList.add("show");

    setTimeout(() => {
        t.classList.remove("show");
    }, 2500);
}

// MODAL

function modal(title, html) {
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = html;
    $("modal").classList.remove("hidden");
}

function closeModal() {
    $("modal").classList.add("hidden");
}

// STATUS BADGE

function pill(s) {
    let c = s === "Active"
        ? "active"
        : s === "Expired"
        ? "expired"
        : "expiring";

    return `<span class="pill ${c}">${esc(s)}</span>`;
}

// NAVIGATION

function nav(name) {
    document.querySelectorAll(".page").forEach(x => {
        x.classList.add("hidden");
    });

    $(name).classList.remove("hidden");

    document.querySelectorAll("#nav button").forEach(x => {
        x.classList.toggle("active", x.dataset.page === name);
    });

    $("heading").textContent =
        name === "plans"
            ? "Membership Plans"
            : name === "users"
            ? "User Accounts"
            : name[0].toUpperCase() + name.slice(1);

    $("sidebar").classList.remove("open");

    loadPage(name).catch(e => toast(e.message));
}

async function loadPage(name) {
    if (name === "dashboard") await dashboard();
    if (name === "members") await members();
    if (name === "plans") await plans();
    if (name === "payments") await payments();
    if (name === "attendance") await attendance();
    if (name === "notifications") await notifications();
    if (name === "reports") await reports();
    if (name === "users") await users();
}

// SELECT OPTIONS

function memberOptions() {
    return cache.members.map(m =>
        `<option value="${esc(m.id)}">${esc(m.full_name)} (${esc(m.id)})</option>`
    ).join("");
}

function planOptions(selected) {
    return cache.plans.map(p =>
        `<option value="${p.id}" ${p.id === selected ? "selected" : ""}>
            ${esc(p.name)} — ${money(p.price)}
        </option>`
    ).join("");
}

// DASHBOARD

async function dashboard() {
    const d = await api("/api/dashboard");

    $("total").textContent = d.total;
    $("active").textContent = d.active;
    $("expired").textContent = d.expired;
    $("visits").textContent = d.visits;

    $("alerts").innerHTML = d.alerts.length
        ? `<div class="table-wrap">
            <table>
                <tr>
                    <th>Member</th>
                    <th>Expiry</th>
                    <th>Status</th>
                </tr>

                ${d.alerts.map(m => `
                    <tr>
                        <td>${esc(m.full_name)}</td>
                        <td>${m.expiry_date}</td>
                        <td>${pill(m.current_status)}</td>
                    </tr>
                `).join("")}
            </table>
        </div>`
        : `<div class="empty">No membership alerts.</div>`;

    $("recent").innerHTML = d.recent.length
        ? table(
            ["Member", "Plan", "Expiry", "Status"],
            d.recent.map(m => [
                `${esc(m.full_name)}<small>${esc(m.id)}</small>`,
                esc(m.plan_name),
                m.expiry_date,
                pill(m.current_status)
            ])
        )
        : `<div class="empty">No members registered yet.</div>`;

    await api("/api/members").then(x => cache.members = x);
    await api("/api/plans").then(x => cache.plans = x);

    $("alertCount").textContent = d.alerts.length;
}

// TABLE GENERATOR

function table(head, rows) {
    return `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        ${head.map(x => `<th>${x}</th>`).join("")}
                    </tr>
                </thead>

                <tbody>
                    ${rows.map(r => `
                        <tr>
                            ${r.map(x => `<td>${x}</td>`).join("")}
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

// MEMBERS

async function members() {
    cache.members = await api("/api/members");

    const q = ($("memberSearch").value || "").toLowerCase();
    const f = $("memberFilter").value;

    let a = cache.members.filter(m =>
        (m.full_name + " " + m.id + " " + m.email)
            .toLowerCase()
            .includes(q)
        &&
        (f === "all" || m.current_status === f)
    );

    $("memberTable").innerHTML = a.length
        ? table(
            ["Member", "Phone", "Plan", "Expiry", "Status", "Actions"],

            a.map(m => [
                `<b>${esc(m.full_name)}</b>
                 <small>${esc(m.id)} · ${esc(m.email)}</small>`,

                esc(m.phone),
                esc(m.plan_name),
                m.expiry_date,
                pill(m.current_status),

                `<div class="actions">
                    <button class="action" data-edit="${m.id}">Edit</button>

                    <button class="action" data-renew="${m.id}">Renew</button>

                    ${
                        me.role === "Admin"
                        ? `<button class="action" data-delete="${m.id}">Delete</button>`
                        : ""
                    }
                </div>`
            ])
        )
        : `<div class="empty">No members found.</div>`;
}

// ADD OR EDIT MEMBER

function openMember(m) {
    const edit = !!m;

    modal(
        edit ? "Edit member" : "Register member",

        `<form id="memberForm" class="form-grid">

            <label>
                Full name
                <input name="full_name" required value="${esc(m?.full_name || "")}">
            </label>

            <label>
                Phone
                <input name="phone" required value="${esc(m?.phone || "")}">
            </label>

            <label>
                Email
                <input name="email" type="email" value="${esc(m?.email || "")}">
            </label>

            <label>
                Gender
                <select name="gender">
                    <option>Prefer not to say</option>
                    <option ${m?.gender === "Male" ? "selected" : ""}>Male</option>
                    <option ${m?.gender === "Female" ? "selected" : ""}>Female</option>
                </select>
            </label>

            <label>
                Membership plan
                <select name="plan_id" required>
                    ${planOptions(m?.plan_id || cache.plans[0]?.id)}
                </select>
            </label>

            <label>
                Start date
                <input name="start_date" type="date" required value="${m?.start_date || today()}">
            </label>

            <label class="span2">
                Notes
                <textarea name="notes">${esc(m?.notes || "")}</textarea>
            </label>

            <div class="form-actions span2">
                <button type="button" class="secondary" id="cancel">Cancel</button>

                <button class="primary">
                    ${edit ? "Save changes" : "Register member"}
                </button>
            </div>

        </form>`
    );

    $("cancel").onclick = closeModal;

    $("memberForm").onsubmit = async e => {
        e.preventDefault();

        try {
            await api(
                edit ? `/api/members/${m.id}` : "/api/members",
                {
                    method: edit ? "PUT" : "POST",
                    body: JSON.stringify(
                        Object.fromEntries(new FormData(e.target))
                    )
                }
            );

            closeModal();

            toast(edit ? "Member updated" : "Member registered");

            await members();
            await dashboard();

        } catch (x) {
            toast(x.message);
        }
    };
}

// RENEW MEMBERSHIP

async function renew(m) {
    modal(
        "Renew membership",

        `<form id="renewForm" class="form-grid">

            <label class="span2">
                Member
                <input disabled value="${esc(m.full_name)} (${esc(m.id)})">
            </label>

            <label class="span2">
                Plan
                <select name="plan_id">
                    ${planOptions(m.plan_id)}
                </select>
            </label>

            <label class="span2">
                Start date
                <input
                    type="date"
                    name="start_date"
                    value="${
                        m.expiry_date >= today()
                            ? new Date(
                                new Date(m.expiry_date + "T12:00:00").getTime()
                                + 86400000
                            ).toISOString().slice(0, 10)
                            : today()
                    }"
                >
            </label>

            <label class="span2">
                Payment method
                <select name="method">
                    <option>Cash</option>
                    <option>GCash</option>
                    <option>Bank transfer</option>
                    <option>Card</option>
                </select>
            </label>

            <div class="form-actions span2">
                <button type="button" class="secondary" id="cancel">Cancel</button>
                <button class="primary">Confirm renewal</button>
            </div>

        </form>`
    );

    $("cancel").onclick = closeModal;

    $("renewForm").onsubmit = async e => {
        e.preventDefault();

        try {
            await api(`/api/members/${m.id}/renew`, {
                method: "POST",
                body: JSON.stringify(
                    Object.fromEntries(new FormData(e.target))
                )
            });

            closeModal();

            toast("Membership renewed");

            await members();

        } catch (x) {
            toast(x.message);
        }
    };
}

// MEMBERSHIP PLANS

async function plans() {
    cache.plans = await api("/api/plans");

    $("planGrid").innerHTML = cache.plans.map(p => `
        <article class="plan">

            <small class="eyebrow">MEMBERSHIP PLAN</small>

            <h2>${esc(p.name)}</h2>

            <strong>${money(p.price)}</strong>

            <p>${p.duration_days} days</p>

            <p>${esc(p.description || "Gym membership access")}</p>

            ${
                me.role === "Admin"
                ? `<div class="actions">
                    <button class="action" data-plan-edit="${p.id}">Edit</button>
                    <button class="action" data-plan-delete="${p.id}">Delete</button>
                </div>`
                : ""
            }

        </article>
    `).join("") || `<div class="empty">No plans available.</div>`;
}

function openPlan(p) {
    modal(
        p ? "Edit plan" : "Add plan",

        `<form id="planForm" class="form-grid">

            <label class="span2">
                Plan name
                <input name="name" required value="${esc(p?.name || "")}">
            </label>

            <label>
                Duration in days
                <input name="duration_days" type="number" min="1" required value="${p?.duration_days || 30}">
            </label>

            <label>
                Price (₱)
                <input name="price" type="number" min="0" step=".01" required value="${p?.price ?? ""}">
            </label>

            <label class="span2">
                Description
                <textarea name="description">${esc(p?.description || "")}</textarea>
            </label>

            <div class="form-actions span2">
                <button type="button" class="secondary" id="cancel">Cancel</button>
                <button class="primary">Save plan</button>
            </div>

        </form>`
    );

    $("cancel").onclick = closeModal;

    $("planForm").onsubmit = async e => {
        e.preventDefault();

        try {
            await api(
                p ? `/api/plans/${p.id}` : "/api/plans",
                {
                    method: p ? "PUT" : "POST",
                    body: JSON.stringify(
                        Object.fromEntries(new FormData(e.target))
                    )
                }
            );

            closeModal();

            toast("Plan saved");

            plans();

        } catch (x) {
            toast(x.message);
        }
    };
}

// PAYMENTS

async function payments() {
    const a = await api("/api/payments");

    cache.payments = a;

    const q = ($("paymentSearch").value || "").toLowerCase();

    const list = a.filter(p =>
        (p.member_name + " " + p.id).toLowerCase().includes(q)
    );

    $("revenue").textContent = money(
        a.reduce((s, p) => s + Number(p.amount), 0)
    );

    $("paymentCount").textContent = a.length;

    $("paymentTable").innerHTML = list.length
        ? table(
            ["Receipt", "Member", "Date", "Method", "Type", "Amount"],

            list.map(p => [
                esc(p.id),
                esc(p.member_name),
                p.payment_date,
                esc(p.method),
                esc(p.type),
                money(p.amount)
            ])
        )
        : `<div class="empty">No payment records.</div>`;
}

async function openPayment() {
    await api("/api/members").then(x => cache.members = x);

    modal(
        "Record payment",

        `<form id="payForm" class="form-grid">

            <label class="span2">
                Member
                <select name="member_id" required>
                    ${memberOptions()}
                </select>
            </label>

            <label>
                Amount
                <input type="number" min=".01" step=".01" name="amount" required>
            </label>

            <label>
                Date
                <input type="date" name="payment_date" value="${today()}">
            </label>

            <label>
                Method
                <select name="method">
                    <option>Cash</option>
                    <option>GCash</option>
                    <option>Bank transfer</option>
                    <option>Card</option>
                </select>
            </label>

            <label>
                Type
                <select name="type">
                    <option>Membership</option>
                    <option>Renewal</option>
                    <option>Other</option>
                </select>
            </label>

            <div class="form-actions span2">
                <button type="button" class="secondary" id="cancel">Cancel</button>
                <button class="primary">Save payment</button>
            </div>

        </form>`
    );

    $("cancel").onclick = closeModal;

    $("payForm").onsubmit = async e => {
        e.preventDefault();

        try {
            await api("/api/payments", {
                method: "POST",
                body: JSON.stringify(
                    Object.fromEntries(new FormData(e.target))
                )
            });

            closeModal();

            toast("Payment recorded");

            payments();

        } catch (x) {
            toast(x.message);
        }
    };
}

// ATTENDANCE

async function attendance() {
    const a = await api("/api/attendance");

    cache.attendance = a;

    const q = ($("attendanceSearch").value || "").toLowerCase();
    const d = $("attendanceDate").value;

    const list = a.filter(x =>
        (x.member_name + " " + x.member_id).toLowerCase().includes(q)
        &&
        (!d || x.visit_date === d)
    );

    $("attendanceTable").innerHTML = list.length
        ? table(
            ["Member", "Member ID", "Date", "Check-in"],

            list.map(x => [
                esc(x.member_name),
                esc(x.member_id),
                x.visit_date,
                x.checkin_time
            ])
        )
        : `<div class="empty">No attendance records.</div>`;
}

// NOTIFICATIONS

async function notifications() {
    const a = await api("/api/members");

    const list = a.filter(m =>
        ["Expired", "Expiring soon"].includes(m.current_status)
    );

    $("alertCount").textContent = list.length;

    $("notificationList").innerHTML = list.length
        ? list.map(m => `
            <div class="notification">

                <div>⚠</div>

                <div>
                    <b>${esc(m.full_name)} · ${esc(m.id)}</b>
                    <p>${m.current_status} · Expiry: ${m.expiry_date}</p>
                </div>

                ${pill(m.current_status)}

                <button class="action" data-renew="${m.id}">
                    Renew
                </button>

            </div>
        `).join("")
        : `<div class="empty">No membership alerts. All caught up.</div>`;
}

// REPORTS

async function reports() {
    const r = await api("/api/reports");

    cache.reports = r;

    $("rRevenue").textContent = money(r.revenue);

    $("rActive").textContent = r.members.filter(m =>
        ["Active", "Expiring soon"].includes(m.current_status)
    ).length;

    $("rVisits").textContent = r.attendance.length;
    $("rRenewals").textContent = r.renewals;

    const max = Math.max(1, ...r.methods.map(x => x.total));

    $("breakdown").innerHTML = r.methods.map(x => `
        <div class="barrow">

            <span>${x.method}</span>

            <div class="bar">
                <span style="width:${x.total / max * 100}%"></span>
            </div>

            <b>${money(x.total)}</b>

        </div>
    `).join("");
}

// USER ACCOUNTS

async function users() {
    const a = await api("/api/users");

    cache.users = a;

    $("userTable").innerHTML = table(
        ["Name", "Username", "Role", "Created", "Actions"],

        a.map(u => [
            esc(u.name),
            esc(u.username),
            esc(u.role),
            u.created_at,

            u.id === "U-ADMIN"
                ? "Primary account"
                : `<button class="action" data-user-delete="${u.id}">Delete</button>`
        ])
    );
}

function openUser() {
    modal(
        "Create user account",

        `<form id="userForm" class="form-grid">

            <label class="span2">
                Full name
                <input name="name" required>
            </label>

            <label>
                Username
                <input name="username" required minlength="3">
            </label>

            <label>
                Password
                <input name="password" type="password" required minlength="6">
            </label>

            <label class="span2">
                Role
                <select name="role">
                    <option>Staff</option>
                    <option>Admin</option>
                </select>
            </label>

            <div class="form-actions span2">
                <button type="button" class="secondary" id="cancel">Cancel</button>
                <button class="primary">Create account</button>
            </div>

        </form>`
    );

    $("cancel").onclick = closeModal;

    $("userForm").onsubmit = async e => {
        e.preventDefault();

        try {
            await api("/api/users", {
                method: "POST",
                body: JSON.stringify(
                    Object.fromEntries(new FormData(e.target))
                )
            });

            closeModal();

            toast("User created");

            users();

        } catch (x) {
            toast(x.message);
        }
    };
}

// START APPLICATION

async function start(user) {
    me = user;

    $("login").classList.add("hidden");
    $("app").classList.remove("hidden");

    $("userName").textContent = user.name;

    $("userRole").textContent =
        user.role === "Admin"
            ? "Administrator"
            : "Staff";

    $("welcome").textContent = user.name.split(" ")[0];

    $("dateLabel").textContent =
        new Date().toLocaleDateString("en-PH", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
        });

    document.querySelectorAll(".admin-only").forEach(x => {
        x.classList.toggle("hidden", user.role !== "Admin");
    });

    nav("dashboard");
}

// LOGIN

$("loginForm").onsubmit = async e => {
    e.preventDefault();

    try {
        const r = await api("/api/login", {
            method: "POST",

            body: JSON.stringify({
                username: $("username").value,
                password: $("password").value
            })
        });

        $("loginError").textContent = "";

        start(r.user);

    } catch (x) {
        $("loginError").textContent = x.message;
    }
};

// LOGOUT

$("logout").onclick = async () => {
    await api("/api/logout", {
        method: "POST"
    });

    me = null;

    $("app").classList.add("hidden");
    $("login").classList.remove("hidden");
    $("password").value = "";
};

// NAVIGATION BUTTONS

$("nav").onclick = e => {
    const b = e.target.closest("[data-page]");

    if (b) {
        nav(b.dataset.page);
    }
};

// ACTION BUTTONS

document.addEventListener("click", async e => {

    const go = e.target.closest("[data-go]");

    if (go) {
        nav(go.dataset.go);
        return;
    }

    const edit = e.target.closest("[data-edit]");

    if (edit) {
        await members();

        openMember(
            cache.members.find(m => m.id === edit.dataset.edit)
        );

        return;
    }

    const ren = e.target.closest("[data-renew]");

    if (ren) {
        await members();

        const m = cache.members.find(
            m => m.id === ren.dataset.renew
        );

        if (m) renew(m);

        return;
    }

    const del = e.target.closest("[data-delete]");

    if (del && confirm("Delete this member record?")) {
        try {
            await api("/api/members/" + del.dataset.delete, {
                method: "DELETE"
            });

            toast("Member deleted");

            members();

        } catch (x) {
            toast(x.message);
        }
    }

    const pe = e.target.closest("[data-plan-edit]");

    if (pe) {
        openPlan(
            cache.plans.find(p => p.id === pe.dataset.planEdit)
        );

        return;
    }

    const pd = e.target.closest("[data-plan-delete]");

    if (pd && confirm("Delete this plan?")) {
        try {
            await api("/api/plans/" + pd.dataset.planDelete, {
                method: "DELETE"
            });

            toast("Plan deleted");

            plans();

        } catch (x) {
            toast(x.message);
        }
    }

    const ud = e.target.closest("[data-user-delete]");

    if (ud && confirm("Delete this account?")) {
        try {
            await api("/api/users/" + ud.dataset.userDelete, {
                method: "DELETE"
            });

            toast("User deleted");

            users();

        } catch (x) {
            toast(x.message);
        }
    }
});

// ADD MEMBER

$("dashAdd").onclick = $("quickMember").onclick = async () => {
    await api("/api/plans").then(x => cache.plans = x);

    openMember(null);
};

$("addMember").onclick = async () => {
    await api("/api/plans").then(x => cache.plans = x);

    openMember(null);
};

// OTHER BUTTONS

$("addPlan").onclick = () => openPlan(null);

$("addPayment").onclick = openPayment;

$("addUser").onclick = openUser;

// SEARCH AND FILTERS

$("memberSearch").oninput = members;

$("memberFilter").onchange = members;

$("paymentSearch").oninput = payments;

$("attendanceSearch").oninput = attendance;

$("attendanceDate").onchange = attendance;

// CHECK-IN

$("checkinForm").onsubmit = async e => {
    e.preventDefault();

    try {
        const r = await api("/api/attendance", {
            method: "POST",

            body: JSON.stringify({
                member_id: $("checkinId").value
            })
        });

        $("checkinId").value = "";

        toast(r.member + " checked in");

        attendance();

    } catch (x) {
        toast(x.message);
    }
};

// CLOSE MODAL

$("closeModal").onclick = closeModal;

$("modal").onclick = e => {
    if (e.target.id === "modal") {
        closeModal();
    }
};

// MOBILE MENU

$("menu").onclick = () => {
    $("sidebar").classList.toggle("open");
};

// EXPORT REPORT CSV

$("export").onclick = async () => {
    try {
        const r = await api("/api/reports");

        const rows = [
            ["Receipt", "Member", "Date", "Method", "Type", "Amount"],

            ...r.payments.map(p => [
                p.id,
                p.member_name,
                p.payment_date,
                p.method,
                p.type,
                p.amount
            ])
        ];

        const csv = rows.map(row =>
            row.map(v =>
                '"' + String(v ?? "").replace(/"/g, '""') + '"'
            ).join(",")
        ).join("\n");

        const a = document.createElement("a");

        a.href = URL.createObjectURL(
            new Blob([csv], { type: "text/csv" })
        );

        a.download = "fitzone-payment-report.csv";

        a.click();

        URL.revokeObjectURL(a.href);

    } catch (x) {
        toast(x.message);
    }
};

// CHECK IF USER IS ALREADY LOGGED IN

(async () => {
    try {
        const r = await api("/api/me");

        if (r.user) {
            start(r.user);
        }

    } catch {}
})();

// REGISTER SERVICE WORKER

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
}