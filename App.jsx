import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  Wrench, Zap, Fuel, KeyRound, CircleDot, Truck, RotateCw, LifeBuoy,
  Plus, Home, Briefcase, Settings, LogOut, MapPin, Clock,
  CheckCircle2, Edit3, Trash2, FileText, User,
  Phone, TrendingUp, Calendar, ChevronRight, X, Search, Check,
  ArrowLeft, Share2, Sparkles, Target, Activity
} from "lucide-react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  doc, setDoc, onSnapshot,
  collection, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp,
} from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase.js";

/* ============================================================
   K31 MOBILE TIRE SHOP & ROADSIDE ASSISTANCE
   Production build w/ Firebase Auth + Firestore sync
   ============================================================
   Data model in Firestore:
     users/{uid}               → { profile, settings }
     users/{uid}/jobs/{jobId}  → job document
     users/{uid}/locations/{}  → saved location
   ============================================================ */

const LOGO_SRC = `${import.meta.env.BASE_URL}k31-logo.png`;

/* Palette pulled directly from the logo */
const THEME = {
  primary:     "#1BA5FF",
  primaryDeep: "#0066D6",
  primaryGlow: "#4FC3FF",
  accent:      "#FF7A1F",
  accentGlow:  "#FFB347",
  accentDeep:  "#E85A10",
  chromeHi:    "#F4F4F7",
  chromeMid:   "#C7C7CF",
  chromeLo:    "#6E6E78",
  bg:          "#05060A",
  bgGlow:      "#0C1220",
  surface:     "#11131B",
  surface2:    "#1A1D27",
  border:      "#242836",
  text:        "#F5F7FA",
  textDim:     "#9AA0B0",
  textMute:    "#656B7A",
  success:     "#22C55E",
  warn:        "#EAB308",
  danger:      "#EF4444",
};

const SERVICES = [
  { id: "flat_repair",   name: "Flat Tire Repair",    icon: CircleDot, base: 85 },
  { id: "tire_replace",  name: "Tire Replacement",    icon: Wrench,    base: 100 },
  { id: "tire_rotation", name: "Tire Rotation",       icon: RotateCw,  base: 60 },
  { id: "jump_start",    name: "Jump Start",          icon: Zap,       base: 65 },
  { id: "fuel_delivery", name: "Fuel Delivery",       icon: Fuel,      base: 75 },
  { id: "lockout",       name: "Lockout Service",     icon: KeyRound,  base: 70 },
  { id: "spare_install", name: "Spare Tire Install",  icon: LifeBuoy,  base: 80 },
];

const SOURCES = ["Google", "TikTok", "Instagram", "Facebook", "Referral", "Repeat Customer", "Walk-up", "Other"];

const STATUS = {
  pending:   { key: "pending",   label: "Pending Payment", color: THEME.warn,    icon: Clock },
  progress:  { key: "progress",  label: "In Progress",     color: THEME.primary, icon: Activity },
  completed: { key: "completed", label: "Completed",       color: THEME.success, icon: CheckCircle2 },
};

const fmt$ = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const fmtDate = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtDateShort = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function startOfWeek(d = new Date()) {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}

const CITY_SEED = [
  "Houston, TX","Dallas, TX","Austin, TX","San Antonio, TX","Fort Worth, TX","El Paso, TX",
  "Atlanta, GA","Miami, FL","Orlando, FL","Tampa, FL","Jacksonville, FL",
  "Los Angeles, CA","San Diego, CA","San Francisco, CA","Sacramento, CA","San Jose, CA",
  "Phoenix, AZ","Tucson, AZ","Las Vegas, NV","Denver, CO","Seattle, WA","Portland, OR",
  "Chicago, IL","Detroit, MI","Cleveland, OH","Columbus, OH","Cincinnati, OH",
  "New York, NY","Brooklyn, NY","Philadelphia, PA","Boston, MA","Newark, NJ",
  "Charlotte, NC","Raleigh, NC","Nashville, TN","Memphis, TN","Louisville, KY",
  "St. Louis, MO","Kansas City, MO","Oklahoma City, OK","Tulsa, OK","Little Rock, AR",
  "New Orleans, LA","Baton Rouge, LA","Birmingham, AL","Mobile, AL","Jackson, MS",
];

const DEFAULT_PROFILE = {
  businessName: "K31 Mobile Tire Shop",
  serviceArea: "",
  services: SERVICES.map(s => s.id),
  pricingPreference: "standard",
  onboarded: false,
};

const DEFAULT_SETTINGS = {
  perMileRate: 1.25,
  freeMiles: 5,
  heavyDutyMultiplier: 1.6,
  phone: "",
};

/* ============================================================
   BRAND COMPONENTS
   ============================================================ */
function BrandLogo({ size = 140, className = "" }) {
  return (
    <img src={LOGO_SRC} alt="K31 Mobile Tire Shop"
      className={`k31-logo-img ${className}`}
      style={{ width: size, height: "auto", maxWidth: "100%" }}
      draggable={false} />
  );
}

function BrandLogoCompact({ size = 44 }) {
  return (
    <div className="k31-logo-compact" style={{ width: size, height: size }} aria-label="K31">
      <img src={LOGO_SRC} alt="" draggable={false} />
    </div>
  );
}

/* ============================================================
   ROOT APP — owns Firebase auth + Firestore subscriptions
   ============================================================ */
export default function App() {
  /* ---- AUTH STATE ---- */
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);

  /* ---- USER DATA (synced from Firestore) ---- */
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [jobs, setJobs] = useState([]);
  const [savedLocations, setSavedLocations] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  /* ---- NAV ---- */
  const [tab, setTab] = useState("dashboard");
  const [editingJobId, setEditingJobId] = useState(null);
  const [viewingJobId, setViewingJobId] = useState(null);

  /* ---- Subscribe to auth state ---- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setUser(fbUser);
      setAuthChecking(false);
      if (!fbUser) {
        // Reset local state on sign-out
        setProfile(DEFAULT_PROFILE);
        setSettings(DEFAULT_SETTINGS);
        setJobs([]);
        setSavedLocations([]);
        setDataLoaded(false);
      }
    });
    return () => unsub();
  }, []);

  /* ---- Subscribe to user doc (profile + settings) ---- */
  useEffect(() => {
    if (!user) return;
    const userRef = doc(db, "users", user.uid);
    const unsub = onSnapshot(userRef, async (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setProfile({ ...DEFAULT_PROFILE, ...(data.profile || {}) });
        setSettings({ ...DEFAULT_SETTINGS, ...(data.settings || {}) });
      } else {
        // First login: create user doc
        await setDoc(userRef, {
          profile: DEFAULT_PROFILE,
          settings: DEFAULT_SETTINGS,
          createdAt: serverTimestamp(),
          email: user.email,
        });
      }
      setDataLoaded(true);
    }, (err) => {
      console.error("User doc sync error:", err);
      setDataLoaded(true);
    });
    return () => unsub();
  }, [user]);

  /* ---- Subscribe to jobs collection ---- */
  useEffect(() => {
    if (!user) return;
    const jobsRef = collection(db, "users", user.uid, "jobs");
    const q = query(jobsRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          // Convert Firestore Timestamp → ms for UI code
          createdAt: data.createdAt?.toMillis?.() || data.createdAt || Date.now(),
        };
      });
      setJobs(items);
    }, (err) => console.error("Jobs sync error:", err));
    return () => unsub();
  }, [user]);

  /* ---- Subscribe to saved locations ---- */
  useEffect(() => {
    if (!user) return;
    const locsRef = collection(db, "users", user.uid, "locations");
    const unsub = onSnapshot(locsRef, (snap) => {
      setSavedLocations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Locations sync error:", err));
    return () => unsub();
  }, [user]);

  /* ---- Firestore mutations ---- */
  const updateProfile = useCallback(async (updates) => {
    if (!user) return;
    const merged = { ...profile, ...updates };
    setProfile(merged); // optimistic
    try {
      await setDoc(doc(db, "users", user.uid), { profile: merged }, { merge: true });
    } catch (e) { console.error("updateProfile:", e); }
  }, [user, profile]);

  const updateSettings = useCallback(async (updates) => {
    if (!user) return;
    const merged = { ...settings, ...updates };
    setSettings(merged);
    try {
      await setDoc(doc(db, "users", user.uid), { settings: merged }, { merge: true });
    } catch (e) { console.error("updateSettings:", e); }
  }, [user, settings]);

  const bumpSavedLocation = useCallback(async (locName) => {
    if (!user || !locName) return;
    const existing = savedLocations.find(p => p.name.toLowerCase() === locName.toLowerCase());
    try {
      if (existing) {
        await updateDoc(doc(db, "users", user.uid, "locations", existing.id), {
          count: (existing.count || 0) + 1,
          lastUsed: Date.now(),
        });
      } else {
        await addDoc(collection(db, "users", user.uid, "locations"), {
          name: locName, count: 1, lastUsed: Date.now(),
        });
      }
    } catch (e) { console.error("bumpSavedLocation:", e); }
  }, [user, savedLocations]);

  const saveJob = useCallback(async (jobData) => {
    if (!user) return;
    bumpSavedLocation(jobData.location);
    try {
      if (jobData.id) {
        const { id, ...rest } = jobData;
        await updateDoc(doc(db, "users", user.uid, "jobs", id), {
          ...rest, updatedAt: serverTimestamp(),
        });
      } else {
        const { id, ...rest } = jobData;
        await addDoc(collection(db, "users", user.uid, "jobs"), {
          ...rest,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (e) { console.error("saveJob:", e); alert("Failed to save job. Check your internet connection."); }
  }, [user, bumpSavedLocation]);

  const deleteJob = useCallback(async (id) => {
    if (!user) return;
    try { await deleteDoc(doc(db, "users", user.uid, "jobs", id)); }
    catch (e) { console.error("deleteJob:", e); }
  }, [user]);

  const updateJobStatus = useCallback(async (id, status) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, "users", user.uid, "jobs", id), {
        status, updatedAt: serverTimestamp(),
      });
    } catch (e) { console.error("updateJobStatus:", e); }
  }, [user]);

  const handleLogout = async () => {
    try { await signOut(auth); } catch (e) { console.error(e); }
  };

  /* ---- Render guards ---- */
  if (authChecking) return <LoadingScreen label="Loading..." />;
  if (!user) return <AuthScreen />;
  if (!dataLoaded) return <LoadingScreen label="Syncing your data..." />;
  if (!profile.onboarded) {
    return <Onboarding
      profile={profile}
      onDone={(data) => updateProfile({ ...data, onboarded: true })}
    />;
  }

  /* ---- Routing ---- */
  if (tab === "new" || editingJobId) {
    const editing = editingJobId ? jobs.find(j => j.id === editingJobId) : null;
    return (
      <JobForm
        existing={editing}
        profile={profile}
        settings={settings}
        savedLocations={savedLocations}
        onCancel={() => { setTab("dashboard"); setEditingJobId(null); }}
        onSave={async (data) => { await saveJob(data); setEditingJobId(null); setTab("jobs"); }}
      />
    );
  }

  if (viewingJobId) {
    const job = jobs.find(j => j.id === viewingJobId);
    if (!job) { setViewingJobId(null); return null; }
    return (
      <JobDetail
        job={job}
        profile={profile}
        settings={settings}
        onBack={() => setViewingJobId(null)}
        onEdit={() => { setEditingJobId(job.id); setViewingJobId(null); }}
        onDelete={async () => { await deleteJob(job.id); setViewingJobId(null); }}
        onStatus={(s) => updateJobStatus(job.id, s)}
      />
    );
  }

  return (
    <div className="k31-app">
      <GlobalStyles />
      <main className="k31-main">
        {tab === "dashboard" && (
          <Dashboard
            jobs={jobs}
            profile={profile}
            onNewJob={() => setTab("new")}
            onOpenJob={(id) => setViewingJobId(id)}
            onOpenJobs={() => setTab("jobs")}
          />
        )}
        {tab === "jobs" && (
          <JobsList jobs={jobs} onOpenJob={(id) => setViewingJobId(id)} onNewJob={() => setTab("new")} />
        )}
        {tab === "settings" && (
          <SettingsScreen
            profile={profile}
            updateProfile={updateProfile}
            settings={settings}
            updateSettings={updateSettings}
            user={user}
            onLogout={handleLogout}
          />
        )}
      </main>
      <BottomNav tab={tab} onTab={setTab} onQuickAdd={() => setTab("new")} />
    </div>
  );
}

/* ============================================================
   LOADING SCREEN
   ============================================================ */
function LoadingScreen({ label }) {
  return (
    <div className="k31-loading">
      <GlobalStyles />
      <BrandLogo size={180} />
      <div className="k31-loading-spinner" />
      <div className="k31-loading-label">{label}</div>
    </div>
  );
}

/* ============================================================
   AUTH — real Firebase
   ============================================================ */
function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!email || !password) { setErr("Enter email and password"); return; }
    if (password.length < 6) { setErr("Password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (e) {
      setErr(prettyFirebaseError(e));
    } finally {
      setLoading(false);
    }
  };

  const googleSignIn = async () => {
    setErr(""); setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setErr(prettyFirebaseError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="k31-auth">
      <GlobalStyles />
      <div className="k31-auth-bg" />
      <div className="k31-auth-speed" />
      <div className="k31-auth-card">
        <div className="k31-auth-logo"><BrandLogo size={240} /></div>
        <div className="k31-auth-tagline">Mobile Tire · Roadside Assistance</div>

        <div className="k31-auth-tabs">
          <button className={`k31-auth-tab ${mode === "login" ? "active" : ""}`} onClick={() => setMode("login")}>Sign In</button>
          <button className={`k31-auth-tab ${mode === "signup" ? "active" : ""}`} onClick={() => setMode("signup")}>Sign Up</button>
        </div>

        <form onSubmit={submit} className="k31-auth-form">
          <label className="k31-label">Email</label>
          <input className="k31-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="driver@example.com" autoComplete="email" />
          <label className="k31-label">Password</label>
          <input className="k31-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode === "login" ? "current-password" : "new-password"} />
          {err && <div className="k31-err">{err}</div>}
          <button type="submit" className="k31-btn-primary" disabled={loading}>
            {loading ? "Loading..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div className="k31-auth-divider"><span>or</span></div>

        <button className="k31-btn-google" onClick={googleSignIn} disabled={loading}>
          <GoogleIcon /> Continue with Google
        </button>

        <div className="k31-auth-foot">Tire shops & roadside pros · Track jobs · Grow revenue</div>
      </div>
    </div>
  );
}

function prettyFirebaseError(e) {
  const code = e?.code || "";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password") return "Wrong email or password.";
  if (code === "auth/user-not-found") return "No account found with that email.";
  if (code === "auth/email-already-in-use") return "An account already exists with that email. Try signing in.";
  if (code === "auth/invalid-email") return "Invalid email address.";
  if (code === "auth/weak-password") return "Password too weak (min 6 chars).";
  if (code === "auth/popup-closed-by-user") return "Sign-in cancelled.";
  if (code === "auth/popup-blocked") return "Pop-up blocked. Please allow pop-ups for this site.";
  if (code === "auth/network-request-failed") return "Network error. Check your connection.";
  if (code === "auth/too-many-requests") return "Too many attempts. Try again in a few minutes.";
  return e?.message || "Something went wrong. Please try again.";
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2c-.3 1.4-1.1 2.6-2.3 3.4v2.8h3.7c2.2-2 3.4-5 3.4-8.4z"/>
      <path fill="#34A853" d="M12 23c3.1 0 5.7-1 7.6-2.8l-3.7-2.8c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v2.9C3.7 20.5 7.6 23 12 23z"/>
      <path fill="#FBBC04" d="M5.6 13.8c-.2-.7-.4-1.4-.4-2.1s.1-1.4.4-2.1V6.7H1.8C1 8.3.5 10.1.5 12s.5 3.7 1.3 5.3l3.8-3z"/>
      <path fill="#EA4335" d="M12 5.4c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 2 15.1 1 12 1 7.6 1 3.7 3.5 1.8 7.1l3.8 2.9C6.5 7.4 9 5.4 12 5.4z"/>
    </svg>
  );
}

/* ============================================================
   ONBOARDING
   ============================================================ */
function Onboarding({ profile, onDone }) {
  const [step, setStep] = useState(0);
  const [local, setLocal] = useState({
    businessName: profile.businessName || "K31 Mobile Tire Shop",
    serviceArea: profile.serviceArea || "",
    services: profile.services?.length ? profile.services : SERVICES.map(s => s.id),
    pricingPreference: profile.pricingPreference || "standard",
  });
  const [saving, setSaving] = useState(false);
  const steps = ["Business Name", "Service Area", "Services Offered", "Pricing Preference"];
  const back = () => step > 0 && setStep(step - 1);
  const canNext = () => {
    if (step === 0) return local.businessName.trim().length > 1;
    if (step === 1) return local.serviceArea.trim().length > 1;
    if (step === 2) return local.services.length > 0;
    return true;
  };

  const next = async () => {
    if (step < steps.length - 1) setStep(step + 1);
    else {
      setSaving(true);
      await onDone(local);
    }
  };

  return (
    <div className="k31-onboard">
      <GlobalStyles />
      <div className="k31-onboard-head">
        <div className="k31-onboard-logo"><BrandLogo size={110} /></div>
        <div className="k31-progress-row">
          {steps.map((_, i) => <div key={i} className={`k31-progress-dot ${i <= step ? "active" : ""}`} />)}
        </div>
        <div className="k31-step-label">Step {step + 1} of {steps.length}</div>
        <h1 className="k31-step-title">{steps[step]}</h1>
      </div>

      <div className="k31-onboard-body">
        {step === 0 && (
          <div className="k31-field">
            <label className="k31-label">What's your business name?</label>
            <input className="k31-input" value={local.businessName}
              onChange={e => setLocal({ ...local, businessName: e.target.value })}
              placeholder="K31 Mobile Tire Shop" autoFocus />
            <p className="k31-hint">This shows on invoices sent to customers.</p>
          </div>
        )}

        {step === 1 && (
          <div className="k31-field">
            <label className="k31-label">Your primary service area</label>
            <CitySearchInput value={local.serviceArea}
              onChange={(v) => setLocal({ ...local, serviceArea: v })}
              placeholder="Start typing a city..." />
            <p className="k31-hint">Your home base. Jobs outside this area get mileage charges.</p>
          </div>
        )}

        {step === 2 && (
          <div className="k31-field">
            <label className="k31-label">Which services do you offer?</label>
            <div className="k31-service-grid">
              {SERVICES.map(s => {
                const on = local.services.includes(s.id);
                const Icon = s.icon;
                return (
                  <button key={s.id} type="button" className={`k31-service-card ${on ? "on" : ""}`}
                    onClick={() => {
                      const nxt = on ? local.services.filter(x => x !== s.id) : [...local.services, s.id];
                      setLocal({ ...local, services: nxt });
                    }}>
                    <Icon size={22} />
                    <span className="k31-service-name">{s.name}</span>
                    <span className="k31-service-base">Base {fmt$(s.base)}</span>
                    {on && <span className="k31-service-check"><Check size={14} /></span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="k31-field">
            <label className="k31-label">Pricing style</label>
            <div className="k31-pricing-choices">
              {[
                { id: "budget",   label: "Budget",   desc: "Below-market pricing to win volume" },
                { id: "standard", label: "Standard", desc: "Market-rate base pricing" },
                { id: "premium",  label: "Premium",  desc: "+20% on base for fast, pro service" },
              ].map(p => (
                <button key={p.id} type="button" className={`k31-pricing-card ${local.pricingPreference === p.id ? "on" : ""}`}
                  onClick={() => setLocal({ ...local, pricingPreference: p.id })}>
                  <div className="k31-pricing-label">{p.label}</div>
                  <div className="k31-pricing-desc">{p.desc}</div>
                </button>
              ))}
            </div>
            <p className="k31-hint">You can always override price on individual jobs.</p>
          </div>
        )}
      </div>

      <div className="k31-onboard-foot">
        {step > 0 && <button className="k31-btn-ghost" onClick={back}>Back</button>}
        <button className="k31-btn-primary" onClick={next} disabled={!canNext() || saving}>
          {saving ? "Saving..." : step === steps.length - 1 ? "Finish Setup" : "Continue"}
          {!saving && <ChevronRight size={18} />}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function Dashboard({ jobs, profile, onNewJob, onOpenJob, onOpenJobs }) {
  const weekStart = useMemo(() => startOfWeek(), []);
  const thisWeek = useMemo(() => jobs.filter(j => new Date(j.createdAt) >= weekStart), [jobs, weekStart]);
  const completedWeek = thisWeek.filter(j => j.status === "completed");
  const weekEarnings = completedWeek.reduce((s, j) => s + (j.finalPrice || 0), 0);
  const weekProfit = completedWeek.reduce((s, j) => s + (j.profit || 0), 0);
  const weeklyGoal = 2000;
  const goalPct = Math.min(100, (weekEarnings / weeklyGoal) * 100);

  const dayTotals = [0, 0, 0, 0, 0, 0, 0];
  completedWeek.forEach(j => { dayTotals[new Date(j.createdAt).getDay()] += j.finalPrice || 0; });
  const dayMax = Math.max(...dayTotals, 1);

  const pendingCount = jobs.filter(j => j.status === "pending").length;
  const inProgressCount = jobs.filter(j => j.status === "progress").length;
  const recent = jobs.slice(0, 5);

  return (
    <div className="k31-page">
      <header className="k31-header">
        <div className="k31-header-brand">
          <BrandLogoCompact size={48} />
          <div>
            <div className="k31-greet">Welcome back</div>
            <h1 className="k31-biz">{profile.businessName || "K31 Mobile Tire Shop"}</h1>
          </div>
        </div>
        <button className="k31-fab-mini" onClick={onNewJob} aria-label="Quick add job"><Plus size={20} /></button>
      </header>

      <section className="k31-card k31-week-card">
        <div className="k31-week-top">
          <div>
            <div className="k31-week-label">Current Week Progress</div>
            <div className="k31-week-amount">{fmt$(weekEarnings)}</div>
            <div className="k31-week-sub">of {fmt$(weeklyGoal)} goal · {completedWeek.length} completed</div>
          </div>
          <ProgressRing pct={goalPct} />
        </div>
        <div className="k31-week-bars">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div key={i} className="k31-bar-col">
              <div className="k31-bar-wrap">
                <div className="k31-bar-fill" style={{ height: `${(dayTotals[i] / dayMax) * 100}%` }} />
              </div>
              <div className="k31-bar-label">{d}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="k31-stats">
        <div className="k31-stat">
          <TrendingUp size={18} style={{ color: THEME.success }} />
          <div className="k31-stat-val">{fmt$(weekProfit)}</div>
          <div className="k31-stat-label">Profit</div>
        </div>
        <div className="k31-stat">
          <Activity size={18} style={{ color: THEME.primary }} />
          <div className="k31-stat-val">{inProgressCount}</div>
          <div className="k31-stat-label">Active</div>
        </div>
        <div className="k31-stat">
          <Clock size={18} style={{ color: THEME.warn }} />
          <div className="k31-stat-val">{pendingCount}</div>
          <div className="k31-stat-label">Pending</div>
        </div>
      </section>

      <section className="k31-quick">
        <h3 className="k31-sec-title">Quick Start</h3>
        <div className="k31-quick-grid">
          {SERVICES.filter(s => profile.services.includes(s.id)).slice(0, 4).map(s => {
            const Icon = s.icon;
            return (
              <button key={s.id} className="k31-quick-tile" onClick={onNewJob}>
                <Icon size={22} />
                <span>{s.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="k31-recent-head">
          <h3 className="k31-sec-title">Recent Jobs</h3>
          {jobs.length > 0 && <button className="k31-link" onClick={onOpenJobs}>See all <ChevronRight size={14} /></button>}
        </div>
        {recent.length === 0 ? (
          <EmptyState title="No jobs yet" desc="Tap the + button to create your first job." cta="Create Job" onCta={onNewJob} />
        ) : (
          <div className="k31-job-list">
            {recent.map(j => <JobRow key={j.id} job={j} onClick={() => onOpenJob(j.id)} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function ProgressRing({ pct }) {
  const r = 28, c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <svg width="72" height="72" viewBox="0 0 72 72">
      <defs>
        <linearGradient id="k31-ring" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={THEME.primaryGlow} />
          <stop offset="100%" stopColor={THEME.primaryDeep} />
        </linearGradient>
      </defs>
      <circle cx="36" cy="36" r={r} stroke={THEME.border} strokeWidth="6" fill="none" />
      <circle cx="36" cy="36" r={r} stroke="url(#k31-ring)" strokeWidth="6" fill="none"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
        transform="rotate(-90 36 36)" style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      <text x="36" y="41" textAnchor="middle" fill={THEME.text} fontSize="14" fontWeight="700">{Math.round(pct)}%</text>
    </svg>
  );
}

/* ============================================================
   JOBS LIST
   ============================================================ */
function JobsList({ jobs, onOpenJob, onNewJob }) {
  const [filter, setFilter] = useState("all");
  const filtered = jobs.filter(j => filter === "all" ? true : j.status === filter);

  return (
    <div className="k31-page">
      <header className="k31-header">
        <div className="k31-header-brand">
          <BrandLogoCompact size={48} />
          <div>
            <div className="k31-greet">Job History</div>
            <h1 className="k31-biz">{jobs.length} Total</h1>
          </div>
        </div>
        <button className="k31-fab-mini" onClick={onNewJob} aria-label="New job"><Plus size={20} /></button>
      </header>

      <div className="k31-filter-row">
        {[
          { k: "all", l: "All" },
          { k: "pending", l: "Pending" },
          { k: "progress", l: "Active" },
          { k: "completed", l: "Done" },
        ].map(f => (
          <button key={f.k} className={`k31-chip ${filter === f.k ? "on" : ""}`} onClick={() => setFilter(f.k)}>{f.l}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={filter === "all" ? "No jobs yet" : "No jobs in this filter"}
          desc={filter === "all" ? "Tap below to create your first job." : "Try another filter."}
          cta={filter === "all" ? "Create Job" : null}
          onCta={onNewJob}
        />
      ) : (
        <div className="k31-job-list">
          {filtered.map(j => <JobRow key={j.id} job={j} onClick={() => onOpenJob(j.id)} />)}
        </div>
      )}
    </div>
  );
}

function JobRow({ job, onClick }) {
  const svc = SERVICES.find(s => s.id === job.serviceId);
  const Icon = svc?.icon || Wrench;
  const st = STATUS[job.status] || STATUS.pending;
  const StatusIcon = st.icon;
  return (
    <button className="k31-job-row" onClick={onClick}>
      <div className="k31-job-icon"><Icon size={20} /></div>
      <div className="k31-job-main">
        <div className="k31-job-title-row">
          <span className="k31-job-svc">{svc?.name || "Service"}</span>
          {job.heavyDuty && <span className="k31-tag-hd">HD</span>}
        </div>
        <div className="k31-job-meta">
          <MapPin size={11} /> {job.location || "No location"} · {fmtDateShort(job.createdAt)}
        </div>
        {job.customerName && (
          <div className="k31-job-meta dim"><User size={11} /> {job.customerName}</div>
        )}
      </div>
      <div className="k31-job-right">
        <div className="k31-job-price">{fmt$(job.finalPrice)}</div>
        <div className="k31-job-status" style={{ color: st.color }}>
          <StatusIcon size={12} /> {st.label}
        </div>
      </div>
    </button>
  );
}

/* ============================================================
   JOB FORM
   ============================================================ */
function JobForm({ existing, profile, settings, savedLocations, onCancel, onSave }) {
  const isEdit = !!existing;
  const [serviceId, setServiceId] = useState(existing?.serviceId || profile.services[0] || SERVICES[0].id);
  const [heavyDuty, setHeavyDuty] = useState(existing?.heavyDuty || false);
  const [location, setLocation] = useState(existing?.location || "");
  const [miles, setMiles] = useState(existing?.miles ?? 0);
  const [customAdj, setCustomAdj] = useState(existing?.customAdj ?? 0);
  const [overridePrice, setOverridePrice] = useState(existing?.overridePrice ?? "");
  const [materialCost, setMaterialCost] = useState(existing?.materialCost ?? 0);
  const [customerName, setCustomerName] = useState(existing?.customerName || "");
  const [customerPhone, setCustomerPhone] = useState(existing?.customerPhone || "");
  const [source, setSource] = useState(existing?.source || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [status, setStatus] = useState(existing?.status || "pending");
  const [saving, setSaving] = useState(false);

  const svc = SERVICES.find(s => s.id === serviceId);
  const pricingMultiplier = profile.pricingPreference === "premium" ? 1.2
                         : profile.pricingPreference === "budget"   ? 0.9 : 1.0;

  const basePrice = useMemo(() => {
    if (!svc) return 0;
    let b = svc.base * pricingMultiplier;
    if (heavyDuty) b *= settings.heavyDutyMultiplier;
    return Math.round(b * 100) / 100;
  }, [svc, pricingMultiplier, heavyDuty, settings.heavyDutyMultiplier]);

  const distanceAdj = useMemo(() => {
    const billable = Math.max(0, Number(miles) - settings.freeMiles);
    return Math.round(billable * settings.perMileRate * 100) / 100;
  }, [miles, settings.perMileRate, settings.freeMiles]);

  const customAdjNum = Number(customAdj) || 0;
  const suggestedPrice = Math.round((basePrice + distanceAdj + customAdjNum) * 100) / 100;
  const hasOverride = overridePrice !== "" && !isNaN(Number(overridePrice));
  const finalPrice = hasOverride ? Math.max(0, Number(overridePrice)) : suggestedPrice;
  const profit = Math.max(0, finalPrice - (Number(materialCost) || 0));

  const canSave = serviceId && location.trim().length > 0 && finalPrice >= 0 && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    await onSave({
      id: existing?.id,
      serviceId, heavyDuty,
      location: location.trim(),
      miles: Number(miles) || 0,
      customAdj: customAdjNum,
      overridePrice: hasOverride ? Number(overridePrice) : null,
      basePrice, distanceAdj, suggestedPrice, finalPrice,
      materialCost: Number(materialCost) || 0,
      profit,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      source,
      notes: notes.trim(),
      status,
    });
  };

  return (
    <div className="k31-page k31-form-page">
      <GlobalStyles />
      <header className="k31-form-head">
        <button className="k31-icon-btn" onClick={onCancel} aria-label="Cancel"><ArrowLeft size={20} /></button>
        <h1 className="k31-form-title">{isEdit ? "Edit Job" : "New Job"}</h1>
        <div style={{ width: 40 }} />
      </header>

      <div className="k31-form-body">
        <section className="k31-card">
          <h3 className="k31-sec-title">Service</h3>
          <div className="k31-service-picker">
            {SERVICES.filter(s => profile.services.includes(s.id)).map(s => {
              const Icon = s.icon;
              const on = serviceId === s.id;
              return (
                <button key={s.id} type="button" className={`k31-svc-pick ${on ? "on" : ""}`} onClick={() => setServiceId(s.id)}>
                  <Icon size={18} /><span>{s.name}</span>
                </button>
              );
            })}
          </div>
          <label className="k31-toggle-row">
            <div>
              <div className="k31-toggle-title"><Truck size={14} /> Heavy Duty / Truck</div>
              <div className="k31-toggle-desc">+{Math.round((settings.heavyDutyMultiplier - 1) * 100)}% for semis, RVs, fleet</div>
            </div>
            <Toggle on={heavyDuty} onChange={setHeavyDuty} />
          </label>
        </section>

        <section className="k31-card">
          <h3 className="k31-sec-title">Location</h3>
          <CitySearchInput value={location} onChange={setLocation} savedLocations={savedLocations} placeholder="Enter or search city..." />
          <div className="k31-row-2">
            <div className="k31-field-inline">
              <label className="k31-label">Miles from base</label>
              <input className="k31-input" type="number" min="0" step="0.1" value={miles} onChange={e => setMiles(e.target.value)} />
            </div>
            <div className="k31-field-inline">
              <label className="k31-label">Free miles</label>
              <input className="k31-input" type="number" value={settings.freeMiles} disabled />
            </div>
          </div>
        </section>

        <section className="k31-card">
          <h3 className="k31-sec-title">Pricing</h3>
          <div className="k31-price-breakdown">
            <div className="k31-price-line"><span>Base ({svc?.name})</span><span>{fmt$(basePrice)}</span></div>
            <div className="k31-price-line">
              <span>Distance ({Math.max(0, Number(miles) - settings.freeMiles).toFixed(1)} mi × {fmt$(settings.perMileRate)})</span>
              <span>{fmt$(distanceAdj)}</span>
            </div>
            <div className="k31-price-line">
              <span>Custom adjustment</span>
              <input className="k31-price-inline" type="number" step="0.01" value={customAdj} onChange={e => setCustomAdj(e.target.value)} />
            </div>
            <div className="k31-price-line k31-price-sug">
              <span><Sparkles size={12} /> Suggested Price</span>
              <span className="k31-price-sug-val">{fmt$(suggestedPrice)}</span>
            </div>
          </div>

          <div className="k31-field-inline">
            <label className="k31-label">Manual Override (optional)</label>
            <input className="k31-input" type="number" step="0.01" min="0" value={overridePrice}
              onChange={e => setOverridePrice(e.target.value)}
              placeholder={`Leave blank to use ${fmt$(suggestedPrice)}`} />
            {hasOverride && (
              <button type="button" className="k31-link-btn" onClick={() => setOverridePrice("")}>Reset to suggested</button>
            )}
          </div>

          <div className="k31-final-row">
            <div>
              <div className="k31-final-label">Final Price</div>
              <div className="k31-final-val">{fmt$(finalPrice)}</div>
            </div>
            <Target size={28} style={{ color: THEME.accent }} />
          </div>

          <div className="k31-field-inline">
            <label className="k31-label">Material cost (for profit tracking only)</label>
            <input className="k31-input" type="number" step="0.01" min="0" value={materialCost} onChange={e => setMaterialCost(e.target.value)} placeholder="0.00" />
            <p className="k31-hint">Not shown on invoice. Used only for your profit reports.</p>
          </div>

          <div className="k31-profit-chip"><TrendingUp size={14} /> Est. Profit: {fmt$(profit)}</div>
        </section>

        <section className="k31-card">
          <h3 className="k31-sec-title">Customer (optional)</h3>
          <div className="k31-field-inline">
            <label className="k31-label">Name</label>
            <input className="k31-input" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="John Smith" />
          </div>
          <div className="k31-field-inline">
            <label className="k31-label">Phone</label>
            <input className="k31-input" type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="(555) 123-4567" />
          </div>
          <div className="k31-field-inline">
            <label className="k31-label">Source</label>
            <div className="k31-source-chips">
              {SOURCES.map(s => (
                <button key={s} type="button" className={`k31-chip ${source === s ? "on" : ""}`}
                  onClick={() => setSource(source === s ? "" : s)}>{s}</button>
              ))}
            </div>
          </div>
        </section>

        <section className="k31-card">
          <h3 className="k31-sec-title">Status</h3>
          <div className="k31-status-picker">
            {Object.values(STATUS).map(s => {
              const Icon = s.icon;
              const on = status === s.key;
              return (
                <button key={s.key} type="button" className={`k31-status-pick ${on ? "on" : ""}`}
                  onClick={() => setStatus(s.key)} style={on ? { borderColor: s.color, color: s.color } : {}}>
                  <Icon size={14} /> {s.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="k31-card">
          <h3 className="k31-sec-title">Notes</h3>
          <textarea className="k31-textarea" value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Any job notes..." />
        </section>

        <div className="k31-form-actions">
          <button className="k31-btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="k31-btn-primary" onClick={submit} disabled={!canSave}>
            {saving ? "Saving..." : isEdit ? "Update Job" : "Create Job"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   JOB DETAIL + INVOICE
   ============================================================ */
function JobDetail({ job, profile, settings, onBack, onEdit, onDelete, onStatus }) {
  const [showInvoice, setShowInvoice] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const svc = SERVICES.find(s => s.id === job.serviceId);
  const Icon = svc?.icon || Wrench;
  const st = STATUS[job.status] || STATUS.pending;
  const StatusIcon = st.icon;

  return (
    <div className="k31-page k31-form-page">
      <GlobalStyles />
      <header className="k31-form-head">
        <button className="k31-icon-btn" onClick={onBack} aria-label="Back"><ArrowLeft size={20} /></button>
        <h1 className="k31-form-title">Job Details</h1>
        <button className="k31-icon-btn" onClick={onEdit} aria-label="Edit job"><Edit3 size={18} /></button>
      </header>

      <div className="k31-form-body">
        <section className="k31-card k31-detail-hero">
          <div className="k31-detail-icon"><Icon size={28} /></div>
          <h2 className="k31-detail-svc">{svc?.name}</h2>
          {job.heavyDuty && <span className="k31-tag-hd">Heavy Duty</span>}
          <div className="k31-detail-price">{fmt$(job.finalPrice)}</div>
          <div className="k31-detail-status" style={{ color: st.color }}>
            <StatusIcon size={14} /> {st.label}
          </div>
        </section>

        <section className="k31-card">
          <h3 className="k31-sec-title">Change Status</h3>
          <div className="k31-status-picker">
            {Object.values(STATUS).map(s => {
              const SIcon = s.icon;
              const on = job.status === s.key;
              return (
                <button key={s.key} type="button" className={`k31-status-pick ${on ? "on" : ""}`}
                  onClick={() => onStatus(s.key)} style={on ? { borderColor: s.color, color: s.color } : {}}>
                  <SIcon size={14} /> {s.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="k31-card">
          <h3 className="k31-sec-title">Details</h3>
          <InfoRow icon={MapPin} label="Location" value={job.location || "—"} />
          <InfoRow icon={Calendar} label="Date" value={fmtDate(job.createdAt)} />
          {job.customerName && <InfoRow icon={User} label="Customer" value={job.customerName} />}
          {job.customerPhone && <InfoRow icon={Phone} label="Phone" value={job.customerPhone} />}
          {job.source && <InfoRow icon={Sparkles} label="Source" value={job.source} />}
          {job.notes && (
            <div className="k31-notes-box">
              <div className="k31-label">Notes</div>
              <div>{job.notes}</div>
            </div>
          )}
        </section>

        <section className="k31-card">
          <h3 className="k31-sec-title">Pricing Breakdown</h3>
          <div className="k31-price-breakdown">
            <div className="k31-price-line"><span>Base</span><span>{fmt$(job.basePrice)}</span></div>
            <div className="k31-price-line"><span>Distance</span><span>{fmt$(job.distanceAdj)}</span></div>
            <div className="k31-price-line"><span>Custom adj.</span><span>{fmt$(job.customAdj)}</span></div>
            <div className="k31-price-line k31-price-sug"><span>Suggested</span><span>{fmt$(job.suggestedPrice)}</span></div>
            {job.overridePrice != null && (
              <div className="k31-price-line" style={{ color: THEME.accent }}>
                <span>Manual override</span><span>{fmt$(job.overridePrice)}</span>
              </div>
            )}
            <div className="k31-price-line k31-price-final"><span>Final</span><span>{fmt$(job.finalPrice)}</span></div>
            <div className="k31-price-line dim"><span>Material cost</span><span>{fmt$(job.materialCost)}</span></div>
            <div className="k31-price-line" style={{ color: THEME.success }}><span>Profit</span><span>{fmt$(job.profit)}</span></div>
          </div>
        </section>

        <div className="k31-form-actions">
          <button className="k31-btn-ghost danger" onClick={() => setConfirmDel(true)}><Trash2 size={16} /> Delete</button>
          <button className="k31-btn-primary" onClick={() => setShowInvoice(true)}><FileText size={16} /> Invoice</button>
        </div>
      </div>

      {showInvoice && <InvoiceModal job={job} profile={profile} settings={settings} onClose={() => setShowInvoice(false)} />}
      {confirmDel && (
        <ConfirmModal
          title="Delete this job?"
          message="This can't be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => { setConfirmDel(false); onDelete(); }}
          onCancel={() => setConfirmDel(false)}
        />
      )}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="k31-info-row">
      <Icon size={14} style={{ color: THEME.textDim }} />
      <span className="k31-info-label">{label}</span>
      <span className="k31-info-val">{value}</span>
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel, danger, onConfirm, onCancel }) {
  return (
    <div className="k31-modal-bg" onClick={onCancel}>
      <div className="k31-modal k31-confirm" onClick={e => e.stopPropagation()}>
        <h3 className="k31-confirm-title">{title}</h3>
        <p className="k31-confirm-msg">{message}</p>
        <div className="k31-form-actions">
          <button className="k31-btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="k31-btn-primary"
            style={danger ? { background: THEME.danger, boxShadow: "0 4px 16px rgba(239,68,68,.3)" } : {}}
            onClick={onConfirm}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function InvoiceModal({ job, profile, settings, onClose }) {
  const svc = SERVICES.find(s => s.id === job.serviceId);
  const invoiceNum = `INV-${job.id.slice(0, 6).toUpperCase()}`;
  const [sent, setSent] = useState(false);

  const sendInvoice = async () => {
    const text = `${profile.businessName || "K31 Mobile Tire Shop"}
Invoice ${invoiceNum}
${fmtDate(job.createdAt)}

Service: ${svc?.name}${job.heavyDuty ? " (Heavy Duty)" : ""}
Location: ${job.location}
Amount Due: ${fmt$(job.finalPrice)}

Thank you for your business!
${settings.phone || ""}`;

    if (navigator.share) {
      try { await navigator.share({ title: `Invoice ${invoiceNum}`, text }); setSent(true); }
      catch (e) { /* cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        setSent(true);
        setTimeout(() => setSent(false), 2500);
      } catch (e) { /* ignore */ }
    }
  };

  return (
    <div className="k31-modal-bg" onClick={onClose}>
      <div className="k31-modal" onClick={e => e.stopPropagation()}>
        <div className="k31-modal-head">
          <h3>Invoice</h3>
          <button className="k31-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="k31-invoice">
          <div className="k31-invoice-brand">
            <img src={LOGO_SRC} alt="K31" className="k31-invoice-logo" draggable={false} />
            <div>
              <div className="k31-invoice-biz">{profile.businessName || "K31 Mobile Tire Shop"}</div>
              <div className="k31-invoice-sub">Mobile Tire & Roadside Assistance</div>
            </div>
          </div>

          <div className="k31-invoice-meta">
            <div><span>Invoice #</span><b>{invoiceNum}</b></div>
            <div><span>Date</span><b>{fmtDate(job.createdAt)}</b></div>
          </div>

          {job.customerName && (
            <div className="k31-invoice-bill">
              <div className="k31-label">Bill To</div>
              <div>{job.customerName}</div>
              {job.customerPhone && <div className="dim">{job.customerPhone}</div>}
            </div>
          )}

          <table className="k31-invoice-table">
            <thead><tr><th>Service</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
            <tbody>
              <tr>
                <td>
                  <div>{svc?.name}{job.heavyDuty ? " — HD" : ""}</div>
                  <div className="dim small">{job.location}</div>
                </td>
                <td style={{ textAlign: "right" }}>{fmt$(job.finalPrice)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td><b>Total Due</b></td>
                <td style={{ textAlign: "right" }}><b>{fmt$(job.finalPrice)}</b></td>
              </tr>
            </tfoot>
          </table>

          <div className="k31-invoice-foot">
            Thank you for choosing {profile.businessName || "K31"}.
            {settings.phone && <div>Questions? {settings.phone}</div>}
          </div>
        </div>

        <button className="k31-btn-primary" onClick={sendInvoice} style={{ width: "100%" }}>
          {sent ? <><Check size={16} /> Copied / Shared</> : <><Share2 size={16} /> Send Invoice</>}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   SETTINGS
   ============================================================ */
function SettingsScreen({ profile, updateProfile, settings, updateSettings, user, onLogout }) {
  return (
    <div className="k31-page">
      <header className="k31-header">
        <div className="k31-header-brand">
          <BrandLogoCompact size={48} />
          <div>
            <div className="k31-greet">Settings</div>
            <h1 className="k31-biz">Your Profile</h1>
          </div>
        </div>
      </header>

      <section className="k31-card">
        <h3 className="k31-sec-title">Account</h3>
        <InfoRow icon={User} label="Email" value={user.email || "—"} />
      </section>

      <section className="k31-card">
        <h3 className="k31-sec-title">Business</h3>
        <div className="k31-field-inline">
          <label className="k31-label">Business Name</label>
          <input className="k31-input" value={profile.businessName} onChange={e => updateProfile({ businessName: e.target.value })} />
        </div>
        <div className="k31-field-inline">
          <label className="k31-label">Service Area</label>
          <CitySearchInput value={profile.serviceArea} onChange={v => updateProfile({ serviceArea: v })} />
        </div>
        <div className="k31-field-inline">
          <label className="k31-label">Phone (appears on invoice)</label>
          <input className="k31-input" type="tel" value={settings.phone}
            onChange={e => updateSettings({ phone: e.target.value })}
            placeholder="(555) 123-4567" />
        </div>
      </section>

      <section className="k31-card">
        <h3 className="k31-sec-title">Services Offered</h3>
        <div className="k31-service-grid">
          {SERVICES.map(s => {
            const on = profile.services.includes(s.id);
            const Icon = s.icon;
            return (
              <button key={s.id} type="button" className={`k31-service-card ${on ? "on" : ""}`}
                onClick={() => {
                  const nxt = on ? profile.services.filter(x => x !== s.id) : [...profile.services, s.id];
                  updateProfile({ services: nxt });
                }}>
                <Icon size={22} />
                <span className="k31-service-name">{s.name}</span>
                <span className="k31-service-base">Base {fmt$(s.base)}</span>
                {on && <span className="k31-service-check"><Check size={14} /></span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className="k31-card">
        <h3 className="k31-sec-title">Pricing</h3>
        <div className="k31-pricing-choices">
          {[
            { id: "budget",   label: "Budget",   desc: "-10% on base" },
            { id: "standard", label: "Standard", desc: "Market rate" },
            { id: "premium",  label: "Premium",  desc: "+20% on base" },
          ].map(p => (
            <button key={p.id} type="button" className={`k31-pricing-card ${profile.pricingPreference === p.id ? "on" : ""}`}
              onClick={() => updateProfile({ pricingPreference: p.id })}>
              <div className="k31-pricing-label">{p.label}</div>
              <div className="k31-pricing-desc">{p.desc}</div>
            </button>
          ))}
        </div>

        <div className="k31-row-2">
          <div className="k31-field-inline">
            <label className="k31-label">Per-mile rate</label>
            <input className="k31-input" type="number" step="0.05" value={settings.perMileRate}
              onChange={e => updateSettings({ perMileRate: Number(e.target.value) || 0 })} />
          </div>
          <div className="k31-field-inline">
            <label className="k31-label">Free miles</label>
            <input className="k31-input" type="number" value={settings.freeMiles}
              onChange={e => updateSettings({ freeMiles: Number(e.target.value) || 0 })} />
          </div>
        </div>

        <div className="k31-field-inline">
          <label className="k31-label">Heavy Duty Multiplier</label>
          <input className="k31-input" type="number" step="0.1" min="1" value={settings.heavyDutyMultiplier}
            onChange={e => updateSettings({ heavyDutyMultiplier: Math.max(1, Number(e.target.value) || 1) })} />
          <p className="k31-hint">Multiplier applied to base price for trucks/fleet.</p>
        </div>
      </section>

      <button className="k31-logout" onClick={onLogout}><LogOut size={16} /> Sign Out</button>
      <div className="k31-version">K31 v1.0 · Firebase Build</div>
    </div>
  );
}

/* ============================================================
   REUSABLE
   ============================================================ */
function Toggle({ on, onChange }) {
  return (
    <button type="button" className={`k31-toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} aria-pressed={on}>
      <span className="k31-toggle-knob" />
    </button>
  );
}

function EmptyState({ title, desc, cta, onCta }) {
  return (
    <div className="k31-empty">
      <div className="k31-empty-icon"><Briefcase size={28} /></div>
      <div className="k31-empty-title">{title}</div>
      <div className="k31-empty-desc">{desc}</div>
      {cta && <button className="k31-btn-primary" onClick={onCta}>{cta}</button>}
    </div>
  );
}

function CitySearchInput({ value, onChange, savedLocations = [], placeholder }) {
  const [focus, setFocus] = useState(false);
  const q = (value || "").toLowerCase();

  const suggestions = useMemo(() => {
    const saved = [...savedLocations]
      .sort((a, b) => (b.count || 0) - (a.count || 0) || (b.lastUsed || 0) - (a.lastUsed || 0))
      .map(s => s.name);
    const combined = [...new Set([...saved, ...CITY_SEED])];
    if (!q) return combined.slice(0, 6);
    return combined.filter(c => c.toLowerCase().includes(q)).slice(0, 6);
  }, [q, savedLocations]);

  const showList = focus && suggestions.length > 0;

  return (
    <div className="k31-search-wrap">
      <div className="k31-search-input-wrap">
        <Search size={16} className="k31-search-icon" />
        <input
          className="k31-input k31-search-input"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 160)}
          placeholder={placeholder || "Search cities..."}
        />
      </div>
      {showList && (
        <div className="k31-search-pop">
          {suggestions.map(c => {
            const saved = savedLocations.find(s => s.name === c);
            return (
              <button key={c} type="button" className="k31-search-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange(c)}>
                <MapPin size={13} />
                <span>{c}</span>
                {saved && <span className="k31-saved-count">{saved.count}×</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BottomNav({ tab, onTab, onQuickAdd }) {
  return (
    <nav className="k31-bottomnav">
      <button className={`k31-nav-btn ${tab === "dashboard" ? "on" : ""}`} onClick={() => onTab("dashboard")}>
        <Home size={20} /><span>Home</span>
      </button>
      <button className={`k31-nav-btn ${tab === "jobs" ? "on" : ""}`} onClick={() => onTab("jobs")}>
        <Briefcase size={20} /><span>Jobs</span>
      </button>
      <button className="k31-fab" onClick={onQuickAdd} aria-label="New job"><Plus size={26} /></button>
      <button className={`k31-nav-btn ${tab === "settings" ? "on" : ""}`} onClick={() => onTab("settings")}>
        <Settings size={20} /><span>Settings</span>
      </button>
      <div className="k31-nav-btn ghost" aria-hidden="true" />
    </nav>
  );
}

/* ============================================================
   GLOBAL STYLES
   ============================================================ */
function GlobalStyles() {
  return (
    <style>{`
      :root {
        --k-primary: ${THEME.primary}; --k-primary-deep: ${THEME.primaryDeep}; --k-primary-glow: ${THEME.primaryGlow};
        --k-accent: ${THEME.accent}; --k-accent-glow: ${THEME.accentGlow}; --k-accent-deep: ${THEME.accentDeep};
        --k-chrome-hi: ${THEME.chromeHi}; --k-chrome-mid: ${THEME.chromeMid}; --k-chrome-lo: ${THEME.chromeLo};
        --k-bg: ${THEME.bg}; --k-bg-glow: ${THEME.bgGlow};
        --k-surface: ${THEME.surface}; --k-surface2: ${THEME.surface2}; --k-border: ${THEME.border};
        --k-text: ${THEME.text}; --k-dim: ${THEME.textDim}; --k-mute: ${THEME.textMute};
        --k-success: ${THEME.success}; --k-warn: ${THEME.warn}; --k-danger: ${THEME.danger};
      }
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      html, body, #root {
        margin: 0; padding: 0; height: 100%;
        background: var(--k-bg); color: var(--k-text);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        overscroll-behavior: none;
      }
      .k31-app {
        min-height: 100vh;
        background:
          radial-gradient(ellipse at 50% 0%, rgba(27, 165, 255, .08), transparent 60%),
          radial-gradient(ellipse at 100% 100%, rgba(255, 122, 31, .06), transparent 60%),
          linear-gradient(180deg, #05060A 0%, #0A0D15 100%);
        display: flex; flex-direction: column;
        max-width: 520px; margin: 0 auto; position: relative;
      }
      .k31-main { flex: 1; padding-bottom: 96px; }
      .k31-page { padding: 20px 16px 24px; animation: fadeIn .25s ease; }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

      /* LOADING */
      .k31-loading {
        min-height: 100vh; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 28px;
        background:
          radial-gradient(circle at 50% 50%, rgba(27,165,255,.12), transparent 50%),
          linear-gradient(180deg, #05060A, #0A0D18);
      }
      .k31-loading-spinner {
        width: 36px; height: 36px; border-radius: 50%;
        border: 3px solid var(--k-border); border-top-color: var(--k-primary);
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .k31-loading-label { color: var(--k-dim); font-size: 13px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }

      /* HEADER */
      .k31-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; gap: 12px; }
      .k31-header-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
      .k31-greet { font-size: 12px; color: var(--k-dim); font-weight: 500; letter-spacing: .04em; text-transform: uppercase; }
      .k31-biz {
        font-size: 18px; font-weight: 800; margin: 2px 0 0; letter-spacing: -.01em;
        background: linear-gradient(180deg, var(--k-chrome-hi), var(--k-chrome-mid) 50%, var(--k-chrome-lo));
        -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
      }

      /* LOGO */
      .k31-logo-img {
        display: block;
        filter: drop-shadow(0 4px 22px rgba(27,165,255,.35)) drop-shadow(0 2px 8px rgba(255,122,31,.2));
      }
      .k31-logo-compact {
        background: linear-gradient(135deg, rgba(27,165,255,.12), rgba(255,122,31,.08));
        border: 1px solid var(--k-border); border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; overflow: hidden; padding: 4px;
      }
      .k31-logo-compact img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,.4)); }

      /* BUTTONS */
      .k31-btn-primary {
        position: relative; overflow: hidden;
        background: linear-gradient(135deg, var(--k-primary-glow), var(--k-primary) 40%, var(--k-primary-deep));
        color: white; border: 0; padding: 14px 22px; border-radius: 14px;
        font-size: 15px; font-weight: 700;
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(27,165,255,.35), inset 0 1px 0 rgba(255,255,255,.2);
        transition: transform .1s, opacity .1s; min-height: 48px; letter-spacing: .01em;
      }
      .k31-btn-primary:active { transform: scale(.98); }
      .k31-btn-primary:disabled { opacity: .4; cursor: not-allowed; box-shadow: none; }

      .k31-btn-ghost {
        background: rgba(255,255,255,.02); color: var(--k-text); border: 1px solid var(--k-border);
        padding: 14px 22px; border-radius: 14px; font-size: 15px; font-weight: 600; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 48px;
      }
      .k31-btn-ghost.danger { color: var(--k-danger); border-color: rgba(239,68,68,.4); background: rgba(239,68,68,.04); }
      .k31-btn-ghost:active { transform: scale(.98); }
      .k31-btn-ghost:disabled { opacity: .5; }

      .k31-btn-google {
        background: white; color: #1a1a1a; border: 0;
        padding: 13px 20px; border-radius: 14px; font-size: 15px; font-weight: 600; width: 100%;
        display: flex; align-items: center; justify-content: center; gap: 10px;
        cursor: pointer; min-height: 48px; box-shadow: 0 2px 10px rgba(0,0,0,.3);
      }
      .k31-btn-google:active { transform: scale(.98); }

      .k31-icon-btn {
        background: var(--k-surface2); border: 1px solid var(--k-border);
        width: 40px; height: 40px; border-radius: 12px;
        display: inline-flex; align-items: center; justify-content: center;
        color: var(--k-text); cursor: pointer;
      }
      .k31-icon-btn:active { transform: scale(.95); }

      .k31-link {
        background: transparent; border: 0; color: var(--k-primary);
        font-size: 13px; font-weight: 600; cursor: pointer;
        display: inline-flex; align-items: center; gap: 2px;
      }
      .k31-link-btn { background: transparent; border: 0; color: var(--k-accent); font-size: 12px; font-weight: 600; cursor: pointer; padding: 4px 0; }

      /* INPUTS */
      .k31-label { display: block; font-size: 11px; font-weight: 700; color: var(--k-dim); margin-bottom: 6px; text-transform: uppercase; letter-spacing: .08em; }
      .k31-input, .k31-textarea {
        width: 100%; background: var(--k-surface2); color: var(--k-text);
        border: 1px solid var(--k-border); border-radius: 12px;
        padding: 14px 14px; font-size: 15px; outline: none;
        transition: border-color .15s, box-shadow .15s; font-family: inherit;
      }
      .k31-input:focus, .k31-textarea:focus { border-color: var(--k-primary); box-shadow: 0 0 0 3px rgba(27,165,255,.18); }
      .k31-input:disabled { opacity: .6; }
      .k31-textarea { resize: vertical; min-height: 72px; }
      .k31-hint { font-size: 12px; color: var(--k-mute); margin: 8px 0 0; }
      .k31-err { background: rgba(239,68,68,.12); color: var(--k-danger); border: 1px solid rgba(239,68,68,.3); padding: 10px 12px; border-radius: 10px; font-size: 13px; }

      .k31-field { margin-bottom: 16px; }
      .k31-field-inline { margin-top: 12px; }
      .k31-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }

      .k31-card { background: linear-gradient(180deg, var(--k-surface), #0F1119); border: 1px solid var(--k-border); border-radius: 18px; padding: 18px; margin-bottom: 14px; }
      .k31-sec-title { font-size: 11px; font-weight: 800; color: var(--k-dim); text-transform: uppercase; letter-spacing: .12em; margin: 0 0 12px; }

      /* AUTH */
      .k31-auth { min-height: 100vh; position: relative; display: flex; align-items: center; justify-content: center; padding: 20px; overflow: hidden; }
      .k31-auth-bg {
        position: absolute; inset: 0; z-index: 0;
        background:
          radial-gradient(circle at 15% 20%, rgba(27,165,255,.35), transparent 50%),
          radial-gradient(circle at 85% 80%, rgba(255,122,31,.25), transparent 50%),
          linear-gradient(180deg, #05060A 0%, #0A0D18 50%, #050709 100%);
      }
      .k31-auth-speed {
        position: absolute; inset: 0; z-index: 0; pointer-events: none;
        background:
          linear-gradient(105deg, transparent 30%, rgba(27,165,255,.08) 45%, transparent 55%),
          linear-gradient(285deg, transparent 30%, rgba(255,122,31,.06) 45%, transparent 55%);
        animation: streak 8s ease-in-out infinite alternate;
      }
      @keyframes streak { 0% { opacity: .4; transform: translateX(-3%); } 100% { opacity: 1; transform: translateX(3%); } }
      .k31-auth-card {
        position: relative; z-index: 1; width: 100%; max-width: 400px;
        background: rgba(10,13,20,.82); border: 1px solid rgba(27,165,255,.15);
        backdrop-filter: blur(24px); border-radius: 28px; padding: 32px 26px 26px;
        box-shadow: 0 20px 60px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.05);
      }
      .k31-auth-logo { display: flex; justify-content: center; margin-bottom: 8px; }
      .k31-auth-tagline { text-align: center; font-size: 11px; font-weight: 700; color: var(--k-dim); letter-spacing: .2em; text-transform: uppercase; margin-bottom: 24px; }
      .k31-auth-tabs { display: grid; grid-template-columns: 1fr 1fr; background: var(--k-surface2); border-radius: 12px; padding: 4px; margin-bottom: 18px; border: 1px solid var(--k-border); }
      .k31-auth-tab { background: transparent; color: var(--k-dim); border: 0; padding: 10px; border-radius: 9px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all .15s; }
      .k31-auth-tab.active { background: var(--k-surface); color: var(--k-text); box-shadow: 0 2px 8px rgba(0,0,0,.3); }
      .k31-auth-form { display: flex; flex-direction: column; gap: 10px; }
      .k31-auth-form .k31-btn-primary { margin-top: 6px; width: 100%; }
      .k31-auth-divider { display: flex; align-items: center; gap: 10px; margin: 18px 0; color: var(--k-mute); font-size: 11px; text-transform: uppercase; letter-spacing: .1em; }
      .k31-auth-divider::before, .k31-auth-divider::after { content: ""; flex: 1; height: 1px; background: var(--k-border); }
      .k31-auth-foot { text-align: center; color: var(--k-mute); font-size: 11px; margin-top: 20px; letter-spacing: .05em; }

      /* ONBOARDING */
      .k31-onboard {
        min-height: 100vh; display: flex; flex-direction: column;
        max-width: 520px; margin: 0 auto; padding: 20px 16px 24px;
        background:
          radial-gradient(ellipse at 50% 0%, rgba(27,165,255,.12), transparent 50%),
          linear-gradient(180deg, #05060A, #0A0D15);
      }
      .k31-onboard-head { margin-bottom: 24px; }
      .k31-onboard-logo { display: flex; justify-content: flex-start; margin-bottom: 20px; }
      .k31-progress-row { display: flex; gap: 6px; margin-bottom: 14px; }
      .k31-progress-dot { height: 4px; flex: 1; background: var(--k-border); border-radius: 2px; transition: background .3s; }
      .k31-progress-dot.active { background: linear-gradient(90deg, var(--k-primary-glow), var(--k-primary)); }
      .k31-step-label { font-size: 11px; color: var(--k-dim); font-weight: 700; text-transform: uppercase; letter-spacing: .1em; }
      .k31-step-title {
        font-size: 28px; font-weight: 800; margin: 4px 0 0; letter-spacing: -.02em;
        background: linear-gradient(180deg, var(--k-chrome-hi), var(--k-chrome-mid));
        -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
      }
      .k31-onboard-body { flex: 1; }
      .k31-onboard-foot { display: flex; gap: 10px; padding-top: 16px; }
      .k31-onboard-foot .k31-btn-primary { flex: 1; }
      .k31-onboard-foot .k31-btn-ghost { flex: 0 0 auto; }

      /* SERVICE GRID */
      .k31-service-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .k31-service-card {
        position: relative; background: var(--k-surface); color: var(--k-text);
        border: 1.5px solid var(--k-border); border-radius: 14px;
        padding: 14px 12px; cursor: pointer; text-align: left;
        display: flex; flex-direction: column; gap: 4px;
        min-height: 88px; transition: all .15s;
      }
      .k31-service-card:active { transform: scale(.98); }
      .k31-service-card.on {
        border-color: var(--k-primary);
        background: linear-gradient(135deg, rgba(27,165,255,.1), rgba(27,165,255,.02));
        box-shadow: 0 0 0 1px var(--k-primary), 0 4px 16px rgba(27,165,255,.2);
      }
      .k31-service-name { font-size: 13px; font-weight: 700; line-height: 1.2; }
      .k31-service-base { font-size: 11px; color: var(--k-dim); }
      .k31-service-check {
        position: absolute; top: 10px; right: 10px; width: 20px; height: 20px; border-radius: 50%;
        background: var(--k-primary); color: white;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 8px rgba(27,165,255,.4);
      }

      .k31-pricing-choices { display: flex; flex-direction: column; gap: 8px; }
      .k31-pricing-card { background: var(--k-surface); color: var(--k-text); border: 1.5px solid var(--k-border); border-radius: 14px; padding: 14px 16px; text-align: left; cursor: pointer; transition: all .15s; }
      .k31-pricing-card.on {
        border-color: var(--k-accent);
        background: linear-gradient(135deg, rgba(255,122,31,.1), rgba(255,122,31,.02));
        box-shadow: 0 0 0 1px var(--k-accent), 0 4px 16px rgba(255,122,31,.2);
      }
      .k31-pricing-label { font-size: 15px; font-weight: 800; }
      .k31-pricing-desc { font-size: 12px; color: var(--k-dim); margin-top: 2px; }

      /* DASHBOARD */
      .k31-fab-mini {
        width: 44px; height: 44px; border-radius: 50%;
        background: linear-gradient(135deg, var(--k-accent-glow), var(--k-accent) 50%, var(--k-accent-deep));
        border: 0; color: white; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 14px rgba(255,122,31,.45), inset 0 1px 0 rgba(255,255,255,.25);
        flex-shrink: 0;
      }
      .k31-fab-mini:active { transform: scale(.95); }

      .k31-week-card {
        background:
          radial-gradient(circle at 0% 0%, rgba(27,165,255,.15), transparent 50%),
          radial-gradient(circle at 100% 100%, rgba(255,122,31,.08), transparent 50%),
          linear-gradient(180deg, #141724, #0E1018);
        position: relative; overflow: hidden;
        border-color: rgba(27,165,255,.2);
      }
      .k31-week-card::before {
        content: ""; position: absolute; top: -60px; right: -60px; width: 180px; height: 180px;
        background: radial-gradient(circle, rgba(27,165,255,.25), transparent 70%); pointer-events: none;
      }
      .k31-week-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; position: relative; }
      .k31-week-label { font-size: 11px; font-weight: 700; color: var(--k-primary-glow); text-transform: uppercase; letter-spacing: .12em; }
      .k31-week-amount {
        font-size: 36px; font-weight: 800; margin-top: 6px; letter-spacing: -.02em;
        background: linear-gradient(180deg, var(--k-chrome-hi), var(--k-chrome-mid));
        -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
      }
      .k31-week-sub { font-size: 13px; color: var(--k-dim); margin-top: 2px; }
      .k31-week-bars { display: flex; gap: 6px; height: 64px; align-items: flex-end; margin-top: 4px; position: relative; }
      .k31-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
      .k31-bar-wrap { width: 100%; height: 48px; background: rgba(255,255,255,.04); border-radius: 4px; display: flex; align-items: flex-end; overflow: hidden; }
      .k31-bar-fill {
        width: 100%;
        background: linear-gradient(180deg, var(--k-primary-glow), var(--k-primary) 50%, var(--k-primary-deep));
        border-radius: 4px; min-height: 2px; transition: height .4s ease;
        box-shadow: 0 0 8px rgba(27,165,255,.3);
      }
      .k31-bar-label { font-size: 10px; color: var(--k-mute); font-weight: 700; letter-spacing: .05em; }

      .k31-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
      .k31-stat { background: var(--k-surface); border: 1px solid var(--k-border); border-radius: 14px; padding: 12px 10px; display: flex; flex-direction: column; gap: 4px; }
      .k31-stat-val { font-size: 18px; font-weight: 800; letter-spacing: -.01em; margin-top: 2px; }
      .k31-stat-label { font-size: 10px; color: var(--k-dim); text-transform: uppercase; font-weight: 700; letter-spacing: .08em; }

      .k31-quick { margin-bottom: 20px; }
      .k31-quick-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .k31-quick-tile {
        background: var(--k-surface); border: 1px solid var(--k-border); color: var(--k-text);
        border-radius: 14px; padding: 16px 12px; cursor: pointer;
        display: flex; align-items: center; gap: 10px;
        font-size: 13px; font-weight: 700; text-align: left; transition: all .15s;
      }
      .k31-quick-tile:active { transform: scale(.97); background: var(--k-surface2); border-color: var(--k-primary); }
      .k31-quick-tile svg { color: var(--k-primary); }
      .k31-recent-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }

      /* JOBS */
      .k31-filter-row { display: flex; gap: 6px; margin-bottom: 14px; overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 2px; }
      .k31-filter-row::-webkit-scrollbar { display: none; }
      .k31-chip {
        background: var(--k-surface); border: 1px solid var(--k-border);
        color: var(--k-dim); padding: 8px 14px; border-radius: 999px;
        font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
      }
      .k31-chip.on { background: linear-gradient(135deg, var(--k-primary-glow), var(--k-primary)); color: white; border-color: var(--k-primary); box-shadow: 0 2px 10px rgba(27,165,255,.35); }

      .k31-job-list { display: flex; flex-direction: column; gap: 8px; }
      .k31-job-row {
        width: 100%; background: var(--k-surface); border: 1px solid var(--k-border);
        border-radius: 14px; padding: 12px; cursor: pointer; text-align: left;
        display: flex; align-items: center; gap: 12px; transition: border-color .15s;
      }
      .k31-job-row:active { transform: scale(.99); }
      .k31-job-icon {
        width: 42px; height: 42px; border-radius: 11px; flex-shrink: 0;
        background: linear-gradient(135deg, rgba(27,165,255,.15), rgba(27,165,255,.05));
        color: var(--k-primary);
        display: flex; align-items: center; justify-content: center;
        border: 1px solid rgba(27,165,255,.2);
      }
      .k31-job-main { flex: 1; min-width: 0; }
      .k31-job-title-row { display: flex; align-items: center; gap: 6px; }
      .k31-job-svc { font-size: 14px; font-weight: 700; }
      .k31-tag-hd {
        font-size: 10px; font-weight: 800; letter-spacing: .05em;
        background: linear-gradient(135deg, rgba(255,122,31,.2), rgba(255,122,31,.08));
        color: var(--k-accent-glow); padding: 2px 6px; border-radius: 4px;
        border: 1px solid rgba(255,122,31,.3);
      }
      .k31-job-meta { font-size: 11px; color: var(--k-dim); margin-top: 2px; display: flex; align-items: center; gap: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .k31-job-meta.dim { color: var(--k-mute); }
      .k31-job-right { text-align: right; flex-shrink: 0; }
      .k31-job-price { font-size: 15px; font-weight: 800; }
      .k31-job-status { font-size: 10px; font-weight: 700; margin-top: 3px; display: inline-flex; align-items: center; gap: 3px; letter-spacing: .03em; }

      /* FORM */
      .k31-form-page { padding: 0 0 24px; }
      .k31-form-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px; position: sticky; top: 0;
        background: rgba(5,6,10,.92); backdrop-filter: blur(14px);
        z-index: 10; border-bottom: 1px solid var(--k-border);
      }
      .k31-form-title { font-size: 17px; font-weight: 800; margin: 0; letter-spacing: -.01em; }
      .k31-form-body { padding: 16px; }
      .k31-form-actions { display: flex; gap: 10px; margin-top: 16px; }
      .k31-form-actions .k31-btn-primary { flex: 1; }
      .k31-form-actions .k31-btn-ghost { flex: 1; justify-content: center; }

      .k31-service-picker { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
      .k31-svc-pick {
        background: var(--k-surface2); color: var(--k-text);
        border: 1.5px solid var(--k-border); border-radius: 10px;
        padding: 10px 12px; font-size: 13px; font-weight: 600;
        cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
      }
      .k31-svc-pick.on { border-color: var(--k-primary); background: linear-gradient(135deg, rgba(27,165,255,.15), rgba(27,165,255,.05)); color: var(--k-primary-glow); }

      .k31-toggle-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; margin-top: 8px; border-top: 1px solid var(--k-border); gap: 12px; }
      .k31-toggle-title { font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 6px; }
      .k31-toggle-desc { font-size: 11px; color: var(--k-dim); margin-top: 2px; }

      .k31-toggle {
        width: 44px; height: 26px; background: var(--k-surface2); border: 1px solid var(--k-border); border-radius: 999px;
        position: relative; cursor: pointer; transition: all .2s; flex-shrink: 0;
      }
      .k31-toggle-knob { position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; background: white; border-radius: 50%; transition: all .2s; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
      .k31-toggle.on { background: linear-gradient(135deg, var(--k-primary-glow), var(--k-primary)); border-color: var(--k-primary); }
      .k31-toggle.on .k31-toggle-knob { left: 20px; }

      .k31-price-breakdown { background: var(--k-surface2); border-radius: 12px; padding: 12px 14px; }
      .k31-price-line { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; font-size: 13px; color: var(--k-dim); gap: 10px; }
      .k31-price-line.dim { opacity: .6; }
      .k31-price-sug { border-top: 1px dashed var(--k-border); margin-top: 4px; padding-top: 10px; color: var(--k-text); font-weight: 700; display: flex; align-items: center; }
      .k31-price-sug span:first-child { display: inline-flex; align-items: center; gap: 4px; color: var(--k-primary-glow); }
      .k31-price-sug-val { color: var(--k-primary-glow); font-weight: 800; }
      .k31-price-final { border-top: 1px solid var(--k-border); padding-top: 10px; font-size: 16px; font-weight: 800; color: var(--k-text); }
      .k31-price-inline { background: var(--k-surface); border: 1px solid var(--k-border); color: var(--k-text); border-radius: 8px; padding: 4px 8px; font-size: 13px; width: 90px; text-align: right; outline: none; font-family: inherit; }

      .k31-final-row {
        display: flex; justify-content: space-between; align-items: center;
        background: linear-gradient(135deg, rgba(27,165,255,.18), rgba(255,122,31,.08));
        border: 1px solid var(--k-primary); border-radius: 12px; padding: 14px 16px; margin-top: 12px;
        box-shadow: 0 4px 20px rgba(27,165,255,.15);
      }
      .k31-final-label { font-size: 10px; text-transform: uppercase; color: var(--k-primary-glow); font-weight: 700; letter-spacing: .12em; }
      .k31-final-val { font-size: 26px; font-weight: 800; letter-spacing: -.02em; color: white; }
      .k31-profit-chip { margin-top: 10px; display: inline-flex; align-items: center; gap: 6px; background: rgba(34,197,94,.12); color: var(--k-success); border: 1px solid rgba(34,197,94,.3); padding: 6px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }

      .k31-source-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .k31-status-picker { display: flex; flex-direction: column; gap: 6px; }
      .k31-status-pick { background: var(--k-surface2); border: 1.5px solid var(--k-border); color: var(--k-dim); border-radius: 10px; padding: 10px 14px; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; }
      .k31-status-pick.on { background: var(--k-surface); }

      /* DETAIL + INVOICE */
      .k31-detail-hero { text-align: center; padding-top: 24px; padding-bottom: 24px; position: relative; }
      .k31-detail-icon {
        width: 64px; height: 64px; border-radius: 18px; margin: 0 auto 14px;
        background: linear-gradient(135deg, var(--k-primary-glow), var(--k-primary) 50%, var(--k-primary-deep));
        display: flex; align-items: center; justify-content: center; color: white;
        box-shadow: 0 8px 28px rgba(27,165,255,.4), inset 0 1px 0 rgba(255,255,255,.2);
      }
      .k31-detail-svc { font-size: 20px; font-weight: 800; margin: 0 0 6px; }
      .k31-detail-price {
        font-size: 40px; font-weight: 800; letter-spacing: -.02em; margin-top: 10px;
        background: linear-gradient(180deg, var(--k-chrome-hi), var(--k-chrome-mid));
        -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
      }
      .k31-detail-status { font-size: 13px; font-weight: 700; margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; }

      .k31-info-row { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--k-border); font-size: 14px; }
      .k31-info-row:last-child { border-bottom: 0; }
      .k31-info-label { color: var(--k-dim); width: 72px; flex-shrink: 0; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
      .k31-info-val { flex: 1; font-weight: 500; text-align: right; word-break: break-word; }
      .k31-notes-box { padding-top: 10px; font-size: 13px; color: var(--k-dim); line-height: 1.5; }

      .k31-modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.75); backdrop-filter: blur(10px); z-index: 100; display: flex; align-items: flex-end; justify-content: center; animation: fadeIn .2s; }
      .k31-modal { background: var(--k-bg); border-top: 1px solid var(--k-border); border-radius: 24px 24px 0 0; width: 100%; max-width: 520px; padding: 20px; max-height: 90vh; overflow-y: auto; animation: slideUp .25s ease; }
      @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .k31-modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
      .k31-modal-head h3 { margin: 0; font-size: 18px; font-weight: 800; }
      .k31-confirm { max-width: 380px; border-radius: 20px; border: 1px solid var(--k-border); }
      .k31-confirm-title { font-size: 18px; font-weight: 800; margin: 4px 0 8px; }
      .k31-confirm-msg { font-size: 14px; color: var(--k-dim); margin: 0 0 16px; }

      .k31-invoice { background: white; color: #1a1a1a; border-radius: 16px; padding: 22px; margin-bottom: 16px; font-family: 'Inter', sans-serif; }
      .k31-invoice-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
      .k31-invoice-logo { width: 68px; height: auto; flex-shrink: 0; filter: drop-shadow(0 2px 6px rgba(0,0,0,.15)); }
      .k31-invoice-biz { font-size: 16px; font-weight: 800; color: #0A0A0F; letter-spacing: -.01em; }
      .k31-invoice-sub { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: .08em; margin-top: 2px; }
      .k31-invoice-meta { display: flex; justify-content: space-between; gap: 14px; padding: 12px 0; border-top: 1px solid #eee; border-bottom: 1px solid #eee; font-size: 12px; }
      .k31-invoice-meta span { color: #888; display: block; text-transform: uppercase; font-size: 10px; letter-spacing: .05em; }
      .k31-invoice-meta b { font-size: 14px; color: #1a1a1a; font-weight: 700; }
      .k31-invoice-bill { padding: 12px 0; border-bottom: 1px solid #eee; font-size: 14px; }
      .k31-invoice-bill .k31-label { color: #888; }
      .k31-invoice-bill .dim { color: #999; font-size: 12px; }
      .k31-invoice-table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
      .k31-invoice-table th { text-align: left; padding: 10px 0; border-bottom: 2px solid #1a1a1a; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
      .k31-invoice-table td { padding: 14px 0; border-bottom: 1px solid #eee; }
      .k31-invoice-table td .dim { color: #999; }
      .k31-invoice-table td .small { font-size: 11px; }
      .k31-invoice-table tfoot td { padding-top: 16px; font-size: 16px; border: 0; }
      .k31-invoice-foot { margin-top: 18px; font-size: 12px; color: #666; text-align: center; line-height: 1.5; }

      /* SEARCH */
      .k31-search-wrap { position: relative; }
      .k31-search-input-wrap { position: relative; }
      .k31-search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--k-dim); pointer-events: none; }
      .k31-search-input { padding-left: 38px; }
      .k31-search-pop {
        position: absolute; top: calc(100% + 6px); left: 0; right: 0;
        background: var(--k-surface); border: 1px solid var(--k-border);
        border-radius: 12px; padding: 6px; max-height: 240px; overflow-y: auto;
        z-index: 20; box-shadow: 0 10px 40px rgba(0,0,0,.6);
      }
      .k31-search-item { width: 100%; background: transparent; border: 0; color: var(--k-text); padding: 10px 12px; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 8px; font-size: 14px; }
      .k31-search-item:hover { background: var(--k-surface2); }
      .k31-saved-count { margin-left: auto; font-size: 11px; color: var(--k-primary); font-weight: 700; }

      .k31-empty { text-align: center; padding: 40px 20px; background: var(--k-surface); border: 1px dashed var(--k-border); border-radius: 18px; }
      .k31-empty-icon { width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 16px; background: var(--k-surface2); display: flex; align-items: center; justify-content: center; color: var(--k-dim); }
      .k31-empty-title { font-size: 16px; font-weight: 800; }
      .k31-empty-desc { font-size: 13px; color: var(--k-dim); margin: 4px 0 16px; }

      .k31-logout { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; background: transparent; color: var(--k-danger); border: 1px solid rgba(239,68,68,.3); border-radius: 14px; padding: 14px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 4px; }
      .k31-version { text-align: center; color: var(--k-mute); font-size: 10px; margin-top: 14px; letter-spacing: .05em; text-transform: uppercase; }

      .k31-bottomnav {
        position: fixed; bottom: 0; left: 0; right: 0;
        max-width: 520px; margin: 0 auto;
        background: rgba(5,6,10,.92); backdrop-filter: blur(16px);
        border-top: 1px solid var(--k-border);
        display: grid; grid-template-columns: 1fr 1fr 64px 1fr 1fr;
        align-items: center; padding: 8px 10px;
        padding-bottom: calc(8px + env(safe-area-inset-bottom, 0));
        z-index: 50;
      }
      .k31-nav-btn { background: transparent; border: 0; color: var(--k-mute); padding: 8px 0; cursor: pointer; font-size: 10px; font-weight: 700; display: flex; flex-direction: column; align-items: center; gap: 3px; letter-spacing: .08em; text-transform: uppercase; }
      .k31-nav-btn.on { color: var(--k-primary); }
      .k31-nav-btn.ghost { visibility: hidden; }
      .k31-fab {
        width: 58px; height: 58px; border-radius: 50%;
        background: radial-gradient(circle at 30% 30%, var(--k-accent-glow), var(--k-accent) 55%, var(--k-accent-deep));
        color: white; border: 0; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 8px 24px rgba(255,122,31,.5), inset 0 1px 0 rgba(255,255,255,.3);
        transform: translateY(-8px);
      }
      .k31-fab:active { transform: translateY(-8px) scale(.94); }
      .dim { color: var(--k-dim); }
    `}</style>
  );
}
