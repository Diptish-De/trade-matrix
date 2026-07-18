import { useState, useMemo, useRef, useEffect } from "react";
import {
  Save, ChevronDown, AlertTriangle, TrendingUp, Package,
  Truck, Wheat, IndianRupee, BarChart3, RefreshCw, Zap,
  CheckCircle2, ArrowRight, Activity, Download, Printer,
  DollarSign, Euro, Trash2, FolderOpen
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  if (!isFinite(n) || isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function fmtCurrency(val: number, cur: "INR" | "USD" | "EUR", rate: number) {
  const converted = val / rate;
  if (!isFinite(converted) || isNaN(converted)) return "—";
  const symbol = cur === "INR" ? "₹" : cur === "USD" ? "$" : "€";
  
  if (cur === "INR") {
    return symbol + fmt(converted, 2);
  }
  return symbol + new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(converted);
}

function fmtCurrencyShort(val: number, cur: "INR" | "USD" | "EUR", rate: number) {
  const converted = val / rate;
  if (!isFinite(converted) || isNaN(converted) || converted === 0) return "—";
  const symbol = cur === "INR" ? "₹" : cur === "USD" ? "$" : "€";
  
  if (cur === "INR") {
    if (converted >= 1e7) return `${symbol}${fmt(converted / 1e7, 2)} Cr`;
    if (converted >= 1e5) return `${symbol}${fmt(converted / 1e5, 2)} L`;
    return `${symbol}${fmt(converted, 0)}`;
  }
  
  if (converted >= 1e6) return `${symbol}${fmt(converted / 1e6, 2)} M`;
  if (converted >= 1e3) return `${symbol}${fmt(converted / 1e3, 1)} K`;
  return `${symbol}${fmt(converted, 0)}`;
}

// animated number that ticks up/down
function AnimatedNumber({ value, prefix = "", suffix = "", decimals = 2 }: {
  value: number; prefix?: string; suffix?: string; decimals?: number;
}) {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number>(0);

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

  const formatted = isFinite(display) ? fmt(display, decimals) : "—";
  return <span>{prefix}{formatted}{suffix}</span>;
}

// ── types ─────────────────────────────────────────────────────────────────────

interface Inputs {
  mode: "standard" | "reverse";
  volume: string; volumeUnit: "MT" | "kg" | "Quintal";
  procPrice: string; procUnit: "INR/kg" | "INR/MT";
  lossPct: string; // wastage/moisture loss factor
  freightPreset: string;
  freight: string; freightMode: "FOR" | "Ex-Factory"; freightRate: "Per Ton" | "Per kg" | "Flat Rate";
  packagingEnabled: boolean; packagingRate: string; packagingBasis: "Per Quintal" | "Per 50kg bag";
  targetMargin: string;
  targetSellingPrice: string;
  buyerCap: string;
}

interface CalcResult {
  volumeMT: number; volumeKg: number;
  baseProcPerKg: number; procPerKg: number; freightPerKg: number; packPerKg: number;
  subtotalPerKg: number; marginPerKg: number; sellingPerKg: number;
  totalProcurement: number; totalFreight: number; totalPackaging: number;
  totalSubtotal: number; totalMargin: number; grandTotal: number;
  exceedsCap: boolean; marginPct: number;
}

interface SavedDeal {
  id: string;
  name: string;
  timestamp: number;
  inputs: Inputs;
}

const FREIGHT_PRESETS: { [key: string]: { mode: "FOR" | "Ex-Factory"; rate: "Per Ton" | "Per kg" | "Flat Rate"; amount: string } } = {
  "Mundra Port to Factory": { mode: "FOR", rate: "Per Ton", amount: "2200" },
  "Kolkata Port to Warehouse": { mode: "FOR", rate: "Per Ton", amount: "1500" },
  "Local Yard to Mill": { mode: "Ex-Factory", rate: "Flat Rate", amount: "800" },
};

function calculate(inp: Inputs): CalcResult {
  const vol = parseFloat(inp.volume) || 0;
  const volumeKg = inp.volumeUnit === "MT" ? vol * 1000 : inp.volumeUnit === "Quintal" ? vol * 100 : vol;
  const volumeMT = volumeKg / 1000;
  
  const rawProc = parseFloat(inp.procPrice) || 0;
  const baseProcPerKg = inp.procUnit === "INR/MT" ? rawProc / 1000 : rawProc;
  
  // Adjust base procurement by wastage/loss factor
  const lossPctVal = parseFloat(inp.lossPct) || 0;
  const procPerKg = lossPctVal > 0 ? baseProcPerKg / (1 - lossPctVal / 100) : baseProcPerKg;

  const rawFreight = parseFloat(inp.freight) || 0;
  let freightPerKg = 0;
  if (inp.freightRate === "Per Ton") freightPerKg = rawFreight / 1000;
  else if (inp.freightRate === "Per kg") freightPerKg = rawFreight;
  else freightPerKg = volumeKg > 0 ? rawFreight / volumeKg : 0;

  const rawPack = parseFloat(inp.packagingRate) || 0;
  const packPerKg = inp.packagingEnabled ? (inp.packagingBasis === "Per Quintal" ? rawPack / 100 : rawPack / 50) : 0;

  const subtotalPerKg = procPerKg + freightPerKg + packPerKg;
  
  let marginPerKg = 0;
  let sellingPerKg = 0;

  if (inp.mode === "reverse") {
    const targetSell = parseFloat(inp.targetSellingPrice) || 0;
    sellingPerKg = targetSell;
    marginPerKg = targetSell - subtotalPerKg;
  } else {
    marginPerKg = parseFloat(inp.targetMargin) || 0;
    sellingPerKg = subtotalPerKg + marginPerKg;
  }

  const totalProcurement = procPerKg * volumeKg;
  const totalFreight = freightPerKg * volumeKg;
  const totalPackaging = packPerKg * volumeKg;
  const totalSubtotal = subtotalPerKg * volumeKg;
  const totalMargin = marginPerKg * volumeKg;
  const grandTotal = sellingPerKg * volumeKg;

  const cap = parseFloat(inp.buyerCap) || 0;
  const exceedsCap = cap > 0 && sellingPerKg > cap;
  const marginPct = subtotalPerKg > 0 ? (marginPerKg / subtotalPerKg) * 100 : 0;

  return {
    volumeMT, volumeKg, baseProcPerKg, procPerKg, freightPerKg, packPerKg,
    subtotalPerKg, marginPerKg, sellingPerKg,
    totalProcurement, totalFreight, totalPackaging,
    totalSubtotal, totalMargin, grandTotal, exceedsCap, marginPct
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
  label: string; value: React.ReactNode; sub?: React.ReactNode;
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
      <div className={`font-mono text-[20px] font-bold leading-tight tracking-tight`}>{value}</div>
      {sub && <span className={`text-[11px] font-mono ${subStyles[variant]}`}>{sub}</span>}
    </div>
  );
}

// ── defaults ──────────────────────────────────────────────────────────────────

const EMPTY: Inputs = {
  mode: "standard",
  volume: "", volumeUnit: "MT",
  procPrice: "", procUnit: "INR/kg",
  lossPct: "",
  freightPreset: "Custom",
  freight: "", freightMode: "FOR", freightRate: "Per Ton",
  packagingEnabled: false, packagingRate: "", packagingBasis: "Per Quintal",
  targetMargin: "", targetSellingPrice: "", buyerCap: "",
};

const DEMO: Inputs = {
  mode: "standard",
  volume: "100", volumeUnit: "MT",
  procPrice: "18.80", procUnit: "INR/kg",
  lossPct: "2",
  freightPreset: "Custom",
  freight: "1800", freightMode: "FOR", freightRate: "Per Ton",
  packagingEnabled: true, packagingRate: "120", packagingBasis: "Per Quintal",
  targetMargin: "1.40", targetSellingPrice: "", buyerCap: "22",
};

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [inp, setInp] = useState<Inputs>(EMPTY);
  const [saveState, setSaveState] = useState<"idle" | "saved">("idle");
  const [dealName, setDealName] = useState("");
  const [currency, setCurrency] = useState<"INR" | "USD" | "EUR">("INR");
  const [liveRates, setLiveRates] = useState({ USD: 83.5, EUR: 91.0 });
  const [fxRate, setFxRate] = useState<number>(1.0);
  const [savedDeals, setSavedDeals] = useState<SavedDeal[]>([]);

  // Load saved deals on mount
  useEffect(() => {
    const deals = localStorage.getItem("trade_matrix_deals");
    if (deals) {
      setSavedDeals(JSON.parse(deals));
    }
  }, []);

  // Fetch live exchange rates on mount
  useEffect(() => {
    fetch("https://open.er-api.com/v6/latest/USD")
      .then((res) => res.json())
      .then((data) => {
        if (data && data.rates && data.rates.INR) {
          const usdToInr = data.rates.INR;
          const eurToInr = data.rates.INR / (data.rates.EUR || 0.92);
          setLiveRates({
            USD: Number(usdToInr.toFixed(2)),
            EUR: Number(eurToInr.toFixed(2)),
          });
        }
      })
      .catch((err) => console.error("Error fetching exchange rates:", err));
  }, []);

  // Update Fx rates when currency or fetched rates change
  useEffect(() => {
    if (currency === "USD") setFxRate(liveRates.USD);
    else if (currency === "EUR") setFxRate(liveRates.EUR);
    else setFxRate(1.0);
  }, [currency, liveRates]);

  function set<K extends keyof Inputs>(k: K, v: Inputs[K]) {
    setInp((p) => {
      const next = { ...p, [k]: v };
      
      // Auto-fill values on freight preset changes
      if (k === "freightPreset" && v !== "Custom") {
        const preset = FREIGHT_PRESETS[v as string];
        if (preset) {
          next.freightMode = preset.mode;
          next.freightRate = preset.rate;
          next.freight = preset.amount;
        }
      }
      return next;
    });
  }

  const result = useMemo(() => calculate(inp), [inp]);
  const demoResult = useMemo(() => calculate(DEMO), []);
  const hasData = parseFloat(inp.volume) > 0 && parseFloat(inp.procPrice) > 0;
  const marginPct = result.marginPct;

  function triggerConfetti() {
    import("canvas-confetti").then((confetti) => {
      confetti.default({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.8 }
      });
    });
  }

  function handleSave() {
    const defaultName = `Deal ${fmt(result.volumeMT, 1)} MT Rice @ ₹${fmt(result.sellingPerKg, 2)}/kg`;
    const finalName = dealName.trim() || defaultName;
    const newDeal: SavedDeal = {
      id: crypto.randomUUID(),
      name: finalName,
      timestamp: Date.now(),
      inputs: inp,
    };
    const updated = [newDeal, ...savedDeals];
    setSavedDeals(updated);
    localStorage.setItem("trade_matrix_deals", JSON.stringify(updated));
    
    setSaveState("saved");
    setDealName("");
    setTimeout(() => setSaveState("idle"), 2000);

    if (!result.exceedsCap && hasData) {
      triggerConfetti();
    }
  }

  function deleteDeal(id: string) {
    const updated = savedDeals.filter(d => d.id !== id);
    setSavedDeals(updated);
    localStorage.setItem("trade_matrix_deals", JSON.stringify(updated));
  }

  function exportCSV() {
    const headers = ["Component", "Unit Basis", `Rate/kg (${currency})`, `Total (${currency})`];
    const rows = [
      ["Rice Procurement (wastage adjusted)", inp.procUnit, (result.procPerKg / fxRate).toFixed(4), (result.totalProcurement / fxRate).toFixed(2)],
      ["Freight / Logistics", inp.freightRate, (result.freightPerKg / fxRate).toFixed(4), (result.totalFreight / fxRate).toFixed(2)],
      ["Packaging", inp.packagingEnabled ? inp.packagingBasis : "OFF", (result.packPerKg / fxRate).toFixed(4), (result.totalPackaging / fxRate).toFixed(2)],
      ["Subtotal (Cost before Profit)", "—", (result.subtotalPerKg / fxRate).toFixed(4), (result.totalSubtotal / fxRate).toFixed(2)],
      ["Net Profit Margin", "INR/kg", (result.marginPerKg / fxRate).toFixed(4), (result.totalMargin / fxRate).toFixed(2)],
      ["Grand Total / Selling Price", "INR/kg", (result.sellingPerKg / fxRate).toFixed(4), (result.grandTotal / fxRate).toFixed(2)]
    ];
    
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.map(val => `"${val}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `deal_quote_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // cost breakdown bar widths
  const totalCost = result.subtotalPerKg || 1;
  const procW = Math.round((result.procPerKg / totalCost) * 100);
  const frW   = Math.round((result.freightPerKg / totalCost) * 100);
  const pkW   = Math.round((result.packPerKg / totalCost) * 100);

  // Pie chart data
  const pieData = [
    { name: "Procurement", value: Number(result.procPerKg.toFixed(4)), color: "#059669" }, // emerald-600
    { name: "Freight", value: Number(result.freightPerKg.toFixed(4)), color: "#0ea5e9" }, // sky-500
    { name: "Packaging", value: Number(result.packPerKg.toFixed(4)), color: "#f59e0b" }, // amber-500
    { name: "Margin", value: result.marginPerKg > 0 ? Number(result.marginPerKg.toFixed(4)) : 0, color: "#14b8a6" }, // teal-500
  ].filter(d => d.value > 0);

  return (
    <div className="min-h-screen bg-[#F1F5F9] print:bg-white" style={{ fontFamily: "Inter, sans-serif" }}>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header className="bg-[#0F172A] sticky top-0 z-50 shadow-lg shadow-slate-900/20 print:hidden">
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

          {/* Currency Toggle */}
          <div className="flex items-center bg-slate-800 rounded-lg p-1 ml-4 border border-slate-700">
            {(["INR", "USD", "EUR"] as const).map(c => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all cursor-pointer
                  ${currency === c ? "bg-emerald-500 text-white shadow" : "text-slate-400 hover:text-white"}`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* FX rate display */}
          {currency !== "INR" && (
            <div className="flex items-center gap-1.5 text-slate-400 text-[11.5px] font-mono">
              <span>Rate: 1 {currency} =</span>
              <input
                type="number"
                value={fxRate}
                onChange={(e) => setFxRate(parseFloat(e.target.value) || 1)}
                className="w-16 bg-slate-800 border border-slate-700 text-white rounded px-1.5 py-0.5 text-right focus:outline-none focus:border-emerald-500"
              />
              <span>INR</span>
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setInp(DEMO)}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 transition-all cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              Demo
            </button>
            <button
              onClick={() => setInp(EMPTY)}
              className="text-[12px] font-medium text-slate-500 hover:text-slate-300 px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
            >
              Clear
            </button>
            <div className="flex items-center bg-slate-800 rounded-lg border border-slate-700 pr-1 select-none">
              <input
                type="text"
                value={dealName}
                onChange={(e) => setDealName(e.target.value)}
                placeholder="Deal Name..."
                className="w-36 bg-transparent text-white text-[12px] px-3 focus:outline-none placeholder:text-slate-500 font-semibold"
              />
              <motion.button
                onClick={handleSave}
                whileTap={{ scale: 0.95 }}
                className={`flex items-center gap-1.5 text-[12px] font-bold px-4 py-1.5 rounded-md transition-all shadow-md cursor-pointer
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
            className="overflow-hidden print:hidden"
          >
            <div className="bg-red-600 px-5 py-2.5 flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-100 flex-shrink-0" />
              <span className="text-[12.5px] font-bold text-white">
                BUYER CAP BREACH — Selling {fmtCurrency(result.sellingPerKg, currency, fxRate)}/kg vs cap {fmtCurrency(parseFloat(inp.buyerCap), currency, fxRate)}/kg
                &nbsp;·&nbsp; Over by {fmtCurrency(result.sellingPerKg - parseFloat(inp.buyerCap), currency, fxRate)}/kg
              </span>
              <span className="ml-auto text-[11px] text-red-200 font-semibold">Reduce margin or renegotiate procurement</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── BODY ────────────────────────────────────────────────────────── */}
      <main className="max-w-[1400px] mx-auto px-5 py-5 print:py-0 print:px-0">
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5 items-start print:grid-cols-1">

          {/* ════════════════════════════════════════════════════════════
              LEFT — INPUTS
          ════════════════════════════════════════════════════════════ */}
          <aside className="flex flex-col gap-3 print:hidden">

            {/* Mode Toggle */}
            <div className="flex bg-slate-200/80 rounded-xl p-1 border border-slate-300">
              <button
                onClick={() => set("mode", "standard")}
                className={`flex-1 py-1.5 text-[11.5px] font-bold rounded-lg transition-all cursor-pointer
                  ${inp.mode === "standard" ? "bg-slate-900 text-white shadow-md" : "text-slate-500 hover:text-slate-700"}`}
              >
                Standard Engine
              </button>
              <button
                onClick={() => set("mode", "reverse")}
                className={`flex-1 py-1.5 text-[11.5px] font-bold rounded-lg transition-all cursor-pointer
                  ${inp.mode === "reverse" ? "bg-slate-900 text-white shadow-md" : "text-slate-500 hover:text-slate-700"}`}
              >
                Reverse Calculator
              </button>
            </div>

            <div className="flex items-center justify-between px-0.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Deal Parameters</span>
              <span className="text-[10.5px] text-slate-400 font-mono">All values adjusted in {currency}</span>
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
                    className="text-[11px] text-emerald-500 mt-2 font-mono font-semibold"
                  >
                    = {fmt(result.volumeKg, 0)} kg &nbsp;·&nbsp; {fmt(result.volumeMT, 3)} MT
                  </motion.p>
                )}
              </AnimatePresence>
            </InputSection>

            {/* ── 2. Procurement & Loss ── */}
            <InputSection icon={<IndianRupee className="w-3.5 h-3.5" />} title="Procurement Price & Wastage">
              <FieldLabel>Rate</FieldLabel>
              <div className="flex gap-2 mb-3">
                <NumInput value={inp.procPrice} onChange={(v) => set("procPrice", v)} placeholder="18.80"
                  alert={result.exceedsCap && hasData} />
                <StyledSelect value={inp.procUnit} onChange={(v) => set("procUnit", v as Inputs["procUnit"])} options={["INR/kg", "INR/MT"]} />
              </div>
              
              <FieldLabel>Estimated Loss / Wastage (%)</FieldLabel>
              <NumInput value={inp.lossPct} onChange={(v) => set("lossPct", v)} placeholder="0.0%" />
              
              <AnimatePresence>
                {inp.procPrice && (
                  <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="text-[11px] text-slate-400 mt-2 font-mono">
                    Adjusted Rate: {fmtCurrency(result.procPerKg, currency, fxRate)}/kg
                    <br />
                    Total: <span className="text-slate-600 font-semibold">{fmtCurrency(result.totalProcurement, currency, fxRate)}</span>
                  </motion.p>
                )}
              </AnimatePresence>
            </InputSection>

            {/* ── 3. Freight preset & logistics ── */}
            <InputSection icon={<Truck className="w-3.5 h-3.5" />} title="Freight / Logistics">
              <div className="mb-3">
                <FieldLabel>Freight Presets</FieldLabel>
                <StyledSelect
                  value={inp.freightPreset}
                  onChange={(v) => set("freightPreset", v)}
                  options={["Custom", "Mundra Port to Factory", "Kolkata Port to Warehouse", "Local Yard to Mill"]}
                />
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <FieldLabel>Delivery Mode</FieldLabel>
                  <div className="flex rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
                    {(["FOR", "Ex-Factory"] as const).map((m) => (
                      <button key={m} onClick={() => set("freightMode", m)}
                        disabled={inp.freightPreset !== "Custom"}
                        className={`flex-1 text-[11px] font-bold py-[8px] transition-all disabled:opacity-70 disabled:cursor-not-allowed ${inp.freightMode === m ? "bg-[#0F172A] text-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
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
              <NumInput value={inp.freight} onChange={(v) => set("freight", v)} placeholder="1800" alert={inp.freightPreset !== "Custom"} />
              <AnimatePresence>
                {inp.freight && (
                  <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="text-[11px] text-slate-400 mt-2 font-mono">
                    {fmtCurrency(result.freightPerKg, currency, fxRate)}/kg · <span className="text-slate-600 font-semibold">{fmtCurrency(result.totalFreight, currency, fxRate)}</span>
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
                  className="relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none flex-shrink-0 cursor-pointer"
                  style={{ background: inp.packagingEnabled ? "#10B981" : "#CBD5E1" }}>
                  <motion.span animate={{ x: inp.packagingEnabled ? 22 : 2 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-md block animate-none" />
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
                        {fmtCurrency(result.packPerKg, currency, fxRate)}/kg · <span className="text-slate-600 font-semibold">{fmtCurrency(result.totalPackaging, currency, fxRate)}</span>
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              {!inp.packagingEnabled && (
                <p className="text-[11px] text-slate-300 font-mono">₹0.0000/kg · excluded from ledger</p>
              )}
            </InputSection>

            {/* ── 5. Target Margin (Standard) / Target Price (Reverse) ── */}
            <InputSection icon={<TrendingUp className="w-3.5 h-3.5" />} title={inp.mode === "reverse" ? "Target Price (Reverse)" : "Target Profit Margin"}>
              {inp.mode === "reverse" ? (
                <>
                  <FieldLabel>Target Selling Price (INR/kg)</FieldLabel>
                  <NumInput value={inp.targetSellingPrice} onChange={(v) => set("targetSellingPrice", v)} placeholder="22.00" />
                  {inp.targetSellingPrice && result.subtotalPerKg > 0 && (
                    <div className="mt-2.5 font-mono text-[11px]">
                      <div className="flex justify-between font-semibold text-emerald-500 mb-1">
                        <span>Calculated Margin:</span>
                        <span>{fmtCurrency(result.marginPerKg, currency, fxRate)}/kg ({fmt(marginPct, 1)}%)</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <motion.div animate={{ width: `${Math.min(Math.max(marginPct, 0), 100)}%` }}
                          className={`h-full rounded-full ${marginPct > 15 ? "bg-emerald-400" : marginPct > 0 ? "bg-emerald-500" : "bg-red-500"}`} />
                      </div>
                      <p className="text-slate-500 mt-1">Calculated net profit: {fmtCurrency(result.totalMargin, currency, fxRate)}</p>
                    </div>
                  )}
                </>
              ) : (
                <>
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
                      Net profit: {fmtCurrency(result.totalMargin, currency, fxRate)}
                    </p>
                  )}
                </>
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
                    ? `${fmtCurrency(result.sellingPerKg - parseFloat(inp.buyerCap), currency, fxRate)}/kg over cap — deal at risk`
                    : "Triggers red alert if selling price exceeds this."}
                </p>
              </div>
            </div>
          </aside>

          {/* ════════════════════════════════════════════════════════════
              RIGHT — RESULTS
          ════════════════════════════════════════════════════════════ */}
          <div className="flex flex-col gap-5 print:gap-4 print:w-full">

            {/* ── KPI TILES ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 print:grid-cols-4">
              <KPITile
                label="Cost / kg"
                value={<AnimatedNumber value={result.subtotalPerKg / fxRate} prefix={currency === "INR" ? "₹" : currency === "USD" ? "$" : "€"} />}
                sub={hasData ? fmtCurrencyShort(result.totalSubtotal, currency, fxRate) : "enter data"}
                variant="default"
              />
              <KPITile
                label="Net Margin"
                value={<AnimatedNumber value={result.marginPerKg / fxRate} prefix={currency === "INR" ? "₹" : currency === "USD" ? "$" : "€"} />}
                sub={`${fmt(marginPct, 1)}% on cost`}
                variant="green"
              />
              <KPITile
                label="Sell Price / kg"
                value={<AnimatedNumber value={result.sellingPerKg / fxRate} prefix={currency === "INR" ? "₹" : currency === "USD" ? "$" : "€"} />}
                sub={inp.buyerCap ? `Cap: ${fmtCurrency(parseFloat(inp.buyerCap), currency, fxRate)}/kg` : undefined}
                variant={result.exceedsCap && hasData ? "red" : "default"}
              />
              <KPITile
                label="Grand Total"
                value={hasData ? fmtCurrencyShort(result.grandTotal, currency, fxRate) : "—"}
                sub={`${fmt(result.volumeMT, 1)} MT`}
                variant={result.exceedsCap && hasData ? "red" : "dark"}
              />
            </div>

            {/* Visual breakdown & chart */}
            {hasData && result.subtotalPerKg > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-5 items-stretch print:grid-cols-1">
                
                {/* Cost Breakdown Progress Bar */}
                <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Cost Stack Breakdown</span>
                      <span className="text-[11.5px] font-mono font-bold text-slate-600">
                        Total Cost: {fmtCurrency(result.subtotalPerKg, currency, fxRate)}/kg
                      </span>
                    </div>
                    <div className="flex h-5 rounded-lg overflow-hidden gap-px">
                      <motion.div animate={{ width: `${procW}%` }} transition={{ duration: 0.4 }}
                        className="bg-slate-700 h-full" title={`Procurement ${procW}%`} />
                      <motion.div animate={{ width: `${frW}%` }} transition={{ duration: 0.4 }}
                        className="bg-slate-400 h-full" title={`Freight ${frW}%`} />
                      {inp.packagingEnabled && (
                        <motion.div animate={{ width: `${pkW}%` }} transition={{ duration: 0.4 }}
                          className="bg-slate-300 h-full" title={`Packaging ${pkW}%`} />
                      )}
                      {result.marginPerKg > 0 && (
                        <motion.div
                          animate={{ width: `${Math.round((result.marginPerKg / (result.subtotalPerKg + result.marginPerKg)) * 100)}%` }}
                          transition={{ duration: 0.4 }}
                          className="bg-emerald-400 h-full" title="Margin" />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4">
                    {[
                      { color: "bg-slate-700", label: "Procurement", pct: procW },
                      { color: "bg-slate-400", label: "Freight", pct: frW },
                      inp.packagingEnabled ? { color: "bg-slate-300", label: "Packaging", pct: pkW } : null,
                      result.marginPerKg > 0 ? { color: "bg-emerald-400", label: "Margin", pct: Math.round((result.marginPerKg / (result.subtotalPerKg + result.marginPerKg)) * 100) } : null,
                    ].filter(Boolean).map((item) => (
                      <div key={item!.label} className="flex items-center gap-1.5">
                        <span className={`w-2.5 h-2.5 rounded-sm ${item!.color}`} />
                        <span className="text-[11.5px] text-slate-500">{item!.label} <span className="font-mono font-bold text-slate-700">{item!.pct}%</span></span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Donut Chart */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col items-center justify-center min-h-[160px] print:hidden">
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-2 w-full text-left">Visual Split / kg</span>
                  <div className="w-full h-28 relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={28}
                          outerRadius={45}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip formatter={(value) => [`${value} /kg`]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none select-none">
                      <span className="text-[10px] font-bold text-slate-400 uppercase leading-none block">Margin</span>
                      <span className="text-[12px] font-mono font-bold text-emerald-500 leading-none">{fmt(marginPct, 0)}%</span>
                    </div>
                  </div>
                </div>

              </div>
            )}



            {/* ── MASTER INVOICE LEDGER ── */}
            <div id="print-area">
              <div className="flex items-center justify-between mb-3 print:hidden">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Master Invoice Ledger</span>
                
                <div className="flex gap-2">
                  <button
                    onClick={exportCSV}
                    className="flex items-center gap-1 text-[11px] font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg px-2.5 py-1 transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> CSV
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="flex items-center gap-1 text-[11px] font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg px-2.5 py-1 transition-all cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" /> Print Quote
                  </button>
                </div>
              </div>

              {/* Printable Header */}
              <div className="hidden print:flex items-center justify-between border-b-2 border-slate-900 pb-4 mb-5">
                <div>
                  <h1 className="text-[20px] font-black tracking-tight text-slate-900">Blueblood exports</h1>
                  <p className="text-[12px] text-slate-500">B2B Trade Margin Calculation Quote Sheet</p>
                </div>
                <div className="text-right text-[11px] font-mono text-slate-500">
                  <p>Date: {new Date().toLocaleDateString("en-IN")}</p>
                  <p>FX Conversion: 1 {currency} = {fxRate} INR</p>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm print:border-none print:shadow-none">
                <table className="w-full text-[13px] border-collapse">
                  <thead>
                    <tr className="bg-[#0F172A] print:bg-slate-200">
                      {["Component Item", "Unit Basis", `Rate / kg (${currency})`, `Total (${currency})`].map((h, i) => (
                        <th key={h} className={`py-3 px-4 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400 print:text-slate-800 ${i === 0 ? "text-left w-[38%]" : i === 1 ? "text-left w-[18%]" : "text-right"}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>

                    {/* Procurement */}
                    <tr className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-700">
                        <div className="flex items-center gap-2">
                          <Wheat className="w-3.5 h-3.5 text-slate-300 print:hidden" /> 
                          Rice Procurement 
                          {parseFloat(inp.lossPct) > 0 && <span className="text-[10px] bg-amber-50 border border-amber-100 text-amber-600 rounded px-1.5 py-0.5 font-semibold">Wastage {inp.lossPct}%</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-400 font-mono text-[12px]">{inp.procUnit}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-700">{fmtCurrency(result.procPerKg, currency, fxRate)}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">{hasData ? fmtCurrency(result.totalProcurement, currency, fxRate) : "—"}</td>
                    </tr>

                    {/* Freight */}
                    <tr className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-700">
                        <div className="flex items-center gap-2"><Truck className="w-3.5 h-3.5 text-slate-300 print:hidden" /> Freight / Logistics <span className="text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5 font-bold ml-1">{inp.freightMode}</span></div>
                      </td>
                      <td className="px-4 py-3 text-slate-400 font-mono text-[12px]">{inp.freightRate}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-700">{fmtCurrency(result.freightPerKg, currency, fxRate)}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">{hasData ? fmtCurrency(result.totalFreight, currency, fxRate) : "—"}</td>
                    </tr>

                    {/* Packaging */}
                    <tr className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                      <td className={`px-4 py-3 font-medium ${inp.packagingEnabled ? "text-slate-700" : "text-slate-300"}`}>
                        <div className="flex items-center gap-2">
                          <Package className="w-3.5 h-3.5 text-slate-300 print:hidden" /> Packaging
                          {!inp.packagingEnabled && <span className="text-[10px] bg-slate-100 text-slate-400 rounded px-1.5 py-0.5 font-bold">OFF</span>}
                        </div>
                      </td>
                      <td className={`px-4 py-3 font-mono text-[12px] ${inp.packagingEnabled ? "text-slate-400" : "text-slate-200"}`}>
                        {inp.packagingEnabled ? inp.packagingBasis : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${inp.packagingEnabled ? "text-slate-700" : "text-slate-200"}`}>
                        {fmtCurrency(result.packPerKg, currency, fxRate)}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${inp.packagingEnabled ? "text-slate-800" : "text-slate-200"}`}>
                        {inp.packagingEnabled && hasData ? fmtCurrency(result.totalPackaging, currency, fxRate) : "—"}
                      </td>
                    </tr>

                    {/* Subtotal */}
                    <tr className="bg-slate-50 border-y border-slate-200 print:bg-slate-100">
                      <td colSpan={2} className="px-4 py-3 font-bold text-[13.5px] text-slate-700">Subtotal — Cost Before Profit</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">{fmtCurrency(result.subtotalPerKg, currency, fxRate)}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">{hasData ? fmtCurrency(result.totalSubtotal, currency, fxRate) : "—"}</td>
                    </tr>

                    {/* Margin */}
                    <tr className="bg-emerald-50/60 border-b border-emerald-100 hover:bg-emerald-50 transition-colors print:bg-emerald-50">
                      <td className="px-4 py-3 font-semibold text-emerald-700">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-400 print:hidden" />
                          Net Profit Margin
                          {result.subtotalPerKg > 0 && (
                            <span className="text-[10px] bg-emerald-100 text-emerald-600 border border-emerald-200 rounded-full px-2 py-0.5 font-bold ml-1">{fmt(marginPct, 1)}%</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-emerald-500">INR/kg</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">{fmtCurrency(result.marginPerKg, currency, fxRate)}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">{hasData ? fmtCurrency(result.totalMargin, currency, fxRate) : "—"}</td>
                    </tr>

                    {/* Grand Total */}
                    <tr className={result.exceedsCap && hasData ? "bg-red-600 text-white" : "bg-[#0F172A] text-white print:bg-slate-800"}>
                      <td colSpan={2} className="px-4 py-4">
                        <span className="text-[14px] font-black uppercase tracking-wider">
                          {result.exceedsCap && hasData ? "⚠ Grand Total — CAP BREACH" : "Grand Total / Selling Price"}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className={`font-mono text-[15px] font-bold ${result.exceedsCap && hasData ? "text-white" : "text-emerald-400"}`}>
                          {fmtCurrency(result.sellingPerKg, currency, fxRate)}<span className="text-[11px] ml-1 opacity-60">/kg</span>
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className="font-mono text-[20px] font-black">
                          {hasData ? fmtCurrency(result.grandTotal, currency, fxRate) : "—"}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Printable Footer */}
              <div className="hidden print:block text-center text-[10px] text-slate-400 mt-10 border-t border-slate-200 pt-3">
                Quote generated dynamically using B2B Trade Margin Engine. All rates subject to final negotiation.
              </div>
            </div>

            {/* Saved Deals Ledger panel */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-all print:hidden">
              <div className="flex items-center gap-2 mb-3">
                <FolderOpen className="w-4 h-4 text-slate-500" />
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Saved Deals Ledger</span>
                <span className="ml-auto text-[10.5px] font-mono text-slate-400">{savedDeals.length} deals</span>
              </div>
              
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {savedDeals.length === 0 ? (
                  <p className="text-[12px] text-slate-400 text-center py-4">No saved deals yet.</p>
                ) : (
                  savedDeals.map((deal) => {
                    const dealRes = calculate(deal.inputs);
                    return (
                      <div key={deal.id} className="flex items-center justify-between border border-slate-100 rounded-lg p-2.5 hover:bg-slate-50/50 transition-all">
                        <div className="flex-1 min-w-0 pr-3">
                          <p className="text-[12px] font-bold text-slate-700 truncate">{deal.name}</p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {new Date(deal.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {fmt(dealRes.volumeMT, 1)} MT · {fmtCurrencyShort(dealRes.grandTotal, currency, fxRate)}
                          </p>
                        </div>
                        
                        <div className="flex gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => setInp(deal.inputs)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 rounded px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer"
                          >
                            Load
                          </button>
                          <button
                            onClick={() => deleteDeal(deal.id)}
                            className="bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 rounded p-1 transition-all cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
