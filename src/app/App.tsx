import { useState, useMemo, useRef, useEffect } from "react";
import {
  Save, ChevronDown, AlertTriangle, TrendingUp, Package,
  Truck, Wheat, IndianRupee, BarChart3, RefreshCw, Zap,
  CheckCircle2, ArrowRight, Activity,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  if (!isFinite(n) || isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function fmtINR(n: number): string {
  if (!isFinite(n) || isNaN(n) || n === 0) return "—";
  if (n >= 1e7) return `₹${fmt(n / 1e7, 2)} Cr`;
  if (n >= 1e5) return `₹${fmt(n / 1e5, 2)} L`;
  return `₹${fmt(n, 0)}`;
}

// animated number that ticks up/down
function AnimatedNumber({ value, prefix = "", suffix = "", decimals = 2 }: {
  value: number; prefix?: string; suffix?: string; decimals?: number;
}) {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number>(0);
  const startRef = useRef({ from: value, to: value, t: 0 });

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const from = display;
    const to = value;
    const duration = 280;
    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const p = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line
  }, [value]);

  startRef.current = { from: display, to: value, t: 0 };

  const formatted = isFinite(display) ? fmt(display, decimals) : "—";
  return <span>{prefix}{formatted}{suffix}</span>;
}

// ── types ─────────────────────────────────────────────────────────────────────

interface Inputs {
  volume: string; volumeUnit: "MT" | "kg" | "Quintal";
  procPrice: string; procUnit: "INR/kg" | "INR/MT";
  freight: string; freightMode: "FOR" | "Ex-Factory"; freightRate: "Per Ton" | "Per kg" | "Flat Rate";
  packagingEnabled: boolean; packagingRate: string; packagingBasis: "Per Quintal" | "Per 50kg bag";
  targetMargin: string;
  buyerCap: string;
}

interface CalcResult {
  volumeMT: number; volumeKg: number;
  procPerKg: number; freightPerKg: number; packPerKg: number;
  subtotalPerKg: number; marginPerKg: number; sellingPerKg: number;
  totalProcurement: number; totalFreight: number; totalPackaging: number;
  totalSubtotal: number; totalMargin: number; grandTotal: number;
  exceedsCap: boolean;
}

function calculate(inp: Inputs): CalcResult {
  const vol = parseFloat(inp.volume) || 0;
  const volumeKg = inp.volumeUnit === "MT" ? vol * 1000 : inp.volumeUnit === "Quintal" ? vol * 100 : vol;
  const volumeMT = volumeKg / 1000;
  const rawProc = parseFloat(inp.procPrice) || 0;
  const procPerKg = inp.procUnit === "INR/MT" ? rawProc / 1000 : rawProc;
  const rawFreight = parseFloat(inp.freight) || 0;
  let freightPerKg = 0;
  if (inp.freightRate === "Per Ton") freightPerKg = rawFreight / 1000;
  else if (inp.freightRate === "Per kg") freightPerKg = rawFreight;
  else freightPerKg = volumeKg > 0 ? rawFreight / volumeKg : 0;
  const rawPack = parseFloat(inp.packagingRate) || 0;
  const packPerKg = inp.packagingEnabled ? (inp.packagingBasis === "Per Quintal" ? rawPack / 100 : rawPack / 50) : 0;
  const subtotalPerKg = procPerKg + freightPerKg + packPerKg;
  const marginPerKg = parseFloat(inp.targetMargin) || 0;
  const sellingPerKg = subtotalPerKg + marginPerKg;
  const totalProcurement = procPerKg * volumeKg;
  const totalFreight = freightPerKg * volumeKg;
  const totalPackaging = packPerKg * volumeKg;
  const totalSubtotal = subtotalPerKg * volumeKg;
  const totalMargin = marginPerKg * volumeKg;
  const grandTotal = sellingPerKg * volumeKg;
  const cap = parseFloat(inp.buyerCap) || 0;
  const exceedsCap = cap > 0 && sellingPerKg > cap;
  return {
    volumeMT, volumeKg, procPerKg, freightPerKg, packPerKg,
    subtotalPerKg, marginPerKg, sellingPerKg,
    totalProcurement, totalFreight, totalPackaging,
    totalSubtotal, totalMargin, grandTotal, exceedsCap,
  };
}

// ── micro components ──────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400 block mb-1.5 select-none">
      {children}
    </span>
  );
}

function StyledSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <div className="relative flex-shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 text-[12px] font-semibold rounded-md px-3 py-[9px] pr-7 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 focus:border-emerald-400 transition-all cursor-pointer"
        style={{ fontFamily: "JetBrains Mono, monospace" }}
      >
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
    </div>
  );
}

function NumInput({ value, onChange, placeholder = "0.00", alert = false }: {
  value: string; onChange: (v: string) => void; placeholder?: string; alert?: boolean;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full text-[15px] font-semibold rounded-md px-3 py-[9px] focus:outline-none focus:ring-2 transition-all placeholder:text-slate-300 placeholder:font-normal
        ${alert
          ? "bg-red-50 border border-red-300 ring-1 ring-red-200 text-red-700 focus:ring-red-300"
          : "bg-white border border-slate-200 focus:ring-emerald-400/50 focus:border-emerald-400 text-slate-800 hover:border-slate-300"
        }`}
      style={{ fontFamily: "JetBrains Mono, monospace" }}
    />
  );
}

function InputSection({ icon, title, badge, children }: {
  icon: React.ReactNode; title: string; badge?: string; children: React.ReactNode;
}) {
  return (
    <div className="group relative bg-white rounded-xl border border-slate-200/80 overflow-hidden shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200">
      <div className="px-4 pt-3.5 pb-1 flex items-center gap-2.5 border-b border-slate-100">
        <div className="w-6 h-6 rounded-md bg-slate-900 flex items-center justify-center text-white">
          {icon}
        </div>
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{title}</span>
        {badge && (
          <span className="ml-auto text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-full px-2 py-0.5 uppercase tracking-wide">
            {badge}
          </span>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function KPITile({ label, value, sub, variant = "default" }: {
  label: string; value: React.ReactNode; sub?: string;
  variant?: "default" | "green" | "red" | "dark";
}) {
  const styles = {
    default: "bg-white border-slate-200 text-slate-900",
    green:   "bg-emerald-500 border-emerald-400 text-white",
    red:     "bg-red-500 border-red-400 text-white",
    dark:    "bg-[#0F172A] border-slate-700 text-white",
  };
  const labelStyles = {
    default: "text-slate-400",
    green:   "text-emerald-100",
    red:     "text-red-100",
    dark:    "text-slate-400",
  };
  const subStyles = {
    default: "text-slate-400",
    green:   "text-emerald-100/80",
    red:     "text-red-100/80",
    dark:    "text-slate-500",
  };

  return (
    <div className={`rounded-xl border px-4 py-3.5 shadow-sm flex flex-col gap-1 ${styles[variant]}`}>
      <span className={`text-[10.5px] font-bold uppercase tracking-[0.1em] ${labelStyles[variant]}`}>{label}</span>
      <div className={`font-mono text-[22px] font-bold leading-tight tracking-tight`}>{value}</div>
      {sub && <span className={`text-[11px] font-mono ${subStyles[variant]}`}>{sub}</span>}
    </div>
  );
}

// ── defaults ──────────────────────────────────────────────────────────────────

const EMPTY: Inputs = {
  volume: "", volumeUnit: "MT",
  procPrice: "", procUnit: "INR/kg",
  freight: "", freightMode: "FOR", freightRate: "Per Ton",
  packagingEnabled: false, packagingRate: "", packagingBasis: "Per Quintal",
  targetMargin: "", buyerCap: "",
};

const DEMO: Inputs = {
  volume: "100", volumeUnit: "MT",
  procPrice: "18.80", procUnit: "INR/kg",
  freight: "1800", freightMode: "FOR", freightRate: "Per Ton",
  packagingEnabled: true, packagingRate: "120", packagingBasis: "Per Quintal",
  targetMargin: "1.40", buyerCap: "22",
};

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [inp, setInp] = useState<Inputs>(EMPTY);
  const [saveState, setSaveState] = useState<"idle" | "saved">("idle");

  function set<K extends keyof Inputs>(k: K, v: Inputs[K]) {
    setInp((p) => ({ ...p, [k]: v }));
  }

  const result = useMemo(() => calculate(inp), [inp]);
  const demoResult = useMemo(() => calculate(DEMO), []);
  const hasData = parseFloat(inp.volume) > 0 && parseFloat(inp.procPrice) > 0;
  const marginPct = result.subtotalPerKg > 0 ? (result.marginPerKg / result.subtotalPerKg) * 100 : 0;

  function handleSave() {
    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 2000);
  }

  // cost breakdown bar widths
  const totalCost = result.subtotalPerKg || 1;
  const procW = Math.round((result.procPerKg / totalCost) * 100);
  const frW   = Math.round((result.freightPerKg / totalCost) * 100);
  const pkW   = Math.round((result.packPerKg / totalCost) * 100);

  return (
    <div className="min-h-screen bg-[#F1F5F9]" style={{ fontFamily: "Inter, sans-serif" }}>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header className="bg-[#0F172A] sticky top-0 z-50 shadow-lg shadow-slate-900/20">
        <div className="max-w-[1400px] mx-auto px-5 h-[52px] flex items-center gap-4">

          {/* Logo */}
          <div className="flex items-center gap-2.5 mr-2">
            <div className="w-7 h-7 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-lg flex items-center justify-center shadow-md shadow-emerald-900/50">
              <Activity className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <span className="text-white font-bold text-[14px] tracking-tight">Blueblood</span>
              <span className="text-emerald-400 font-bold text-[14px] tracking-tight">exports</span>
            </div>
          </div>

          <div className="w-px h-5 bg-slate-700" />

          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-300 text-[12.5px] font-medium">B2B Trade Margin Engine</span>
          </div>

          {/* live dot */}
          {hasData && (
            <div className="flex items-center gap-1.5 ml-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
              </span>
              <span className="text-[11px] text-emerald-400 font-semibold uppercase tracking-wider">Live</span>
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setInp(DEMO)}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 transition-all"
            >
              <RefreshCw className="w-3 h-3" />
              Demo
            </button>
            <button
              onClick={() => setInp(EMPTY)}
              className="text-[12px] font-medium text-slate-500 hover:text-slate-300 px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-all"
            >
              Clear
            </button>
            <motion.button
              onClick={handleSave}
              whileTap={{ scale: 0.95 }}
              className={`flex items-center gap-1.5 text-[12px] font-bold px-4 py-1.5 rounded-lg transition-all shadow-md
                ${saveState === "saved"
                  ? "bg-emerald-400 text-white shadow-emerald-900/30"
                  : "bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-900/30"
                }`}
            >
              {saveState === "saved"
                ? <><CheckCircle2 className="w-3.5 h-3.5" /> Saved!</>
                : <><Save className="w-3.5 h-3.5" /> Save Deal</>
              }
            </motion.button>
          </div>
        </div>
      </header>

      {/* ── ALERT BANNER ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {result.exceedsCap && hasData && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="bg-red-600 px-5 py-2.5 flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-100 flex-shrink-0" />
              <span className="text-[12.5px] font-bold text-white">
                BUYER CAP BREACH — Selling ₹{fmt(result.sellingPerKg)}/kg vs cap ₹{inp.buyerCap}/kg
                &nbsp;·&nbsp; Over by ₹{fmt(result.sellingPerKg - parseFloat(inp.buyerCap), 2)}/kg
              </span>
              <span className="ml-auto text-[11px] text-red-200 font-semibold">Reduce margin or renegotiate procurement</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── BODY ────────────────────────────────────────────────────────── */}
      <main className="max-w-[1400px] mx-auto px-5 py-5">
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5 items-start">

          {/* ════════════════════════════════════════════════════════════
              LEFT — INPUTS
          ════════════════════════════════════════════════════════════ */}
          <aside className="flex flex-col gap-3">

            {/* Section heading */}
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Deal Parameters</span>
              <span className="text-[10.5px] text-slate-400 font-mono">All amounts in INR</span>
            </div>

            {/* ── 1. Volume ── */}
            <InputSection icon={<Wheat className="w-3.5 h-3.5" />} title="Deal Volume">
              <FieldLabel>Quantity</FieldLabel>
              <div className="flex gap-2">
                <NumInput value={inp.volume} onChange={(v) => set("volume", v)} placeholder="100" />
                <StyledSelect value={inp.volumeUnit} onChange={(v) => set("volumeUnit", v as Inputs["volumeUnit"])} options={["MT", "kg", "Quintal"]} />
              </div>
              <AnimatePresence>
                {inp.volume && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    className="text-[11px] text-emerald-500 mt-2 font-mono font-medium"
                  >
                    = {fmt(result.volumeKg, 0)} kg &nbsp;·&nbsp; {fmt(result.volumeMT, 3)} MT
                  </motion.p>
                )}
              </AnimatePresence>
            </InputSection>

            {/* ── 2. Procurement ── */}
            <InputSection icon={<IndianRupee className="w-3.5 h-3.5" />} title="Base Procurement Price">
              <FieldLabel>Rate</FieldLabel>
              <div className="flex gap-2">
                <NumInput value={inp.procPrice} onChange={(v) => set("procPrice", v)} placeholder="18.80"
                  alert={result.exceedsCap && hasData} />
                <StyledSelect value={inp.procUnit} onChange={(v) => set("procUnit", v as Inputs["procUnit"])} options={["INR/kg", "INR/MT"]} />
              </div>
              <AnimatePresence>
                {inp.procPrice && (
                  <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="text-[11px] text-slate-400 mt-2 font-mono">
                    ₹{fmt(result.procPerKg, 4)}/kg · Total: <span className="text-slate-600 font-semibold">{fmtINR(result.totalProcurement)}</span>
                  </motion.p>
                )}
              </AnimatePresence>
            </InputSection>

            {/* ── 3. Freight ── */}
            <InputSection icon={<Truck className="w-3.5 h-3.5" />} title="Freight / Logistics">
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <FieldLabel>Delivery Mode</FieldLabel>
                  <div className="flex rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
                    {(["FOR", "Ex-Factory"] as const).map((m) => (
                      <button key={m} onClick={() => set("freightMode", m)}
                        className={`flex-1 text-[11.5px] font-bold py-[8px] transition-all ${inp.freightMode === m ? "bg-[#0F172A] text-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <FieldLabel>Rate Basis</FieldLabel>
                  <StyledSelect value={inp.freightRate} onChange={(v) => set("freightRate", v as Inputs["freightRate"])} options={["Per Ton", "Per kg", "Flat Rate"]} />
                </div>
              </div>
              <FieldLabel>Amount</FieldLabel>
              <NumInput value={inp.freight} onChange={(v) => set("freight", v)} placeholder="1800" />
              <AnimatePresence>
                {inp.freight && (
                  <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="text-[11px] text-slate-400 mt-2 font-mono">
                    ₹{fmt(result.freightPerKg, 4)}/kg · <span className="text-slate-600 font-semibold">{fmtINR(result.totalFreight)}</span>
                  </motion.p>
                )}
              </AnimatePresence>
            </InputSection>

            {/* ── 4. Packaging ── */}
            <InputSection icon={<Package className="w-3.5 h-3.5" />} title="Packaging Charges"
              badge={inp.packagingEnabled ? "Active" : undefined}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[12.5px] text-slate-600 font-medium">Include packaging cost</span>
                <button onClick={() => set("packagingEnabled", !inp.packagingEnabled)}
                  className="relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none flex-shrink-0"
                  style={{ background: inp.packagingEnabled ? "#10B981" : "#CBD5E1" }}>
                  <motion.span animate={{ x: inp.packagingEnabled ? 22 : 2 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-md block" />
                </button>
              </div>
              <AnimatePresence>
                {inp.packagingEnabled && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                    className="overflow-hidden border-t border-slate-100 pt-3 flex flex-col gap-2">
                    <FieldLabel>Rate Basis</FieldLabel>
                    <StyledSelect value={inp.packagingBasis} onChange={(v) => set("packagingBasis", v as Inputs["packagingBasis"])} options={["Per Quintal", "Per 50kg bag"]} />
                    <FieldLabel>Rate (INR)</FieldLabel>
                    <NumInput value={inp.packagingRate} onChange={(v) => set("packagingRate", v)} placeholder="120" />
                    {inp.packagingRate && (
                      <p className="text-[11px] text-slate-400 font-mono">
                        ₹{fmt(result.packPerKg, 4)}/kg · <span className="text-slate-600 font-semibold">{fmtINR(result.totalPackaging)}</span>
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              {!inp.packagingEnabled && (
                <p className="text-[11px] text-slate-300 font-mono">₹0.0000/kg · excluded from ledger</p>
              )}
            </InputSection>

            {/* ── 5. Target Margin ── */}
            <InputSection icon={<TrendingUp className="w-3.5 h-3.5" />} title="Target Profit Margin">
              <FieldLabel>Fixed Margin (INR/kg)</FieldLabel>
              <NumInput value={inp.targetMargin} onChange={(v) => set("targetMargin", v)} placeholder="1.40" />
              <AnimatePresence>
                {inp.targetMargin && result.subtotalPerKg > 0 && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="mt-2.5 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <motion.div animate={{ width: `${Math.min(marginPct, 100)}%` }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                        className={`h-full rounded-full ${marginPct > 15 ? "bg-emerald-400" : marginPct > 7 ? "bg-emerald-500" : "bg-amber-400"}`} />
                    </div>
                    <span className="text-[11px] font-bold text-emerald-500 font-mono">{fmt(marginPct, 1)}%</span>
                  </motion.div>
                )}
              </AnimatePresence>
              {inp.targetMargin && hasData && (
                <p className="text-[11px] text-emerald-500 mt-1.5 font-mono font-semibold">
                  Net profit: {fmtINR(result.totalMargin)}
                </p>
              )}
            </InputSection>

            {/* ── 6. Buyer Cap ── */}
            <div className={`rounded-xl border-2 border-dashed overflow-hidden transition-all duration-300
              ${result.exceedsCap && hasData ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}>
              <div className="px-4 pt-3.5 pb-1 flex items-center gap-2 border-b border-dashed border-slate-200">
                <AlertTriangle className={`w-3.5 h-3.5 ${result.exceedsCap && hasData ? "text-red-500" : "text-slate-300"}`} />
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Buyer Cap / Alert</span>
              </div>
              <div className="p-4">
                <FieldLabel>Max Selling Price (INR/kg)</FieldLabel>
                <NumInput value={inp.buyerCap} onChange={(v) => set("buyerCap", v)} placeholder="22.00" alert={result.exceedsCap && hasData} />
                <p className={`text-[11px] mt-1.5 ${result.exceedsCap && hasData ? "text-red-400 font-semibold" : "text-slate-400"}`}>
                  {result.exceedsCap && hasData
                    ? `₹${fmt(result.sellingPerKg - parseFloat(inp.buyerCap), 2)}/kg over cap — deal at risk`
                    : "Triggers red alert if selling price exceeds this."}
                </p>
              </div>
            </div>
          </aside>

          {/* ════════════════════════════════════════════════════════════
              RIGHT — RESULTS
          ════════════════════════════════════════════════════════════ */}
          <div className="flex flex-col gap-5">

            {/* ── KPI TILES ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KPITile
                label="Cost / kg"
                value={<AnimatedNumber value={result.subtotalPerKg} prefix="₹" />}
                sub={hasData ? fmtINR(result.totalSubtotal) : "enter data"}
                variant="default"
              />
              <KPITile
                label="Net Margin"
                value={<AnimatedNumber value={result.marginPerKg} prefix="₹" />}
                sub={`${fmt(marginPct, 1)}% on cost`}
                variant="green"
              />
              <KPITile
                label="Sell Price / kg"
                value={<AnimatedNumber value={result.sellingPerKg} prefix="₹" />}
                sub={inp.buyerCap ? `Cap: ₹${inp.buyerCap}/kg` : undefined}
                variant={result.exceedsCap && hasData ? "red" : "default"}
              />
              <KPITile
                label="Grand Total"
                value={hasData ? fmtINR(result.grandTotal) : "—"}
                sub={`${fmt(result.volumeMT, 1)} MT`}
                variant={result.exceedsCap && hasData ? "red" : "dark"}
              />
            </div>

            {/* ── COST BREAKDOWN BAR ── */}
            {hasData && result.subtotalPerKg > 0 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-xl border border-slate-200 px-4 py-3.5 shadow-sm">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Cost Stack Breakdown</span>
                  <span className="text-[11px] font-mono text-slate-500">₹{fmt(result.subtotalPerKg, 4)}/kg total cost</span>
                </div>
                <div className="flex h-5 rounded-lg overflow-hidden gap-px">
                  <motion.div animate={{ width: `${procW}%` }} transition={{ duration: 0.4, ease: "easeOut" }}
                    className="bg-slate-700 h-full" title={`Procurement ${procW}%`} />
                  <motion.div animate={{ width: `${frW}%` }} transition={{ duration: 0.4, ease: "easeOut" }}
                    className="bg-slate-400 h-full" title={`Freight ${frW}%`} />
                  {inp.packagingEnabled && (
                    <motion.div animate={{ width: `${pkW}%` }} transition={{ duration: 0.4, ease: "easeOut" }}
                      className="bg-slate-300 h-full" title={`Packaging ${pkW}%`} />
                  )}
                  {result.marginPerKg > 0 && (
                    <motion.div
                      animate={{ width: `${Math.round((result.marginPerKg / (result.subtotalPerKg + result.marginPerKg)) * 100)}%` }}
                      transition={{ duration: 0.4, ease: "easeOut" }}
                      className="bg-emerald-400 h-full" title="Margin" />
                  )}
                </div>
                <div className="flex gap-4 mt-2">
                  {[
                    { color: "bg-slate-700", label: "Procurement", pct: procW },
                    { color: "bg-slate-400", label: "Freight", pct: frW },
                    inp.packagingEnabled ? { color: "bg-slate-300", label: "Packaging", pct: pkW } : null,
                    result.marginPerKg > 0 ? { color: "bg-emerald-400", label: "Margin", pct: Math.round((result.marginPerKg / (result.subtotalPerKg + result.marginPerKg)) * 100) } : null,
                  ].filter(Boolean).map((item) => (
                    <div key={item!.label} className="flex items-center gap-1.5">
                      <span className={`w-2.5 h-2.5 rounded-sm ${item!.color}`} />
                      <span className="text-[11px] text-slate-500">{item!.label} <span className="font-mono font-semibold text-slate-700">{item!.pct}%</span></span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── COMPARISON ENGINE ── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Live Comparison Engine</span>
                <ArrowRight className="w-3 h-3 text-slate-300" />
                <span className="text-[11px] text-slate-400">Before vs After negotiation</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                {/* Baseline */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Demo Baseline</span>
                    <span className="text-[10.5px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">100 MT · ₹18.80</span>
                  </div>
                  <div className="p-4 space-y-2.5">
                    {[
                      { l: "Procurement", v: `₹${fmt(demoResult.procPerKg)}`, style: "normal" },
                      { l: "Freight (FOR)", v: `₹${fmt(demoResult.freightPerKg)}`, style: "normal" },
                      { l: "Packaging", v: `₹${fmt(demoResult.packPerKg)}`, style: "normal" },
                    ].map(({ l, v }) => (
                      <div key={l} className="flex justify-between items-center">
                        <span className="text-[12.5px] text-slate-500">{l}</span>
                        <span className="font-mono text-[13px] font-semibold text-slate-600">{v}/kg</span>
                      </div>
                    ))}
                    <div className="my-1.5 border-t border-slate-100" />
                    <div className="flex justify-between items-center">
                      <span className="text-[12.5px] font-bold text-slate-700">Cost Stack</span>
                      <span className="font-mono text-[13px] font-bold text-slate-800">₹{fmt(demoResult.subtotalPerKg)}/kg</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[12.5px] text-emerald-600 font-semibold">Net Margin</span>
                      <span className="font-mono text-[13px] font-bold text-emerald-500">₹{fmt(demoResult.marginPerKg)}/kg</span>
                    </div>
                    <div className="mt-2 pt-2 border-t-2 border-slate-800 flex justify-between items-center">
                      <span className="text-[13px] font-bold text-slate-800">Selling Price</span>
                      <span className="font-mono text-[17px] font-bold text-slate-900">₹{fmt(demoResult.sellingPerKg)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-slate-400">Grand Total</span>
                      <span className="font-mono text-[12px] font-bold text-slate-500">{fmtINR(demoResult.grandTotal)}</span>
                    </div>
                  </div>
                </div>

                {/* Live */}
                <motion.div
                  animate={{
                    borderColor: result.exceedsCap && hasData ? "#FCA5A5" : hasData ? "#6EE7B7" : "#E2E8F0",
                    boxShadow: result.exceedsCap && hasData
                      ? "0 4px 24px -4px rgba(239,68,68,0.15)"
                      : hasData
                      ? "0 4px 24px -4px rgba(16,185,129,0.12)"
                      : "0 1px 3px rgba(0,0,0,0.05)",
                  }}
                  className="rounded-xl border-2 overflow-hidden bg-white"
                >
                  <div className={`px-4 py-3 border-b flex items-center justify-between
                    ${result.exceedsCap && hasData ? "bg-red-50 border-red-100" : hasData ? "bg-emerald-50 border-emerald-100" : "bg-slate-50 border-slate-100"}`}>
                    <span className={`text-[11px] font-bold uppercase tracking-wider
                      ${result.exceedsCap && hasData ? "text-red-500" : hasData ? "text-emerald-600" : "text-slate-400"}`}>
                      {hasData ? "Your Deal" : "Awaiting Input"}
                    </span>
                    {result.exceedsCap && hasData && (
                      <span className="text-[10.5px] font-bold text-red-500 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Over Cap
                      </span>
                    )}
                    {!result.exceedsCap && hasData && (
                      <span className="text-[10.5px] font-mono text-emerald-500 bg-emerald-100 px-2 py-0.5 rounded-full font-semibold">
                        ✓ Within cap
                      </span>
                    )}
                  </div>
                  <div className={`p-4 space-y-2.5 ${!hasData ? "opacity-40" : ""}`}>
                    {[
                      { l: "Procurement", v: `₹${fmt(result.procPerKg)}` },
                      { l: `Freight (${inp.freightMode})`, v: `₹${fmt(result.freightPerKg)}` },
                      { l: inp.packagingEnabled ? "Packaging" : "Packaging (off)", v: inp.packagingEnabled ? `₹${fmt(result.packPerKg)}` : "₹0.00", muted: !inp.packagingEnabled },
                    ].map(({ l, v, muted }) => (
                      <div key={l} className="flex justify-between items-center">
                        <span className={`text-[12.5px] ${muted ? "text-slate-300" : "text-slate-500"}`}>{l}</span>
                        <span className={`font-mono text-[13px] font-semibold ${muted ? "text-slate-300" : "text-slate-600"}`}>{v}/kg</span>
                      </div>
                    ))}
                    <div className="my-1.5 border-t border-slate-100" />
                    <div className="flex justify-between items-center">
                      <span className="text-[12.5px] font-bold text-slate-700">Cost Stack</span>
                      <span className="font-mono text-[13px] font-bold text-slate-800">₹{fmt(result.subtotalPerKg)}/kg</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={`text-[12.5px] font-semibold ${result.exceedsCap && hasData ? "text-red-500" : "text-emerald-600"}`}>Net Margin</span>
                      <span className={`font-mono text-[13px] font-bold ${result.exceedsCap && hasData ? "text-red-500" : "text-emerald-500"}`}>₹{fmt(result.marginPerKg)}/kg</span>
                    </div>
                    <div className={`mt-2 pt-2 border-t-2 flex justify-between items-center ${result.exceedsCap && hasData ? "border-red-400" : "border-slate-800"}`}>
                      <span className="text-[13px] font-bold text-slate-800">Selling Price</span>
                      <span className={`font-mono text-[17px] font-bold ${result.exceedsCap && hasData ? "text-red-600" : "text-slate-900"}`}>
                        <AnimatedNumber value={result.sellingPerKg} prefix="₹" />
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-slate-400">Grand Total</span>
                      <span className={`font-mono text-[12px] font-bold ${result.exceedsCap && hasData ? "text-red-500" : "text-emerald-600"}`}>
                        {fmtINR(result.grandTotal)}
                      </span>
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>

            {/* ── MASTER INVOICE LEDGER ── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Master Invoice Ledger</span>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                <table className="w-full text-[13px] border-collapse">
                  <thead>
                    <tr className="bg-[#0F172A]">
                      {["Component Item", "Unit Basis", "Rate / kg", "Total (INR)"].map((h, i) => (
                        <th key={h} className={`py-3 px-4 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400 ${i === 0 ? "text-left w-[38%]" : i === 1 ? "text-left w-[18%]" : "text-right"}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>

                    {/* Procurement */}
                    <tr className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-700">
                        <div className="flex items-center gap-2"><Wheat className="w-3.5 h-3.5 text-slate-300" /> Rice Procurement</div>
                      </td>
                      <td className="px-4 py-3 text-slate-400 font-mono text-[12px]">{inp.procUnit}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-700">₹{fmt(result.procPerKg, 4)}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">{hasData ? fmtINR(result.totalProcurement) : "—"}</td>
                    </tr>

                    {/* Freight */}
                    <tr className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-700">
                        <div className="flex items-center gap-2"><Truck className="w-3.5 h-3.5 text-slate-300" /> Freight / Logistics <span className="text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5 font-bold ml-1">{inp.freightMode}</span></div>
                      </td>
                      <td className="px-4 py-3 text-slate-400 font-mono text-[12px]">{inp.freightRate}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-700">₹{fmt(result.freightPerKg, 4)}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">{hasData ? fmtINR(result.totalFreight) : "—"}</td>
                    </tr>

                    {/* Packaging */}
                    <tr className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                      <td className={`px-4 py-3 font-medium ${inp.packagingEnabled ? "text-slate-700" : "text-slate-300"}`}>
                        <div className="flex items-center gap-2">
                          <Package className="w-3.5 h-3.5 text-slate-300" /> Packaging
                          {!inp.packagingEnabled && <span className="text-[10px] bg-slate-100 text-slate-400 rounded px-1.5 py-0.5 font-bold">OFF</span>}
                        </div>
                      </td>
                      <td className={`px-4 py-3 font-mono text-[12px] ${inp.packagingEnabled ? "text-slate-400" : "text-slate-200"}`}>
                        {inp.packagingEnabled ? inp.packagingBasis : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${inp.packagingEnabled ? "text-slate-700" : "text-slate-200"}`}>
                        {inp.packagingEnabled ? `₹${fmt(result.packPerKg, 4)}` : "₹0.0000"}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${inp.packagingEnabled ? "text-slate-800" : "text-slate-200"}`}>
                        {inp.packagingEnabled && hasData ? fmtINR(result.totalPackaging) : "₹0"}
                      </td>
                    </tr>

                    {/* Subtotal */}
                    <tr className="bg-slate-50 border-y border-slate-200">
                      <td colSpan={2} className="px-4 py-3 font-bold text-[13.5px] text-slate-700">Subtotal — Cost Before Profit</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">₹{fmt(result.subtotalPerKg, 4)}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">{hasData ? fmtINR(result.totalSubtotal) : "—"}</td>
                    </tr>

                    {/* Margin */}
                    <tr className="bg-emerald-50/60 border-b border-emerald-100 hover:bg-emerald-50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-emerald-700">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                          Net Profit Margin
                          {result.subtotalPerKg > 0 && (
                            <span className="text-[10px] bg-emerald-100 text-emerald-600 border border-emerald-200 rounded-full px-2 py-0.5 font-bold ml-1">{fmt(marginPct, 1)}%</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-emerald-500">INR/kg</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">₹{fmt(result.marginPerKg, 4)}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">{hasData ? fmtINR(result.totalMargin) : "—"}</td>
                    </tr>

                    {/* Grand Total */}
                    <tr className={result.exceedsCap && hasData ? "bg-red-600" : "bg-[#0F172A]"}>
                      <td colSpan={2} className="px-4 py-4">
                        <span className={`text-[14px] font-black uppercase tracking-wider ${result.exceedsCap && hasData ? "text-red-100" : "text-white"}`}>
                          {result.exceedsCap && hasData ? "⚠ Grand Total — CAP BREACH" : "Grand Total / Selling Price"}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className={`font-mono text-[15px] font-bold ${result.exceedsCap && hasData ? "text-red-200" : "text-emerald-400"}`}>
                          ₹{fmt(result.sellingPerKg, 4)}<span className="text-[11px] ml-1 opacity-60">/kg</span>
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className={`font-mono text-[20px] font-black ${result.exceedsCap && hasData ? "text-red-100" : "text-white"}`}>
                          {hasData ? fmtINR(result.grandTotal) : "—"}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
