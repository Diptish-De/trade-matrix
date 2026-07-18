import { useState, useMemo, useEffect, useRef } from "react";
import { Save, ChevronDown, AlertTriangle, TrendingUp, Package, Truck, Wheat, IndianRupee, BarChart3, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { animate } from "motion";

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function fmtINR(n: number): string {
  if (!isFinite(n)) return "—";
  if (n >= 1e7) return `₹${fmt(n / 1e7, 2)} Cr`;
  if (n >= 1e5) return `₹${fmt(n / 1e5, 2)} L`;
  return `₹${fmt(n, 0)}`;
}

// ── animated number component ─────────────────────────────────────────────────

function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prevValue = useRef(value);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const controls = animate(prevValue.current, value, {
      duration: 0.6,
      ease: [0.16, 1, 0.3, 1], // cubic easeOut
      onUpdate(val) {
        node.textContent = format(val);
      },
    });

    prevValue.current = value;
    return () => controls.stop();
  }, [value, format]);

  return <span ref={ref}>{format(value)}</span>;
}

// ── types ─────────────────────────────────────────────────────────────────────

interface Inputs {
  volume: string;
  volumeUnit: "MT" | "kg" | "Quintal";
  procPrice: string;
  procUnit: "INR/kg" | "INR/MT";
  freight: string;
  freightMode: "FOR" | "Ex-Factory";
  freightRate: "Per Ton" | "Per kg" | "Flat Rate";
  packagingEnabled: boolean;
  packagingRate: string;
  packagingBasis: "Per Quintal" | "Per 50kg bag";
  targetMargin: string;
  buyerCap: string;
}

interface CalcResult {
  volumeMT: number;
  volumeKg: number;
  procPerKg: number;
  freightPerKg: number;
  packPerKg: number;
  subtotalPerKg: number;
  marginPerKg: number;
  sellingPerKg: number;
  totalProcurement: number;
  totalFreight: number;
  totalPackaging: number;
  totalSubtotal: number;
  totalMargin: number;
  grandTotal: number;
  exceedsCap: boolean;
}

// ── calculation engine ────────────────────────────────────────────────────────

function calculate(inp: Inputs): CalcResult {
  const vol = parseFloat(inp.volume) || 0;
  const volumeKg =
    inp.volumeUnit === "MT"
      ? vol * 1000
      : inp.volumeUnit === "Quintal"
      ? vol * 100
      : vol;
  const volumeMT = volumeKg / 1000;

  const rawProc = parseFloat(inp.procPrice) || 0;
  const procPerKg = inp.procUnit === "INR/MT" ? rawProc / 1000 : rawProc;

  const rawFreight = parseFloat(inp.freight) || 0;
  let freightPerKg = 0;
  if (inp.freightRate === "Per Ton") freightPerKg = rawFreight / 1000;
  else if (inp.freightRate === "Per kg") freightPerKg = rawFreight;
  else freightPerKg = volumeKg > 0 ? rawFreight / volumeKg : 0;

  const rawPack = parseFloat(inp.packagingRate) || 0;
  let packPerKg = 0;
  if (inp.packagingEnabled) {
    packPerKg =
      inp.packagingBasis === "Per Quintal"
        ? rawPack / 100
        : rawPack / 50;
  }

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

// ── subcomponents ─────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 block mb-1.5">
      {children}
    </span>
  );
}

function Select({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-slate-50 border border-slate-200 text-slate-700 text-[13px] font-medium rounded px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400 transition-all cursor-pointer w-full"
      >
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
    </div>
  );
}

function NumInput({
  value, onChange, placeholder = "0.00", alert = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  alert?: boolean;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-white border text-[15px] font-medium rounded px-3 py-2 focus:outline-none focus:ring-2 transition-all placeholder:text-slate-300 font-mono
        ${alert
          ? "border-red-400 ring-2 ring-red-200 text-red-700 focus:ring-red-300"
          : "border-slate-200 focus:ring-emerald-500/40 focus:border-emerald-400 text-slate-800"
        }`}
    />
  );
}

function InputCard({ children, icon, title }: { children: React.ReactNode; icon: React.ReactNode; title: string }) {
  return (
    <div className="bg-white border border-slate-100 rounded-lg p-4 shadow-sm hover:shadow-md hover:border-slate-200 transition-all duration-300">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-md bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400">
          {icon}
        </div>
        <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  );
}

function KPICard({
  label, value, sub, accent = false, warn = false,
}: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: boolean; warn?: boolean;
}) {
  return (
    <div
      className={`rounded-lg p-4 border flex flex-col gap-1 transition-all duration-300 hover:shadow-md hover:border-slate-200
        ${warn ? "bg-red-50 border-red-200" :
          accent ? "bg-emerald-50 border-emerald-200" :
          "bg-white border-slate-100 shadow-sm"}`}
    >
      <span className={`text-[11px] font-semibold uppercase tracking-widest
        ${warn ? "text-red-400" : accent ? "text-emerald-500" : "text-slate-400"}`}>
        {label}
      </span>
      <span className={`font-mono text-xl font-bold leading-tight tracking-tight
        ${warn ? "text-red-600" : accent ? "text-emerald-600" : "text-slate-900"}`}>
        {value}
      </span>
      {sub && (
        <span className={`text-[11px] font-mono
          ${warn ? "text-red-400" : accent ? "text-emerald-500" : "text-slate-400"}`}>
          {sub}
        </span>
      )}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

const DEFAULT_INPUTS: Inputs = {
  volume: "", volumeUnit: "MT",
  procPrice: "", procUnit: "INR/kg",
  freight: "", freightMode: "FOR", freightRate: "Per Ton",
  packagingEnabled: false, packagingRate: "", packagingBasis: "Per Quintal",
  targetMargin: "",
  buyerCap: "",
};

const DEMO_INPUTS: Inputs = {
  volume: "100", volumeUnit: "MT",
  procPrice: "18.80", procUnit: "INR/kg",
  freight: "1800", freightMode: "FOR", freightRate: "Per Ton",
  packagingEnabled: true, packagingRate: "120", packagingBasis: "Per Quintal",
  targetMargin: "1.40",
  buyerCap: "22",
};

export default function App() {
  const [inputs, setInputs] = useState<Inputs>(DEFAULT_INPUTS);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof Inputs>(key: K, val: Inputs[K]) {
    setInputs((p) => ({ ...p, [key]: val }));
  }

  const result = useMemo(() => calculate(inputs), [inputs]);
  const demoResult = useMemo(() => calculate(DEMO_INPUTS), []);

  const hasData = parseFloat(inputs.volume) > 0 && parseFloat(inputs.procPrice) > 0;

  function loadDemo() {
    setInputs(DEMO_INPUTS);
  }

  function clearAll() {
    setInputs(DEFAULT_INPUTS);
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const marginPct = result.subtotalPerKg > 0
    ? (result.marginPerKg / result.subtotalPerKg) * 100
    : 0;

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-[Inter,sans-serif] tracking-tight">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="bg-[#0F172A] border-b border-slate-700/50 sticky top-0 z-40">
        <div className="max-w-[1440px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-gradient-to-tr from-emerald-600 to-emerald-400 rounded-md flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <BarChart3 className="w-4 h-4 text-white" />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-white font-bold text-[15px] tracking-tight">Bluebloodexports</span>
              <span className="hidden sm:block text-slate-500 text-[12px]">/</span>
              <span className="hidden sm:block text-slate-400 text-[13px] font-medium tracking-tight">B2B Trade Margin Engine</span>
              {hasData && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadDemo}
              className="flex items-center gap-1.5 text-[12px] font-medium text-slate-400 hover:text-emerald-400 transition-colors px-3 py-1.5 rounded border border-slate-700 hover:border-emerald-500/50"
            >
              <RefreshCw className="w-3 h-3" />
              Load Demo
            </button>
            <button
              onClick={clearAll}
              className="text-[12px] font-medium text-slate-500 hover:text-slate-300 transition-colors px-3 py-1.5"
            >
              Clear
            </button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleSave}
              className={`flex items-center gap-1.5 text-[12px] font-semibold px-4 py-1.5 rounded transition-all cursor-pointer
                ${saved
                  ? "bg-emerald-500 text-white"
                  : "bg-emerald-500 hover:bg-emerald-400 text-white"
                }`}
            >
              <Save className="w-3.5 h-3.5" />
              {saved ? "Saved!" : "Save Deal"}
            </motion.button>
          </div>
        </div>
      </header>

      {/* ── Alert banner ─────────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {result.exceedsCap && hasData && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="bg-red-50 border-b border-red-200 px-6 py-2.5 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="text-[13px] font-semibold text-red-700">
                Selling price ₹{fmt(result.sellingPerKg)}/kg exceeds buyer cap of ₹{inputs.buyerCap}/kg
                &nbsp;·&nbsp; Margin squeeze: ₹{fmt(result.sellingPerKg - parseFloat(inputs.buyerCap))}/kg over cap
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <main className="max-w-[1440px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">

          {/* ── LEFT PANEL: Inputs ─────────────────────────────────────── */}
          <aside className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate-400">Deal Parameters</h2>
              <span className="text-[11px] text-slate-400">All values in INR</span>
            </div>

            {/* Deal Volume */}
            <InputCard icon={<Wheat className="w-3.5 h-3.5" />} title="Deal Volume">
              <Label>Quantity</Label>
              <div className="flex gap-2">
                <NumInput value={inputs.volume} onChange={(v) => set("volume", v)} placeholder="100" />
                <Select
                  value={inputs.volumeUnit}
                  onChange={(v) => set("volumeUnit", v as Inputs["volumeUnit"])}
                  options={["MT", "kg", "Quintal"]}
                />
              </div>
              <AnimatePresence initial={false}>
                {inputs.volume && (
                  <motion.p
                    initial={{ height: 0, opacity: 0, marginTop: 0 }}
                    animate={{ height: "auto", opacity: 1, marginTop: 6 }}
                    exit={{ height: 0, opacity: 0, marginTop: 0 }}
                    className="text-[11px] text-slate-400 font-mono overflow-hidden"
                  >
                    = {fmt(result.volumeKg, 0)} kg &nbsp;/&nbsp; {fmt(result.volumeMT, 3)} MT
                  </motion.p>
                )}
              </AnimatePresence>
            </InputCard>

            {/* Procurement Price */}
            <InputCard icon={<IndianRupee className="w-3.5 h-3.5" />} title="Base Procurement Price">
              <Label>Rate</Label>
              <div className="flex gap-2">
                <NumInput
                  value={inputs.procPrice}
                  onChange={(v) => set("procPrice", v)}
                  placeholder="18.80"
                  alert={result.exceedsCap && hasData}
                />
                <Select
                  value={inputs.procUnit}
                  onChange={(v) => set("procUnit", v as Inputs["procUnit"])}
                  options={["INR/kg", "INR/MT"]}
                />
              </div>
              <AnimatePresence initial={false}>
                {inputs.procPrice && (
                  <motion.p
                    initial={{ height: 0, opacity: 0, marginTop: 0 }}
                    animate={{ height: "auto", opacity: 1, marginTop: 6 }}
                    exit={{ height: 0, opacity: 0, marginTop: 0 }}
                    className="text-[11px] text-slate-400 font-mono overflow-hidden"
                  >
                    ₹{fmt(result.procPerKg, 4)}/kg · Total: <AnimatedNumber value={result.totalProcurement} format={fmtINR} />
                  </motion.p>
                )}
              </AnimatePresence>
            </InputCard>

            {/* Freight */}
            <InputCard icon={<Truck className="w-3.5 h-3.5" />} title="Logistics / Freight">
              <div className="flex gap-2 mb-3">
                <div className="flex-1">
                  <Label>Mode</Label>
                  <div className="flex gap-1.5">
                    {(["FOR", "Ex-Factory"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => set("freightMode", m)}
                        className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-all cursor-pointer border
                          ${inputs.freightMode === m
                            ? "bg-[#0F172A] border-[#0F172A] text-white"
                            : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                          }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1">
                  <Label>Rate Basis</Label>
                  <Select
                    value={inputs.freightRate}
                    onChange={(v) => set("freightRate", v as Inputs["freightRate"])}
                    options={["Per Ton", "Per kg", "Flat Rate"]}
                  />
                </div>
              </div>
              <Label>Amount</Label>
              <NumInput value={inputs.freight} onChange={(v) => set("freight", v)} placeholder="1800" />
              <AnimatePresence initial={false}>
                {inputs.freight && (
                  <motion.p
                    initial={{ height: 0, opacity: 0, marginTop: 0 }}
                    animate={{ height: "auto", opacity: 1, marginTop: 6 }}
                    exit={{ height: 0, opacity: 0, marginTop: 0 }}
                    className="text-[11px] text-slate-400 font-mono overflow-hidden"
                  >
                    ₹{fmt(result.freightPerKg, 4)}/kg · Total: <AnimatedNumber value={result.totalFreight} format={fmtINR} />
                  </motion.p>
                )}
              </AnimatePresence>
            </InputCard>

            {/* Packaging */}
            <InputCard icon={<Package className="w-3.5 h-3.5" />} title="Packaging Charges">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px] text-slate-500 font-medium">Include packaging cost</span>
                <button
                  onClick={() => set("packagingEnabled", !inputs.packagingEnabled)}
                  className={`w-10 h-[22px] rounded-full relative transition-colors duration-200 flex items-center px-0.5 cursor-pointer outline-none focus:ring-2 focus:ring-emerald-500/40
                    ${inputs.packagingEnabled ? "bg-emerald-500" : "bg-slate-200"}`}
                >
                  <motion.span
                    layout
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    className="w-4 h-4 rounded-full bg-white shadow block"
                    style={{
                      marginLeft: inputs.packagingEnabled ? "18px" : "0px",
                    }}
                  />
                </button>
              </div>
              <AnimatePresence initial={false}>
                {inputs.packagingEnabled ? (
                  <motion.div
                    key="pkg-content"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-slate-100 pt-3 mt-3 flex flex-col gap-2">
                      <Label>Rate Basis</Label>
                      <Select
                        value={inputs.packagingBasis}
                        onChange={(v) => set("packagingBasis", v as Inputs["packagingBasis"])}
                        options={["Per Quintal", "Per 50kg bag"]}
                      />
                      <Label>Rate (INR)</Label>
                      <NumInput value={inputs.packagingRate} onChange={(v) => set("packagingRate", v)} placeholder="120" />
                      <AnimatePresence initial={false}>
                        {inputs.packagingRate && (
                          <motion.p
                            initial={{ height: 0, opacity: 0, marginTop: 0 }}
                            animate={{ height: "auto", opacity: 1, marginTop: 4 }}
                            exit={{ height: 0, opacity: 0, marginTop: 0 }}
                            className="text-[11px] text-slate-400 font-mono overflow-hidden"
                          >
                            ₹{fmt(result.packPerKg, 4)}/kg · Total: <AnimatedNumber value={result.totalPackaging} format={fmtINR} />
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                ) : (
                  <motion.p
                    key="pkg-off"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[11px] text-slate-300 font-mono mt-2"
                  >
                    ₹0.0000/kg · excluded from ledger
                  </motion.p>
                )}
              </AnimatePresence>
            </InputCard>

            {/* Target Margin */}
            <InputCard icon={<TrendingUp className="w-3.5 h-3.5" />} title="Target Profit Margin">
              <Label>Fixed Margin (INR/kg)</Label>
              <NumInput value={inputs.targetMargin} onChange={(v) => set("targetMargin", v)} placeholder="1.40" />
              {inputs.targetMargin && result.subtotalPerKg > 0 && (
                <div className="mt-2">
                  <div className="flex justify-between items-center text-[11px] font-semibold text-emerald-500 font-mono mb-1">
                    <span>
                      <AnimatedNumber value={marginPct} format={(v) => fmt(v, 1)} />% margin on cost
                    </span>
                    <span>
                      <AnimatedNumber value={result.totalMargin} format={fmtINR} /> profit
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      className="bg-emerald-500 h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(marginPct, 100)}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                </div>
              )}
            </InputCard>

            {/* Buyer Cap */}
            <div className="bg-white border border-dashed border-slate-200 rounded-lg p-4 transition-all duration-300 hover:shadow-md hover:border-slate-300">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className={`w-3.5 h-3.5 ${result.exceedsCap && hasData ? "text-red-500" : "text-slate-300"}`} />
                <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">Buyer Cap / Alert Threshold</span>
              </div>
              <Label>Max Selling Price (INR/kg)</Label>
              <NumInput
                value={inputs.buyerCap}
                onChange={(v) => set("buyerCap", v)}
                placeholder="22.00"
                alert={result.exceedsCap && hasData}
              />
              <p className="text-[11px] text-slate-400 mt-1.5">Red alert if selling price exceeds this cap.</p>
            </div>
          </aside>

          {/* ── RIGHT PANEL ────────────────────────────────────────────── */}
          <div className="flex flex-col gap-6">

            {/* KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KPICard
                label="Cost/kg"
                value={<>₹<AnimatedNumber value={result.subtotalPerKg} format={(v) => fmt(v)} /></>}
                sub={<><AnimatedNumber value={result.totalSubtotal} format={fmtINR} /> total</>}
              />
              <KPICard
                label="Net Margin"
                value={<>₹<AnimatedNumber value={result.marginPerKg} format={(v) => fmt(v)} /></>}
                sub={<><AnimatedNumber value={marginPct} format={(v) => fmt(v, 1)} />% on cost</>}
                accent
              />
              <KPICard
                label="Selling/kg"
                value={<>₹<AnimatedNumber value={result.sellingPerKg} format={(v) => fmt(v)} /></>}
                sub={inputs.buyerCap ? `Cap: ₹${inputs.buyerCap}/kg` : undefined}
                warn={result.exceedsCap && hasData}
              />
              <KPICard
                label="Grand Total"
                value={<AnimatedNumber value={result.grandTotal} format={fmtINR} />}
                sub={<>{fmt(result.volumeMT, 1)} MT deal</>}
                accent={!result.exceedsCap}
                warn={result.exceedsCap && hasData}
              />
            </div>

            {/* Cost Stack Breakdown Bar */}
            {hasData && (
              <div className="bg-white border border-slate-100 rounded-lg p-4 shadow-sm hover:shadow-md hover:border-slate-200 transition-all duration-300">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">Cost Stack Breakdown</span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Selling Price: ₹<AnimatedNumber value={result.sellingPerKg} format={(v) => fmt(v)} />/kg
                  </span>
                </div>
                <div className="h-6 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                  {/* Procurement */}
                  <motion.div
                    className="bg-emerald-600 h-full"
                    animate={{ width: `${(result.procPerKg / result.sellingPerKg) * 100}%` }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  />
                  {/* Freight */}
                  <motion.div
                    className="bg-sky-500 h-full"
                    animate={{ width: `${(result.freightPerKg / result.sellingPerKg) * 100}%` }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  />
                  {/* Packaging */}
                  {inputs.packagingEnabled && (
                    <motion.div
                      className="bg-amber-500 h-full"
                      animate={{ width: `${(result.packPerKg / result.sellingPerKg) * 100}%` }}
                      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    />
                  )}
                  {/* Margin */}
                  <motion.div
                    className="bg-teal-400 h-full"
                    animate={{ width: `${(result.marginPerKg / result.sellingPerKg) * 100}%` }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
                {/* Legend */}
                <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-[12px]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded bg-emerald-600 inline-block" />
                    <span className="text-slate-500">Procurement:</span>
                    <span className="font-semibold text-slate-700 font-mono">
                      <AnimatedNumber value={(result.procPerKg / result.sellingPerKg) * 100} format={(v) => fmt(v, 1)} />%
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded bg-sky-500 inline-block" />
                    <span className="text-slate-500">Freight:</span>
                    <span className="font-semibold text-slate-700 font-mono">
                      <AnimatedNumber value={(result.freightPerKg / result.sellingPerKg) * 100} format={(v) => fmt(v, 1)} />%
                    </span>
                  </div>
                  {inputs.packagingEnabled && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded bg-amber-500 inline-block" />
                      <span className="text-slate-500">Packaging:</span>
                      <span className="font-semibold text-slate-700 font-mono">
                        <AnimatedNumber value={(result.packPerKg / result.sellingPerKg) * 100} format={(v) => fmt(v, 1)} />%
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded bg-teal-400 inline-block" />
                    <span className="text-slate-500">Margin:</span>
                    <span className="font-semibold text-slate-700 font-mono">
                      <AnimatedNumber value={(result.marginPerKg / result.sellingPerKg) * 100} format={(v) => fmt(v, 1)} />%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Comparison Engine */}
            <div>
              <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate-400 mb-3">Live Comparison Engine</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Baseline Card */}
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden transition-all duration-300 hover:shadow-md hover:border-slate-300">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-[12px] font-bold uppercase tracking-wider text-slate-500">Demo Baseline</span>
                    <span className="text-[11px] font-mono text-slate-400 bg-slate-200 px-2 py-0.5 rounded-full">100 MT · ₹18.80/kg</span>
                  </div>
                  <div className="p-4 space-y-2">
                    {[
                      { label: "Procurement", val: <><AnimatedNumber value={demoResult.procPerKg} format={(v) => "₹" + fmt(v)} />/kg</> },
                      { label: "Freight (FOR)", val: <><AnimatedNumber value={demoResult.freightPerKg} format={(v) => "₹" + fmt(v)} />/kg</> },
                      { label: "Packaging", val: <><AnimatedNumber value={demoResult.packPerKg} format={(v) => "₹" + fmt(v)} />/kg</> },
                      { label: "Cost Stack", val: <><AnimatedNumber value={demoResult.subtotalPerKg} format={(v) => "₹" + fmt(v)} />/kg</>, bold: true },
                      { label: "Margin", val: <><AnimatedNumber value={demoResult.marginPerKg} format={(v) => "₹" + fmt(v)} />/kg</>, green: true },
                    ].map(({ label, val, bold, green }) => (
                      <div key={label} className="flex justify-between items-center">
                        <span className={`text-[13px] ${bold ? "font-semibold text-slate-700" : "text-slate-500"}`}>{label}</span>
                        <span className={`font-mono text-[13px] font-semibold ${green ? "text-emerald-500" : bold ? "text-slate-800" : "text-slate-600"}`}>{val}</span>
                      </div>
                    ))}
                    <div className="border-t border-slate-200 pt-2 mt-1 flex justify-between items-center">
                      <span className="text-[13px] font-bold text-slate-800">Selling Price</span>
                      <span className="font-mono text-[15px] font-bold text-slate-900">
                        ₹<AnimatedNumber value={demoResult.sellingPerKg} format={(v) => fmt(v)} />/kg
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-slate-400">Grand Total</span>
                      <span className="font-mono text-[13px] font-bold text-slate-600">
                        <AnimatedNumber value={demoResult.grandTotal} format={fmtINR} />
                      </span>
                    </div>
                  </div>
                </div>

                {/* Live Card */}
                <motion.div
                  animate={{
                    borderColor: result.exceedsCap && hasData
                      ? "rgba(239, 68, 68, 0.8)"  // red-500
                      : hasData
                      ? "rgba(16, 185, 129, 0.8)" // emerald-500
                      : "rgba(226, 232, 240, 1)",  // slate-200
                    boxShadow: result.exceedsCap && hasData
                      ? "0 10px 15px -3px rgba(254, 226, 226, 0.7), 0 4px 6px -4px rgba(254, 226, 226, 0.7)" // red shadow
                      : hasData
                      ? "0 10px 15px -3px rgba(209, 250, 229, 0.7), 0 4px 6px -4px rgba(209, 250, 229, 0.7)" // emerald shadow
                      : "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)", // default shadow
                  }}
                  transition={{ duration: 0.4 }}
                  className="border rounded-lg overflow-hidden bg-white hover:border-slate-300 transition-all duration-300"
                >
                  <div className={`px-4 py-3 border-b flex items-center justify-between transition-colors duration-300
                    ${result.exceedsCap && hasData
                      ? "bg-red-50 border-red-200"
                      : hasData
                      ? "bg-emerald-50 border-emerald-200"
                      : "bg-slate-50 border-slate-200"
                    }`}>
                    <span className={`text-[12px] font-bold uppercase tracking-wider
                      ${result.exceedsCap && hasData ? "text-red-600" : hasData ? "text-emerald-600" : "text-slate-400"}`}>
                      {hasData ? "Live Calculation" : "Awaiting Input"}
                    </span>
                    {result.exceedsCap && hasData && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                        <AlertTriangle className="w-3 h-3 text-red-500" /> Over Cap
                      </span>
                    )}
                    {!result.exceedsCap && hasData && (
                      <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">
                        ✓ Within cap
                      </span>
                    )}
                  </div>
                  <div className={`p-4 space-y-2 ${hasData ? "" : "opacity-40"}`}>
                    {[
                      { label: "Procurement", val: <><AnimatedNumber value={result.procPerKg} format={(v) => "₹" + fmt(v)} />/kg</> },
                      { label: `Freight (${inputs.freightMode})`, val: <><AnimatedNumber value={result.freightPerKg} format={(v) => "₹" + fmt(v)} />/kg</> },
                      { label: inputs.packagingEnabled ? "Packaging" : "Packaging (off)", val: <><AnimatedNumber value={result.packPerKg} format={(v) => "₹" + fmt(v)} />/kg</>, muted: !inputs.packagingEnabled },
                      { label: "Cost Stack", val: <><AnimatedNumber value={result.subtotalPerKg} format={(v) => "₹" + fmt(v)} />/kg</>, bold: true },
                      { label: "Margin", val: <><AnimatedNumber value={result.marginPerKg} format={(v) => "₹" + fmt(v)} />/kg</>, green: !result.exceedsCap && hasData, red: result.exceedsCap && hasData },
                    ].map(({ label, val, bold, green, red, muted }) => (
                      <div key={label} className="flex justify-between items-center">
                        <span className={`text-[13px] ${bold ? "font-semibold text-slate-700" : muted ? "text-slate-300" : "text-slate-500"}`}>{label}</span>
                        <span className={`font-mono text-[13px] font-semibold
                          ${red ? "text-red-500" : green ? "text-emerald-500" : bold ? "text-slate-800" : muted ? "text-slate-300" : "text-slate-600"}`}>
                          {val}
                        </span>
                      </div>
                    ))}
                    <div className={`border-t pt-2 mt-1 flex justify-between items-center
                      ${result.exceedsCap && hasData ? "border-red-200" : "border-slate-200"}`}>
                      <span className="text-[13px] font-bold text-slate-800">Selling Price</span>
                      <span className={`font-mono text-[15px] font-bold
                        ${result.exceedsCap && hasData ? "text-red-600" : "text-slate-900"}`}>
                        ₹<AnimatedNumber value={result.sellingPerKg} format={(v) => fmt(v)} />/kg
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-slate-400">Grand Total</span>
                      <span className={`font-mono text-[13px] font-bold
                        ${result.exceedsCap && hasData ? "text-red-500" : "text-emerald-600"}`}>
                        <AnimatedNumber value={result.grandTotal} format={fmtINR} />
                      </span>
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>

            {/* Master Invoice Ledger */}
            <div>
              <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate-400 mb-3">Master Invoice Ledger</h2>
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden transition-all duration-300 hover:shadow-md hover:border-slate-300">
                <table className="w-full text-[13px] border-collapse">
                  <thead>
                    <tr className="bg-[#0F172A]">
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-[35%]">Component</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-[20%]">Unit Basis</th>
                      <th className="text-right px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-[20%]">Rate / kg</th>
                      <th className="text-right px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-[25%]">Total (INR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Procurement */}
                    <tr className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-700">
                        <div className="flex items-center gap-2">
                          <Wheat className="w-3.5 h-3.5 text-slate-300" />
                          Rice Procurement
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono">{inputs.procUnit || "INR/kg"}</td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-slate-700">
                        ₹<AnimatedNumber value={result.procPerKg} format={(v) => fmt(v, 4)} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">
                        {hasData ? <AnimatedNumber value={result.totalProcurement} format={fmtINR} /> : "—"}
                      </td>
                    </tr>

                    {/* Freight */}
                    <tr className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-700">
                        <div className="flex items-center gap-2">
                          <Truck className="w-3.5 h-3.5 text-slate-300" />
                          Freight / Logistics
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono">{inputs.freightRate}</td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-slate-700">
                        ₹<AnimatedNumber value={result.freightPerKg} format={(v) => fmt(v, 4)} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">
                        {hasData ? <AnimatedNumber value={result.totalFreight} format={fmtINR} /> : "—"}
                      </td>
                    </tr>

                    {/* Packaging */}
                    <tr className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                      <td className={`px-4 py-3 font-medium ${inputs.packagingEnabled ? "text-slate-700" : "text-slate-300"}`}>
                        <div className="flex items-center gap-2">
                          <Package className="w-3.5 h-3.5 text-slate-300" />
                          Packaging
                          {!inputs.packagingEnabled && (
                            <span className="text-[10px] bg-slate-100 text-slate-400 rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider">off</span>
                          )}
                        </div>
                      </td>
                      <td className={`px-4 py-3 font-mono ${inputs.packagingEnabled ? "text-slate-500" : "text-slate-300"}`}>
                        {inputs.packagingEnabled ? inputs.packagingBasis : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-medium ${inputs.packagingEnabled ? "text-slate-700" : "text-slate-300"}`}>
                        ₹<AnimatedNumber value={result.packPerKg} format={(v) => fmt(v, 4)} />
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${inputs.packagingEnabled ? "text-slate-800" : "text-slate-300"}`}>
                        {inputs.packagingEnabled && hasData ? <AnimatedNumber value={result.totalPackaging} format={fmtINR} /> : "₹0"}
                      </td>
                    </tr>

                    {/* Divider: Subtotal */}
                    <tr className="bg-slate-50 border-y border-slate-200">
                      <td className="px-4 py-3 font-bold text-slate-800 col-span-2">
                        <div className="flex items-center gap-2">
                          Subtotal — Cost Before Profit
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">
                        ₹<AnimatedNumber value={result.subtotalPerKg} format={(v) => fmt(v, 4)} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                        {hasData ? <AnimatedNumber value={result.totalSubtotal} format={fmtINR} /> : "—"}
                      </td>
                    </tr>

                    {/* Margin */}
                    <tr className="border-b border-emerald-100 bg-emerald-50/40 hover:bg-emerald-50/70 transition-colors">
                      <td className="px-4 py-3 font-semibold text-emerald-700">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                          Net Profit Margin
                          {result.subtotalPerKg > 0 && (
                            <span className="text-[10px] bg-emerald-100 text-emerald-600 rounded px-1.5 py-0.5 font-bold">
                              <AnimatedNumber value={marginPct} format={(v) => fmt(v, 1)} />%
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-emerald-600">INR/kg</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">
                        ₹<AnimatedNumber value={result.marginPerKg} format={(v) => fmt(v, 4)} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">
                        {hasData ? <AnimatedNumber value={result.totalMargin} format={fmtINR} /> : "—"}
                      </td>
                    </tr>

                    {/* Grand Total */}
                    <tr className={`border-t-2 transition-all duration-300
                      ${result.exceedsCap && hasData
                        ? "border-red-600 bg-red-600 text-white"
                        : "border-[#0F172A] bg-[#0F172A] text-white"
                      }`}
                    >
                      <td colSpan={2} className="px-4 py-4 text-[15px] font-bold uppercase tracking-wide">
                        {result.exceedsCap && hasData
                          ? "⚠ Grand Total — EXCEEDS CAP"
                          : "Grand Total / Selling Price"
                        }
                      </td>
                      <td className={`px-4 py-4 text-right font-mono text-[16px] font-bold
                        ${result.exceedsCap && hasData ? "text-white" : "text-emerald-400"}`}>
                        ₹<AnimatedNumber value={result.sellingPerKg} format={(v) => fmt(v, 4)} />
                        <span className="text-[12px] ml-0.5 opacity-70">/kg</span>
                      </td>
                      <td className="px-4 py-4 text-right font-mono text-[18px] font-bold">
                        {hasData ? <AnimatedNumber value={result.grandTotal} format={fmtINR} /> : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile roadmap notice */}
            <div className="border border-dashed border-slate-200 rounded-lg p-4 bg-white/60">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <BarChart3 className="w-4 h-4 text-slate-400" />
                </div>
                <div>
                  <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1">Flutter/Dart Mobile Roadmap</p>
                  <p className="text-[12px] text-slate-400 leading-relaxed">
                    Mobile layout: single-column scroll · Screen 1 inputs with FAB &rarr; Screen 2 bottom-sheet ledger.
                    Grand Total in Lakhs/Crores format with localized IN numbering. Component API mirrors this web schema.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
