import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Html5QrcodeScanner } from "html5-qrcode";
import {
  Activity, Archive, ArrowDownToLine, Bell, Boxes, CalendarDays, Check, ChevronRight, CircleAlert,
  ClipboardList, Clock3, LayoutDashboard, LogOut, PackageCheck, QrCode, Search, ShieldCheck,
  Eye, EyeOff, TriangleAlert, Users
} from "lucide-react";
import api from "./api";
import { borrowerRoles, canBorrow, canManageInventory, equipmentStatusClass } from "./utils";
import "./style.css";

const AuthContext = createContext(null);
const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setReady(false);
    api.get("/auth/me").then(({ data }) => { setUser(data.user); setConnectionError(""); }).catch((error) => {
      if (error.response?.status === 401 || error.response?.status === 403) setUser(null);
      else if (error.response) {
        setConnectionError(error.response.data?.error || `The EBS API returned an error (${error.response.status}).`);
      } else {
        setConnectionError("Unable to reach the EBS API. Start the backend server and retry.");
      }
    }).finally(() => setReady(true));
  }, [retry]);
  const value = useMemo(() => ({ user, setUser, ready, connectionError, retryConnection: () => setRetry((value) => value + 1) }), [user, ready, connectionError]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function Protected({ children, roles }) {
  const { user, ready } = useAuth();
  const { connectionError, retryConnection } = useAuth();
  if (!ready) return <div className="grid min-h-screen place-items-center text-slate-500">Loading your secure workspace…</div>;
  if (connectionError) return <div className="grid min-h-screen place-items-center p-5"><div className="card max-w-lg p-8 text-center"><CircleAlert className="mx-auto text-amber-600" /><p className="mt-3 text-slate-700">{connectionError}</p><button className="btn-primary mt-5" onClick={retryConnection}>Retry connection</button></div></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <TemporaryPasswordPage />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function Notice({ message, error }) {
  if (!message) return null;
  return <div role="status" className={`mb-4 rounded-xl border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message}</div>;
}

function AuthPage({ mode }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [message, setMessage] = useState("");
  const [developmentLink, setDevelopmentLink] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ role: "student", email: "", password: "", fullName: "", studentId: "", program: "" });
  const title = mode === "register" ? "Create borrower account" : mode === "forgot" ? "Reset your password" : "Welcome back";
  async function submit(event) {
    event.preventDefault();
    setMessage(""); setDevelopmentLink(""); setError(false); setBusy(true);
    try {
      const endpoint = mode === "register" ? "register" : mode === "forgot" ? "forgot-password" : "login";
      const payload = mode === "register"
        ? { ...form, studentId: form.role === "student" ? form.studentId : undefined, program: form.role === "student" ? form.program : undefined }
        : mode === "forgot"
          ? { email: form.email }
          : { email: form.email, password: form.password };
      const { data } = await api.post(`/auth/${endpoint}`, payload);
      if (mode === "login") {
        setUser(data.user);
        navigate(location.state?.from || "/");
      } else {
        const link = data.verificationLink || data.resetLink;
        setMessage(data.message);
        setDevelopmentLink(link || "");
      }
    } catch (e) {
      setError(true);
      setMessage(e.response?.data?.error || (e.response
        ? `The server returned an error (${e.response.status}).`
        : "Unable to reach the EBS API. Start the API server and check http://localhost:3000/health."));
    } finally { setBusy(false); }
  }
  if (user) return <Navigate to="/" replace />;
  return (
    <div className="grid min-h-screen bg-[#101a2b] lg:grid-cols-[1.1fr_.9fr]">
      <section className="hidden flex-col justify-between p-12 text-white lg:flex">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-blue-500 p-3"><Boxes /></div><span className="font-bold tracking-wide">CAMPUS • EBS</span></div>
        <div className="max-w-xl"><div className="mb-5 inline-flex rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[.2em] text-blue-200">Equipment, ready when you are</div><h1 className="text-5xl font-semibold leading-tight">Borrow smarter.<br />Keep learning.</h1><p className="mt-5 max-w-lg text-lg leading-8 text-slate-300">One trusted place to reserve, collect, and return the equipment that powers your campus work.</p></div>
        <p className="text-sm text-slate-400">Camarines Sur Polytechnic Colleges · Equipment Borrowing System</p>
      </section>
      <section className="grid place-items-center bg-[#f4f6fa] p-5 sm:p-10">
        <div className="card w-full max-w-md p-7 sm:p-9">
          <Link to="/login" className="flex items-center gap-2 text-sm font-semibold text-blue-700 lg:hidden"><Boxes size={19} /> EBS Campus</Link>
          <h2 className="mt-6 text-2xl font-semibold text-slate-900">{title}</h2><p className="mt-2 text-sm text-slate-500">{mode === "register" ? "Use your institutional details to get started." : mode === "forgot" ? "We’ll send a secure reset link if your account exists." : "Sign in with your verified institutional account."}</p>
          <form className="mt-7 space-y-4" onSubmit={submit}>
            {mode === "register" && <><label className="block text-sm font-medium text-slate-700">Borrower type<select className="field mt-1.5" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value, studentId: "", program: "" })}><option value="student">Student</option><option value="faculty">Faculty / Instructor</option></select></label><Field label="Full name" value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} placeholder="Ex. Juan Dela Cruz" autoComplete="name" required />{form.role === "student" && <><Field label="Student ID" value={form.studentId} onChange={(v) => setForm({ ...form, studentId: v })} placeholder="Ex. 2410784" required /><Field label="Program of study" value={form.program} onChange={(v) => setForm({ ...form, program: v })} placeholder="Ex. BSIT" required /></>}</>}
            <Field label="Institutional email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder={mode === "register" ? form.role === "faculty" ? "Ex. instructor@my.cspc.edu.ph" : "Ex. student@my.cspc.edu.ph" : "Enter your institutional email"} required />
            {mode !== "forgot" && <Field label="Password" type="password" minLength={mode === "register" ? 12 : undefined} value={form.password} onChange={(v) => setForm({ ...form, password: v })} placeholder={mode === "register" ? "At least 12 characters" : "Enter your password"} required />}
            {mode === "register" && <p className="text-xs leading-5 text-slate-500">Passwords must be at least 12 characters. Students provide their student ID and program; faculty and instructors provide their name and institutional email.</p>}
            <Notice message={message} error={error} />
            {developmentLink && <a className="mb-4 block break-all text-sm text-blue-700 underline" href={developmentLink}>Development link: {developmentLink}</a>}
            <button className="btn-primary w-full py-3" disabled={busy}>{busy ? "Please wait…" : mode === "register" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}</button>
          </form>
          <div className="mt-5 flex justify-between text-sm text-slate-600">
            {mode === "login" ? <><Link className="hover:text-blue-700" to="/forgot-password">Forgot password?</Link><Link className="font-medium text-blue-700" to="/register">Create account</Link></> : <Link className="font-medium text-blue-700" to="/login">Back to sign in</Link>}
          </div>
        </div>
      </section>
    </div>
  );
}

function TemporaryPasswordPage() {
  const { user, setUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    setError(false);
    if (newPassword !== confirmPassword) {
      setError(true);
      setMessage("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/change-temporary-password", { currentPassword, newPassword });
      setUser({ ...user, mustChangePassword: false });
      setMessage(data.message);
    } catch (e) {
      setError(true);
      setMessage(e.response?.data?.error || "Password could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid min-h-screen place-items-center bg-[#f4f6fa] p-5">
    <section className="card w-full max-w-md p-7 sm:p-9">
      <h1 className="text-2xl font-semibold">Set your password</h1>
      <p className="mt-2 text-sm text-slate-500">Welcome, {user.fullName || user.email}. Change the temporary password before using your account.</p>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <Field label="Temporary password" type="password" value={currentPassword} onChange={setCurrentPassword} required />
        <Field label="New password" type="password" minLength={12} value={newPassword} onChange={setNewPassword} required />
        <Field label="Confirm new password" type="password" minLength={12} value={confirmPassword} onChange={setConfirmPassword} required />
        <p className="text-xs text-slate-500">Use at least 12 characters. Your administrator will not be able to view your new password.</p>
        <Notice message={message} error={error} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Updating…" : "Set new password"}</button>
      </form>
    </section>
  </div>;
}

function Field({ label, type = "text", value, onChange, required, minLength, placeholder, autoComplete }) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isPassword = type === "password";
  return <label className="block text-sm font-medium text-slate-700">{label}<span className="relative mt-1.5 block"><input className={`field ${isPassword ? "pr-12" : ""}`} type={isPassword && passwordVisible ? "text" : type} value={value} onChange={(event) => onChange(event.target.value)} required={required} minLength={minLength} placeholder={placeholder} autoComplete={autoComplete || (isPassword ? (label.toLowerCase().includes("new") ? "new-password" : "current-password") : undefined)} />{isPassword && <button type="button" className="absolute inset-y-0 right-3 my-auto grid h-8 w-8 place-items-center rounded text-slate-500 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" aria-label={passwordVisible ? "Hide password" : "Show password"} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>}</span></label>;
}

const navigation = [
  { to: "/", title: "Overview", icon: LayoutDashboard, roles: ["student", "faculty", "custodian", "administrator"] },
  { to: "/equipment", title: "Equipment", icon: Boxes, roles: ["student", "faculty", "custodian", "administrator"] },
  { to: "/reservations", title: "Reservations", icon: CalendarDays, roles: ["student", "faculty", "custodian", "administrator"] },
  { to: "/notifications", title: "Notifications", icon: Bell, roles: ["student", "faculty", "custodian", "administrator"] },
  { to: "/profile", title: "My profile", icon: Users, roles: ["student", "faculty", "custodian", "administrator"] },
  { to: "/desk", title: "Checkout & return", icon: QrCode, roles: ["custodian", "administrator"] },
  { to: "/reports", title: "Reports", icon: ClipboardList, roles: ["custodian", "administrator"] },
  { to: "/admin", title: "Administration", icon: ShieldCheck, roles: ["administrator"] }
];

function Layout({ children }) {
  const { user, setUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState("");
  async function logout() {
    setLogoutError("");
    try {
      await api.post("/auth/logout");
      setUser(null);
      navigate("/login");
    } catch (error) {
      setLogoutError(error.response?.data?.error || "Sign out failed. Please retry.");
    }
  }
  return <div className="app-shell md:flex">
    <aside className="sidebar shrink-0 bg-[#101a2b] px-4 py-5 text-white md:min-h-screen md:px-5">
      <Link to="/" className="flex items-center gap-3 px-2"><span className="rounded-xl bg-blue-500 p-2.5"><Boxes size={20} /></span><span><b className="block text-sm tracking-wide">CAMPUS EBS</b><small className="text-slate-400">Equipment services</small></span></Link>
      <div className="mt-9 px-3 text-[10px] font-semibold uppercase tracking-[.2em] text-slate-500">Workspace</div>
      <nav className="mt-2 flex gap-1 overflow-auto md:flex-col">{navigation.filter((item) => item.roles.includes(user.role)).map((item) => {
        const Icon = item.icon; const active = location.pathname === item.to;
        return <Link key={item.to} to={item.to} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-white/5"}`}><Icon size={17} />{item.title}</Link>;
      })}</nav>
      <div className="mt-8 hidden rounded-xl border border-white/10 p-4 text-xs leading-5 text-slate-400 md:block"><ShieldCheck size={17} className="mb-2 text-emerald-400" />Signed-in access is role restricted. Report account or equipment issues to a custodian.</div>
      <div className="mt-5 flex items-center justify-between border-t border-white/10 px-2 pt-4 md:mt-8"><div className="min-w-0"><div className="truncate text-sm font-medium">{user.email}</div><div className="mt-0.5 text-xs capitalize text-slate-400">{user.role.replace("_", " ")}</div></div><button onClick={logout} title="Sign out" className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"><LogOut size={17} /></button></div>
    </aside>
    <main className="main-panel flex-1 px-5 py-6 sm:px-8 lg:px-10"><div className="mx-auto max-w-7xl">{logoutError && <Notice message={logoutError} error />}{children}</div></main>
  </div>;
}

function PageHeading({ eyebrow, title, children }) {
  return <header className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="text-xs font-semibold uppercase tracking-[.18em] text-blue-700">{eyebrow}</div><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{title}</h1></div>{children}</header>;
}

function Metric({ icon: Icon, label, value, detail, tone = "blue", to }) {
  const tones = { blue: "bg-blue-50 text-blue-700", teal: "bg-teal-50 text-teal-700", amber: "bg-amber-50 text-amber-700", red: "bg-red-50 text-red-700", violet: "bg-violet-50 text-violet-700" };
  const content = <><div className={`inline-flex rounded-xl p-2.5 ${tones[tone]}`}><Icon size={19} /></div><div className="mt-5 text-sm text-slate-500">{label}</div><div className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">{value ?? "—"}</div><div className="mt-2 text-xs text-slate-400">{detail}</div>{to && <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-700">View details <ChevronRight size={14} /></span>}</>;
  const className = `card block p-5 transition ${to ? "cursor-pointer hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" : ""}`;
  return to
    ? <Link to={to} className={className} aria-label={`${label}: ${value ?? "—"}. ${detail}. View details.`}>{content}</Link>
    : <div className={className}>{content}</div>;
}

function Overview() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { if (canManageInventory(user.role)) api.get("/reports/dashboard").then(({ data: result }) => setData(result)).catch((e) => setError(e.response?.data?.error || "Dashboard could not be loaded.")); }, [user.role]);
  const greetingName = user.role === "administrator" ? "Admin" : user.fullName || user.email.split("@")[0];
  return <><PageHeading eyebrow="Campus equipment services" title={`Good day, ${greetingName}`}><Link to="/equipment" className="btn-primary inline-flex items-center gap-2"><Search size={16} /> Browse equipment</Link></PageHeading>
    {Boolean(user.accountHold) && <Notice error message="Your account has a hold. Please contact an equipment custodian before requesting equipment." />}
    {canManageInventory(user.role) ? <>
      <Notice error={!!error} message={error} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Metric icon={Boxes} label="Total equipment" value={data?.totals.equipment} detail="Active inventory records" to="/equipment" />
        <Metric icon={Users} label="Borrowers" value={data?.totals.borrowers} detail="Active student and faculty accounts" tone="teal" to={user.role === "administrator" ? "/admin#user-accounts" : undefined} />
        <Metric icon={CalendarDays} label="Reservation requests" value={data?.totals.activeReservations} detail="Awaiting review or already approved" tone="violet" to="/reservations" />
        <Metric icon={PackageCheck} label="Checked out" value={data?.totals.checkedOut} detail="Equipment currently on loan" tone="teal" to="/reservations" />
        <Metric icon={Clock3} label="Overdue items" value={data?.totals.overdue} detail="Needs return follow-up" tone="amber" to="/reservations" />
        <Metric icon={TriangleAlert} label="Open damage reports" value={data?.totals.damaged} detail="Requires staff review" tone="red" to="/reports#open-damage-incidents" />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2"><section className="card p-5"><h2 className="font-semibold">Monthly borrowing trend</h2><div className="mt-5 space-y-3">{(data?.monthlyBorrowing || []).map((item) => <div key={item.month} className="flex items-center gap-3 text-sm"><span className="w-20 text-slate-500">{item.month}</span><div className="h-2 flex-1 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.max(4, Math.min(100, Number(item.count) * 8))}%` }} /></div><b>{item.count}</b></div>)}</div></section><section className="card p-5"><h2 className="font-semibold">Most borrowed equipment</h2><div className="mt-3 divide-y divide-slate-100">{(data?.mostBorrowedEquipment || []).map((item, i) => <div key={item.name} className="flex items-center justify-between py-3 text-sm"><span><span className="mr-3 text-slate-400">0{i + 1}</span>{item.name}</span><b>{item.count} loans</b></div>)}{!data?.mostBorrowedEquipment?.length && <p className="py-5 text-sm text-slate-500">No borrowing activity yet.</p>}</div></section><section className="card p-5"><h2 className="font-semibold">Equipment usage by category</h2><div className="mt-5 space-y-3">{(data?.equipmentUsage || []).map((item) => <div key={item.name} className="flex items-center gap-3 text-sm"><span className="w-28 truncate text-slate-500">{item.name}</span><div className="h-2 flex-1 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-teal-600" style={{ width: `${Math.max(4, Math.min(100, Number(item.count) * 10))}%` }} /></div><b>{item.count}</b></div>)}{!data?.equipmentUsage?.length && <p className="text-sm text-slate-500">No usage data yet.</p>}</div></section><section className="card p-5"><h2 className="font-semibold">Monthly damage statistics</h2><div className="mt-5 space-y-3">{(data?.damageStatistics || []).map((item) => <div key={item.month} className="flex items-center gap-3 text-sm"><span className="w-20 text-slate-500">{item.month}</span><div className="h-2 flex-1 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-rose-500" style={{ width: `${Math.max(4, Math.min(100, Number(item.count) * 15))}%` }} /></div><b>{item.count}</b></div>)}{!data?.damageStatistics?.length && <p className="text-sm text-slate-500">No damage reports yet.</p>}</div></section></div>
    </> : <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]"><section className="card borrower-hero overflow-hidden p-7 text-white sm:p-10"><div className="inline-flex rounded-full border border-white/30 px-3 py-1 text-xs text-white">BORROWER PORTAL</div><h2 className="mt-5 max-w-lg text-3xl font-semibold leading-tight text-white sm:text-4xl">Your next great idea needs the right tools.</h2><p className="mt-4 max-w-lg leading-7 text-blue-50">Explore campus equipment, check availability, and request a pickup for your class or lab activity.</p><Link to="/equipment" className="borrower-hero-link mt-7 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-semibold">Explore equipment <ChevronRight size={16} /></Link></section><section className="card p-6"><div className="flex items-center gap-3"><span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><Activity size={19} /></span><h2 className="font-semibold">Account status</h2></div><div className="mt-5 flex items-center gap-2 text-sm font-medium text-emerald-700"><Check size={16} /> Verified and ready</div><p className="mt-3 text-sm leading-6 text-slate-500">Reservations are subject to availability and your active borrowing limit. Return equipment by its scheduled due time.</p><Link to="/reservations" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-700">View reservations <ChevronRight size={15} /></Link></section></div>}
  </>;
}

function EquipmentPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(null);
  const [qr, setQr] = useState(null);
  const [newItem, setNewItem] = useState({ assetCode: "", name: "", categoryId: "", quantity: "1", location: "", description: "", serialNumber: "" });
  const load = () => api.get("/equipment", { params: { q: query, category: category || undefined, status: status || undefined } }).then(({ data }) => setRows(data.equipment)).catch((e) => { setError(true); setMessage(e.response?.data?.error || "Equipment could not be loaded."); });
  useEffect(() => { load(); api.get("/categories").then(({ data }) => setCategories(data.categories)).catch(() => {}); }, []);
  async function createItem(event) {
    event.preventDefault(); setError(false);
    try {
      const { data } = await api.post("/equipment", { ...newItem, categoryId: Number(newItem.categoryId), quantity: Number(newItem.quantity) });
      setMessage(`Equipment created. QR value: ${data.qrCode}`);
      setNewItem({ assetCode: "", name: "", categoryId: "", quantity: "1", location: "", description: "", serialNumber: "" });
      load();
    } catch (e) { setError(true); setMessage(e.response?.data?.error || "Unable to add equipment."); }
  }
  async function saveEdit(event) {
    event.preventDefault();
    try {
      await api.put(`/equipment/${editing}`, {
        ...newItem,
        categoryId: Number(newItem.categoryId),
        quantity: Number(newItem.quantity)
      });
      setEditing(null);
      setError(false);
      setMessage("Equipment updated.");
      load();
    } catch (e) { setError(true); setMessage(e.response?.data?.error || "Unable to update equipment."); }
  }
  async function archiveItem(item) {
    if (!window.confirm(`Archive ${item.name}? It will no longer appear in the active catalogue.`)) return;
    try {
      await api.delete(`/equipment/${item.id}`);
      setError(false); setMessage("Equipment archived."); load();
    } catch (e) { setError(true); setMessage(e.response?.data?.error || "Unable to archive equipment."); }
  }
  async function uploadImage(item, file) {
    if (!file) return;
    const payload = new FormData();
    payload.append("image", file);
    try {
      await api.post(`/equipment/${item.id}/image`, payload);
      setError(false); setMessage(`Image uploaded for ${item.name}.`); load();
    } catch (e) { setError(true); setMessage(e.response?.data?.error || "Unable to upload image."); }
  }
  async function showQr(item) {
    try {
      const { data } = await api.get(`/equipment/${item.id}/qr`);
      setQr({ id: item.id, name: item.name, image: data.qrDataUrl });
    } catch (e) { setError(true); setMessage(e.response?.data?.error || "QR code could not be loaded."); }
  }
  return <><PageHeading eyebrow="Equipment catalogue" title="Find your equipment" /><Notice message={message} error={error} />
    <section className="card p-4 sm:p-5"><div className="grid gap-3 md:grid-cols-[1fr_210px_210px_auto]"><div className="relative min-w-0"><input className="field min-w-0 pr-11" placeholder="Search equipment or asset code" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} /><button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label="Search equipment" title="Search equipment" onClick={load}><Search size={17} /></button></div><select className="field" value={category} onChange={(e) => { setCategory(e.target.value); }}><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><select className="field" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{["Available", "Reserved", "Checked Out", "Under Maintenance", "Lost"].map((s) => <option key={s}>{s}</option>)}</select><button className="btn-primary" onClick={load}>Search</button></div>
      <div className="table-scroll mt-5"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{["Equipment", "Asset code", "Category", "Location", "Quantity", "Status", "Action"].map((h) => <th className="px-4 py-3 font-semibold" key={h}>{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((item) => <tr key={item.id}><td className="px-4 py-4"><div className="flex items-center gap-3">{item.imageUrl && <img src={item.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />}<span><b className="block text-slate-800">{item.name}</b><span className="text-xs text-slate-500">{item.description}</span></span></div></td><td className="px-4 py-4 font-mono text-xs">{item.assetCode}</td><td className="px-4 py-4">{item.category}</td><td className="px-4 py-4">{item.location}</td><td className="px-4 py-4">{item.quantity}</td><td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs ${equipmentStatusClass(item.status)}`}>{item.status}</span></td><td className="px-4 py-4"><div className="flex items-center gap-3">{canBorrow(user.role) && item.status === "Available" && <Link to={`/reserve/${item.id}`} className="font-semibold text-blue-700">Reserve</Link>}{canManageInventory(user.role) && <><button className="font-semibold text-blue-700" onClick={() => { setEditing(item.id); setNewItem({ assetCode: item.assetCode, name: item.name, categoryId: String(item.categoryId), quantity: String(item.quantity), location: item.location, description: item.description || "", status: item.status, serialNumber: item.serialNumber || "" }); }}>Edit</button><label className="cursor-pointer font-semibold text-slate-600">Image<input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => uploadImage(item, e.target.files?.[0])} /></label><button className="font-semibold text-slate-600" onClick={() => showQr(item)}>QR</button>{user.role === "administrator" && <button className="font-semibold text-red-600" onClick={() => archiveItem(item)}>Archive</button>}</>}</div></td></tr>)}</tbody></table>{!rows.length && <div className="py-12 text-center text-sm text-slate-500"><Archive className="mx-auto mb-2 text-slate-300" />No matching equipment found.</div>}</div>
    </section>
    {qr && <section className="card mt-5 flex flex-wrap items-center gap-5 p-5"><img src={qr.image} alt={`QR code for ${qr.name}`} className="h-32 w-32" /><div><h2 className="font-semibold">{qr.name} QR code</h2><p className="mt-1 font-mono text-xs text-slate-500">{rows.find((item) => item.id === qr.id)?.qrCode}</p><button className="mt-3 text-sm font-semibold text-blue-700" onClick={() => setQr(null)}>Close</button></div></section>}
    {editing && <section className="card mt-5 p-5"><h2 className="font-semibold">Edit equipment</h2><form onSubmit={saveEdit} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label="Asset code" value={newItem.assetCode} onChange={(v) => setNewItem({ ...newItem, assetCode: v })} required /><Field label="Equipment name" value={newItem.name} onChange={(v) => setNewItem({ ...newItem, name: v })} required /><label className="block text-sm font-medium">Category<select className="field mt-1.5" required value={newItem.categoryId} onChange={(e) => setNewItem({ ...newItem, categoryId: e.target.value })}><option value="">Select category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><Field label="Serial number" value={newItem.serialNumber} onChange={(v) => setNewItem({ ...newItem, serialNumber: v })} /><Field label="Quantity" type="number" value={newItem.quantity} onChange={(v) => setNewItem({ ...newItem, quantity: v })} required /><Field label="Storage location" value={newItem.location} onChange={(v) => setNewItem({ ...newItem, location: v })} required /><Field label="Description" value={newItem.description} onChange={(v) => setNewItem({ ...newItem, description: v })} /><button className="btn-primary">Save changes</button><button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button></form></section>}
    {canManageInventory(user.role) && <section className="card mt-5 p-5"><h2 className="font-semibold">Add inventory item</h2><form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={createItem}><Field label="Asset code" value={newItem.assetCode} onChange={(v) => setNewItem({ ...newItem, assetCode: v })} required /><Field label="Equipment name" value={newItem.name} onChange={(v) => setNewItem({ ...newItem, name: v })} required /><label className="block text-sm font-medium">Category<select className="field mt-1.5" required value={newItem.categoryId} onChange={(e) => setNewItem({ ...newItem, categoryId: e.target.value })}><option value="">Select category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><Field label="Serial number" value={newItem.serialNumber} onChange={(v) => setNewItem({ ...newItem, serialNumber: v })} /><Field label="Quantity" type="number" value={newItem.quantity} onChange={(v) => setNewItem({ ...newItem, quantity: v })} required /><Field label="Storage location" value={newItem.location} onChange={(v) => setNewItem({ ...newItem, location: v })} required /><Field label="Description" value={newItem.description} onChange={(v) => setNewItem({ ...newItem, description: v })} /><button className="btn-primary sm:col-span-2 lg:col-span-3">Add equipment and generate QR</button></form></section>}
  </>;
}

function ReservePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const id = Number(useLocation().pathname.split("/").pop());
  const [form, setForm] = useState({ pickupAt: "", dueAt: "", purpose: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  async function submit(e) {
    e.preventDefault();
    try {
      const result = await api.post("/reservations", { equipmentId: id, pickupAt: new Date(form.pickupAt).toISOString(), dueAt: new Date(form.dueAt).toISOString(), purpose: form.purpose });
      setMessage(`Request submitted and awaiting staff approval. Code: ${result.data.reservationCode}${result.data.notificationWarning ? ` — ${result.data.notificationWarning}` : ""}`);
      setTimeout(() => navigate("/reservations"), 900);
    } catch (e2) { setError(true); setMessage(e2.response?.data?.error || "Reservation failed."); }
  }
  return <><PageHeading eyebrow="Equipment request" title="Reserve equipment" /><div className="card max-w-2xl p-6"><Notice message={message} error={error} />{user.accountHold && <Notice error message="Resolve your account hold before making a reservation." />}<form onSubmit={submit} className="space-y-4"><Field label="Pickup date and time" type="datetime-local" value={form.pickupAt} onChange={(v) => setForm({ ...form, pickupAt: v })} required /><Field label="Expected return date and time" type="datetime-local" value={form.dueAt} onChange={(v) => setForm({ ...form, dueAt: v })} required /><label className="block text-sm font-medium">Academic purpose<textarea className="field mt-1.5" rows="4" minLength="5" maxLength="500" required value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Describe the class, lab, or academic activity" /></label><button className="btn-primary" disabled={user.accountHold}>Submit reservation</button></form></div></>;
}

function ReservationsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const load = () => api.get("/reservations").then(({ data }) => setRows(data.reservations)).catch((e) => setMessage(e.response?.data?.error || "Reservations could not be loaded."));
  useEffect(() => { load(); }, []);
  async function cancel(id) {
    try {
      await api.post(`/reservations/${id}/cancel`);
      setError(false); setMessage("Reservation cancelled."); load();
    } catch (e) {
      setError(true); setMessage(e.response?.data?.error || "Unable to cancel reservation.");
    }
  }
  async function decide(id, decision) {
    let payload = {};
    if (decision === "reject") {
      const reason = window.prompt("Why are you declining this request?");
      if (reason === null) return;
      if (reason.trim().length < 3) {
        setError(true); setMessage("Please enter a reason of at least 3 characters to decline.");
        return;
      }
      payload = { reason: reason.trim() };
    }
    try {
      const { data } = await api.post(`/reservations/${id}/${decision}`, payload);
      setError(false);
      setMessage(data.notificationWarning ? `${data.message} ${data.notificationWarning}` : data.message);
      load();
    } catch (e) {
      setError(true); setMessage(e.response?.data?.error || `Unable to ${decision} reservation.`);
    }
  }
  const statusLabels = {
    pending: "Awaiting staff approval",
    approved: "Approved — ready for scheduled pickup",
    checked_out: "Collected — with borrower",
    completed: "Return received",
    cancelled: "Cancelled",
    rejected: "Declined",
    overdue: "Overdue"
  };
  return <>
    <PageHeading eyebrow={canManageInventory(user.role) ? "Equipment activity" : "Your activity"} title="Reservations" />
    {canManageInventory(user.role) && <p className="mb-4 text-sm text-slate-600">Review pending borrower requests below. Approve or decline them with a reason. Approval reserves the item; when the borrower physically collects it, record the handover in Checkout &amp; return. When they bring it back, inspect it and record the return there.</p>}
    {message && <Notice message={message} error={error} />}
    <section className="card table-scroll p-5"><table className="w-full min-w-[900px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr>{["Equipment", "Pickup", "Return due", "Purpose", "Status", "Borrower", "Actions"].map((x) => <th className="px-3 py-3" key={x}>{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((r) => <tr key={r.id}><td className="px-3 py-4 font-medium">{r.equipmentName}<span className="block text-xs text-slate-500">{r.assetCode}</span><span className="mt-1 block font-mono text-[10px] text-slate-400">Code: {r.reservationCode}</span></td><td className="px-3 py-4">{new Date(r.pickupAt).toLocaleString()}</td><td className="px-3 py-4">{new Date(r.dueAt).toLocaleString()}</td><td className="px-3 py-4">{r.purpose}</td><td className="px-3 py-4"><span className={`rounded-full px-2.5 py-1 text-xs ${r.status === "pending" ? "bg-amber-50 text-amber-800" : r.status === "approved" ? "bg-emerald-50 text-emerald-800" : r.status === "rejected" || r.status === "cancelled" ? "bg-red-50 text-red-800" : "bg-slate-100 text-slate-700"}`}>{statusLabels[r.status] || r.status.replace("_", " ")}</span></td><td className="px-3 py-4">{canManageInventory(user.role) ? <>{r.borrowerName || "Borrower"}<span className="block text-xs text-slate-500">{r.borrowerEmail}</span></> : ""}</td><td className="px-3 py-4"><div className="flex items-center gap-3">{canManageInventory(user.role) && r.status === "pending" && <><button className="font-semibold text-emerald-700" onClick={() => decide(r.id, "approve")}>Approve</button><button className="font-semibold text-red-600" onClick={() => decide(r.id, "reject")}>Decline</button></>}{["approved", "pending"].includes(r.status) && <button className="font-medium text-slate-600" onClick={() => cancel(r.id)}>Cancel</button>}</div></td></tr>)}</tbody></table>{!rows.length && <p className="py-10 text-center text-sm text-slate-500">No reservation history yet.</p>}</section>
  </>;
}

function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api.get("/notifications")
      .then(({ data }) => setNotifications(data.notifications))
      .catch((e) => setError(e.response?.data?.error || "Notifications could not be loaded."));
  }, []);
  return <>
    <PageHeading eyebrow="Account updates" title="Notifications" />
    <Notice message={error} error={!!error} />
    <section className="card divide-y divide-slate-100 p-5">
      {notifications.map((notification) => <article key={notification.id} className="flex gap-4 py-4 first:pt-0 last:pb-0">
        <span className={`mt-0.5 rounded-xl p-2 ${notification.readAt ? "bg-slate-100 text-slate-500" : "bg-blue-50 text-blue-700"}`}><Bell size={17} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold text-slate-900">{notification.subject}</h2>
            <time className="text-xs text-slate-500" dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString()}</time>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{notification.body}</p>
        </div>
      </article>)}
      {!notifications.length && !error && <div className="py-10 text-center"><Bell className="mx-auto text-slate-400" size={24} /><h2 className="mt-3 font-semibold">You’re all caught up</h2><p className="mt-1 text-sm text-slate-500">Reservation updates and borrowing reminders will appear here.</p></div>}
    </section>
  </>;
}

function ProfilePage() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({
    fullName: user.fullName || "",
    studentId: user.studentId || "",
    program: user.program || ""
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const isBorrower = borrowerRoles.includes(user.role);

  async function saveProfile(event) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    setMessage("");
    try {
      const { data } = await api.patch("/auth/profile", {
        fullName: form.fullName,
        ...(isBorrower ? { studentId: form.studentId || null, program: form.program || null } : {})
      });
      setUser(data.user);
      setForm({
        fullName: data.user.fullName || "",
        studentId: data.user.studentId || "",
        program: data.user.program || ""
      });
      setMessage(data.message);
    } catch (e) {
      setError(true);
      setMessage(e.response?.data?.error || "Profile could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PageHeading eyebrow="Account settings" title="My profile" />
    <section className="card max-w-2xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold">Personal information</h2><p className="mt-1 text-sm text-slate-500">Update the name and details shown on your account.</p></div>
        <span className="rounded-full bg-blue-50 px-3 py-1.5 text-sm font-semibold capitalize text-blue-800">Role: {user.role}</span>
      </div>
      <Notice message={message} error={error} />
      <form className="space-y-4" onSubmit={saveProfile}>
        <Field label="Full name" value={form.fullName} onChange={(value) => setForm({ ...form, fullName: value })} autoComplete="name" required />
        <label className="block text-sm font-medium text-slate-700">Email address<input className="field mt-1.5 bg-slate-50 text-slate-600" value={user.email} readOnly aria-readonly="true" /><span className="mt-1 block text-xs font-normal text-slate-500">To change your email, contact an administrator so verification can be handled.</span></label>
        {isBorrower && <>
          {user.role === "student" && <Field label="Student ID" value={form.studentId} onChange={(value) => setForm({ ...form, studentId: value })} required />}
          <Field label="Program of study" value={form.program} onChange={(value) => setForm({ ...form, program: value })} required={user.role === "student"} />
        </>}
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
      </form>
    </section>
  </>;
}

function Scanner({ onScan }) {
  useEffect(() => {
    const scanner = new Html5QrcodeScanner("qr-reader", { fps: 8, qrbox: { width: 230, height: 160 }, rememberLastUsedCamera: true }, false);
    scanner.render((text) => { onScan(text); scanner.clear().catch(() => {}); }, () => {});
    return () => { scanner.clear().catch(() => {}); };
  }, [onScan]);
  return <div id="qr-reader" className="max-w-md overflow-hidden rounded-xl" />;
}

function DeskPage() {
  const [qrCode, setQrCode] = useState("");
  const [reservationCode, setReservationCode] = useState("");
  const [condition, setCondition] = useState("Good");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [receiptId, setReceiptId] = useState(null);
  const handleScan = useCallback((value) => setQrCode(value), []);
  async function checkout() {
    try {
      const { data } = await api.post("/checkout", { qrCode, reservationCode });
      setMessage(`Checkout recorded for ${data.borrowerEmail}; due ${new Date(data.dueAt).toLocaleString()}.${data.notificationWarning ? ` ${data.notificationWarning}` : ""}`);
      setReceiptId(data.transactionId); setError(false);
    } catch (e) {
      const details = e.response?.data?.details;
      const detailMessage = Array.isArray(details)
        ? details.map((detail) => `${detail.field}: ${detail.message}`).join(" ")
        : "";
      setError(true);
      setMessage(detailMessage
        ? `${e.response?.data?.error || "Checkout failed."} ${detailMessage}`
        : e.response?.data?.error || "Checkout failed.");
    }
  }
  async function returnItem() {
    if (!window.confirm("Confirm the borrower has physically returned this equipment and you have inspected its condition?")) return;
    try {
      const { data } = await api.post("/return", { qrCode, condition, notes, photo });
      setMessage(`Return received and recorded for the borrower and staff. ${data.accountHold ? "Account hold placed for staff review." : "Item cleared."}${data.notificationWarning ? ` ${data.notificationWarning}` : ""}`);
      setError(false); setNotes(""); setPhoto("");
    } catch (e) {
      setError(true); setMessage(e.response?.data?.error || "Return failed.");
    }
  }
  async function selectPhoto(file) { if (!file) return; if (file.size > 5 * 1024 * 1024) { setError(true); setMessage("Photo must be no larger than 5 MB."); return; } const reader = new FileReader(); reader.onload = () => setPhoto(String(reader.result)); reader.readAsDataURL(file); }
  return <>
    <PageHeading eyebrow="Service counter" title="Checkout & return" />
    <Notice message={message} error={error} />
    {receiptId && <a className="mb-4 inline-flex items-center gap-2 font-semibold text-blue-700" href={`/api/receipts/${receiptId}/pdf`}><ArrowDownToLine size={16} /> Download digital checkout receipt</a>}
    <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
      <section className="card p-5">
        <div className="flex items-center gap-2 font-semibold"><QrCode size={18} className="text-blue-700" /> Scan equipment QR code</div>
        <p className="mt-2 text-sm text-slate-500">Allow camera access or enter the QR value manually.</p>
        <div className="mt-4"><Scanner onScan={handleScan} /></div>
        <Field label="Equipment QR value" value={qrCode} onChange={setQrCode} required />
      </section>
      <div className="space-y-5">
        <section className="card p-5">
          <h2 className="font-semibold">Confirm borrower pickup</h2>
          <p className="mt-1 text-sm text-slate-500">After physically handing the approved item to the borrower, scan its QR, enter the reservation code, and confirm collection. Both accounts receive a notification.</p>
          <div className="mt-4 space-y-3">
            <Field label="Reservation code" value={reservationCode} onChange={setReservationCode} required />
            <button className="btn-primary inline-flex items-center gap-2" onClick={checkout}><PackageCheck size={16} /> Confirm borrower collected item</button>
          </div>
        </section>
        <section className="card p-5">
          <h2 className="font-semibold">Inspect and confirm return</h2>
          <p className="mt-1 text-sm text-slate-500">Only use this after the borrower physically returns the item. Inspect its condition first; both accounts will be notified.</p>
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-medium">Condition<select className="field mt-1.5" value={condition} onChange={(e) => setCondition(e.target.value)}><option>Good</option><option>Damaged</option><option>Missing Parts</option></select></label>
            {condition !== "Good" && <>
              <label className="block text-sm font-medium">Incident notes<textarea className="field mt-1.5" rows="3" required value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
              <label className="block text-sm font-medium">Incident photo (required)<input className="field mt-1.5" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => selectPhoto(e.target.files?.[0])} /></label>
            </>}
            <button className="btn-secondary inline-flex items-center gap-2" onClick={returnItem}><Check size={16} /> Confirm item returned</button>
          </div>
        </section>
      </div>
    </div>
  </>;
}

function ReportsPage() {
  const { user } = useAuth();
  const types = ["usage", "damage", "overdue", "inventory"];
  const [damageReports, setDamageReports] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const load = () => api.get("/damage-reports", { params: { status: "open" } }).then(({ data }) => setDamageReports(data.damageReports)).catch((e) => { setError(true); setMessage(e.response?.data?.error || "Damage reports could not be loaded."); });
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (window.location.hash === "#open-damage-incidents") {
      document.getElementById("open-damage-incidents")?.scrollIntoView({ block: "start" });
    }
  }, []);
  async function resolve(id) {
    try { await api.put(`/damage-reports/${id}/resolve`); setError(false); setMessage("Damage report resolved and account hold reviewed."); load(); }
    catch (e) { setError(true); setMessage(e.response?.data?.error || "Damage report could not be resolved."); }
  }
  return <><PageHeading eyebrow="Operations analytics" title="Reports & exports" /><Notice message={message} error={error} /><div className="grid gap-4 sm:grid-cols-2">{types.map((type) => <section key={type} className="card p-5"><div className="flex items-center gap-3"><span className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><ClipboardList size={19} /></span><h2 className="font-semibold capitalize">{type} report</h2></div><p className="mt-3 text-sm text-slate-500">Export the current {type} report for campus operational review.</p><div className="mt-5 flex gap-2"><a className="btn-secondary inline-flex items-center gap-2 text-sm" href={`/api/reports/${type}/csv`}><ArrowDownToLine size={15} /> CSV</a><a className="btn-primary inline-flex items-center gap-2 text-sm" href={`/api/reports/${type}/pdf`}><ArrowDownToLine size={15} /> PDF</a></div></section>)}</div><section id="open-damage-incidents" className="card mt-5 p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Open damage incidents</h2><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">{damageReports.length} open</span></div><div className="mt-4 divide-y divide-slate-100">{damageReports.map((report) => <article key={report.id} className="flex flex-wrap items-start justify-between gap-4 py-4"><div><h3 className="font-medium">{report.equipmentName} <span className="font-mono text-xs text-slate-500">{report.assetCode}</span></h3><p className="mt-1 text-sm text-slate-600">{report.notes}</p><p className="mt-1 text-xs text-slate-500">Borrower: {report.borrowerEmail} · {new Date(report.createdAt).toLocaleString()}</p><a className="mt-2 inline-block text-sm font-semibold text-blue-700" href={`/api/damage-reports/${report.id}/photo`}>Download incident photo</a></div>{user.role === "administrator" && <button className="btn-secondary text-sm" onClick={() => resolve(report.id)}>Resolve incident</button>}</article>)}{!damageReports.length && <p className="py-6 text-sm text-slate-500">No open incidents.</p>}</div></section></>;
}

function VerifyPage() {
  const [message, setMessage] = useState("Verifying email…");
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) { setMessage("Verification link is missing."); return; }
    api.post("/auth/verify-email", { token }).then(({ data }) => setMessage(data.message)).catch((e) => setMessage(e.response?.data?.error || "Email verification failed."));
  }, []);
  return <div className="grid min-h-screen place-items-center p-5"><div className="card max-w-lg p-8 text-center"><ShieldCheck className="mx-auto text-blue-700" size={35} /><h1 className="mt-4 text-xl font-semibold">Email verification</h1><p className="mt-3 text-slate-600">{message}</p><Link className="mt-5 inline-block font-semibold text-blue-700" to="/login">Go to sign in</Link></div></div>;
}

function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [complete, setComplete] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const token = new URLSearchParams(window.location.search).get("token");
    try {
      const { data } = await api.post("/auth/reset-password", { token, password });
      setMessage(data.message); setComplete(true);
    } catch (err) {
      setError(true); setMessage(err.response?.data?.error || "Password could not be reset.");
    }
  }
  return <div className="grid min-h-screen place-items-center p-5"><div className="card w-full max-w-md p-8"><h1 className="text-xl font-semibold">Set a new password</h1><p className="mt-2 text-sm text-slate-500">Use at least 12 characters.</p><form className="mt-5 space-y-4" onSubmit={submit}><Field label="New password" type="password" minLength={12} value={password} onChange={setPassword} required /><button className="btn-primary w-full">Update password</button></form><div className="mt-4"><Notice message={message} error={error} /></div>{complete && <Link className="font-semibold text-blue-700" to="/login">Continue to sign in</Link>}</div></div>;
}

function AdminPage() {
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({ role: "student", fullName: "", studentId: "", email: "", program: "" });
  const [category, setCategory] = useState({ name: "", description: "" });
  const [notice, setNotice] = useState("");
  const [actionLinks, setActionLinks] = useState(null);
  const [temporaryCredential, setTemporaryCredential] = useState(null);
  const [error, setError] = useState(false);
  const load = () => api.get("/users").then(({ data }) => setAccounts(data.users)).catch((e) => showError(e));
  const showError = (e) => { setError(true); setNotice(e.response?.data?.error || "Request failed."); };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (window.location.hash === "#user-accounts") {
      document.getElementById("user-accounts")?.scrollIntoView({ block: "start" });
    }
  }, []);
  async function invite(e) {
    e.preventDefault();
    setTemporaryCredential(null);
    setActionLinks(null);
    try {
      const { data } = await api.post("/users", {
        role: form.role,
        email: form.email,
        ...(borrowerRoles.includes(form.role) ? {
          fullName: form.fullName,
          ...(form.role === "student" ? { studentId: form.studentId, program: form.program } : {})
        } : {})
      });
      setError(false); setNotice(data.message); setActionLinks(data.setupLinks || null);
      setTemporaryCredential(data.temporaryPassword ? { email: data.email, password: data.temporaryPassword } : null);
      setForm({ role: "student", fullName: "", studentId: "", email: "", program: "" }); load();
    } catch (e2) { showError(e2); }
  }
  async function resendInvitation(account) {
    try {
      const { data } = await api.post(`/users/${account.id}/resend-invitation`);
      setError(false); setNotice(data.message); setActionLinks(data.setupLinks || null);
      setTemporaryCredential(data.temporaryPassword ? { email: data.email, password: data.temporaryPassword } : null); load();
    } catch (e) { showError(e); setActionLinks(null); setTemporaryCredential(null); }
  }
  async function approveBorrower(account) {
    try {
      const { data } = await api.post(`/users/${account.id}/approve-borrower`);
      setError(false); setNotice(data.message); setActionLinks(null); load();
    } catch (e) { showError(e); }
  }
  async function addCategory(e) {
    e.preventDefault();
    try { await api.post("/categories", category); setError(false); setNotice("Equipment category created."); setCategory({ name: "", description: "" }); }
    catch (e2) { showError(e2); }
  }
  async function changeStatus(account) {
    const status = account.status === "active" ? "disabled" : "active";
    try { await api.patch(`/users/${account.id}/status`, { status }); setNotice(`Account ${status}.`); setError(false); load(); }
    catch (e) { showError(e); }
  }
  async function saveAccountName(account) {
    try {
      const { data } = await api.patch(`/users/${account.id}/name`, { fullName: account.fullName });
      setError(false); setNotice(data.message); load();
    } catch (e) { showError(e); }
  }
  return <>
    <PageHeading eyebrow="Administrator controls" title="Administration" />
    <Notice message={notice} error={error} />
    {temporaryCredential && <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <h2 className="font-semibold">Temporary custodian login — share privately</h2>
      <p className="mt-2">Username: <code className="font-mono">{temporaryCredential.email}</code></p>
      <p className="mt-1">Temporary password: <code className="font-mono">{temporaryCredential.password}</code></p>
      <p className="mt-2">This password is shown only now. The custodian must change it at first sign-in. Do not send it in a public channel.</p>
    </div>}
    {actionLinks && <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
      {actionLinks.resetUrl && <p>Password setup: <a className="break-all font-semibold underline" href={actionLinks.resetUrl}>Open setup link</a></p>}
      {actionLinks.verifyUrl && <p>Email verification: <a className="break-all font-semibold underline" href={actionLinks.verifyUrl}>Open verification link</a></p>}
    </div>}
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="card p-5">
        <h2 className="font-semibold">Invite account</h2>
        <p className="mt-1 text-sm text-slate-500">{form.role === "custodian" ? "Create a custodian account and share its one-time temporary password privately. They must change it at first sign-in." : "Invite by email, or approve borrower accounts manually from the account list."}</p>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={invite}>
          <label className="block text-sm font-medium">Role<select className="field mt-1.5" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{["student", "faculty", "custodian", "administrator"].map((role) => <option key={role}>{role}</option>)}</select></label>
          {borrowerRoles.includes(form.role) && <Field label="Full name" value={form.fullName} onChange={(value) => setForm({ ...form, fullName: value })} placeholder="Ex. Juan Dela Cruz" autoComplete="name" required />}
          <Field label="Institutional email" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} required />
          {form.role === "student" && <><Field label="Student ID" value={form.studentId} onChange={(value) => setForm({ ...form, studentId: value })} required /><Field label="Program" value={form.program} onChange={(value) => setForm({ ...form, program: value })} required /></>}
          <button className="btn-primary sm:col-span-2">{form.role === "custodian" ? "Create custodian account" : "Create account invite"}</button>
        </form>
      </section>
      <section className="card p-5">
        <h2 className="font-semibold">Add equipment category</h2>
        <form onSubmit={addCategory} className="mt-4 space-y-3">
          <Field label="Category name" value={category.name} onChange={(value) => setCategory({ ...category, name: value })} required />
          <Field label="Description" value={category.description} onChange={(value) => setCategory({ ...category, description: value })} />
          <button className="btn-secondary">Add category</button>
        </form>
      </section>
    </div>
    <section id="user-accounts" className="card mt-5 p-5">
      <h2 className="font-semibold">User accounts</h2>
      <p className="mt-1 text-sm text-slate-500">Admin approval allows borrower sign-in without verifying mailbox ownership. Approve only people whose campus identity you have checked.</p>
      <div className="table-scroll mt-4">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Email", "Role", "Student ID", "Program", "Verified / approved", "Account", "Actions"].map((column) => <th className="px-3 py-3" key={column}>{column}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {accounts.map((account) => <tr key={account.id}>
              <td className="px-3 py-3"><div className="flex min-w-56 items-center gap-2"><input className="field min-w-0 py-2" aria-label={`Full name for ${account.email}`} value={account.fullName || ""} placeholder="Enter actual name" onChange={(event) => setAccounts((current) => current.map((item) => item.id === account.id ? { ...item, fullName: event.target.value } : item))} /><button className="shrink-0 font-medium text-blue-700" onClick={() => saveAccountName(account)}>Save</button></div></td>
              <td className="px-3 py-3 capitalize">{account.role}</td>
              <td className="px-3 py-3">{account.studentId || "—"}</td>
              <td className="px-3 py-3">{account.program || "—"}</td>
              <td className="px-3 py-3">{account.emailVerifiedAt ? "Yes" : "Pending"}</td>
              <td className="px-3 py-3 capitalize">{account.status}</td>
              <td className="px-3 py-3"><div className="flex gap-3">
                <button className="font-medium text-blue-700" onClick={() => changeStatus(account)}>{account.status === "active" ? "Disable" : "Enable"}</button>
                {!account.emailVerifiedAt && borrowerRoles.includes(account.role) && <button className="font-medium text-emerald-700" onClick={() => approveBorrower(account)}>Approve borrower</button>}
                {account.role === "custodian" && <button className="font-medium text-blue-700" onClick={() => resendInvitation(account)}>Generate temporary password</button>}
                {account.role !== "custodian" && !account.emailVerifiedAt && <button className="font-medium text-blue-700" onClick={() => resendInvitation(account)}>Resend invitation</button>}
              </div></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  </>;
}

function App() {
  return <AuthProvider><BrowserRouter><Routes>
    <Route path="/login" element={<AuthPage mode="login" />} />
    <Route path="/register" element={<AuthPage mode="register" />} />
    <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="/verify-email" element={<VerifyPage />} />
    <Route path="*" element={<Protected><Layout><Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/equipment" element={<EquipmentPage />} />
      <Route path="/notifications" element={<NotificationsPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/reserve/:id" element={<Protected roles={borrowerRoles}><ReservePage /></Protected>} />
      <Route path="/reservations" element={<ReservationsPage />} />
      <Route path="/desk" element={<Protected roles={["custodian", "administrator"]}><DeskPage /></Protected>} />
      <Route path="/reports" element={<Protected roles={["custodian", "administrator"]}><ReportsPage /></Protected>} />
      <Route path="/admin" element={<Protected roles={["administrator"]}><AdminPage /></Protected>} />
      <Route path="*" element={<div className="card p-8 text-center"><h1 className="text-xl font-semibold">Page not found</h1><Link className="mt-3 inline-block text-blue-700" to="/">Return to overview</Link></div>} />
    </Routes></Layout></Protected>} />
  </Routes></BrowserRouter></AuthProvider>;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
