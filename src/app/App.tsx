import { useState, useMemo, useRef, useEffect } from "react";
import {
  Save, ChevronDown, AlertTriangle, TrendingUp, Package,
  Truck, Wheat, RefreshCw, Zap,
  CheckCircle2, Activity, Download, Printer,
  Trash2, FolderOpen, Settings2, Copy, Check, HelpCircle,
  Share2, ChevronUp
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

  if (cur === "INR" && converted >= 10000000) return `${symbol}${fmt(converted / 10000000, 2)} Cr`;
  if (cur === "INR" && converted >= 100000) return `${symbol}${fmt(converted / 100000, 2)} L`;
  if (cur !== "INR" && converted >= 1000000) return `${symbol}${fmt(converted / 1000000, 2)} M`;
  if (converted >= 1000) return `${symbol}${fmt(converted / 1000, 1)} K`;
  return symbol + fmt(converted, 2);
}

// ── types ─────────────────────────────────────────────────────────────────────

interface FreightLeg {
  id: string;
  label: string;
  preset: string;
  mode: "FOR" | "Ex-Factory";
  rate: "Per Ton" | "Per kg" | "Flat Rate";
  amount: string;
}

interface Inputs {
  mode: "standard" | "reverse";
  commodity: string;
  customCommodity: string;
  volume: string;
  volumeUnit: "MT" | "kg" | "Quintal" | "Custom";
  customUnitLabel: string;
  customUnitKgFactor: string;
  procPrice: string;
  procUnit: "INR/kg" | "INR/MT";
  lossPct: string; // wastage/moisture loss factor
  freightLegs: FreightLeg[];
  packagingEnabled: boolean;
  packagingRate: string;
  packagingBasis: "Per Quintal" | "Per 50kg bag" | "Custom";
  packagingCustomDivisor: string;
  specAdjEnabled: boolean;
  specAdjMode: "premium" | "discount";
  specAdjBasis: "percent" | "flat";
  specAdjAmount: string;
  targetMargin: string;
  targetSellingPrice: string;
  buyerCap: string;
}

interface CalcResult {
  volumeMT: number; volumeKg: number;
  baseProcPerKg: number; specAdjPerKg: number; procPerKg: number; freightPerKg: number; packPerKg: number;
  subtotalPerKg: number; marginPerKg: number; sellingPerKg: number;
  totalProcurement: number; totalFreight: number; totalPackaging: number; totalSpecAdjustment: number;
  totalSubtotal: number; totalMargin: number; grandTotal: number;
  exceedsCap: boolean; marginPct: number;
  flatRateNeedsVolume: boolean;
  freightLegCosts: { id: string; perKg: number; total: number }[];
}

interface SavedDeal {
  id: string;
  refId: string;
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
  let volumeKg = 0;
  if (inp.volumeUnit === "MT") volumeKg = vol * 1000;
  else if (inp.volumeUnit === "Quintal") volumeKg = vol * 100;
  else if (inp.volumeUnit === "Custom") {
    const factor = parseFloat(inp.customUnitKgFactor) || 1;
    volumeKg = vol * factor;
  } else {
    volumeKg = vol;
  }
  const volumeMT = volumeKg / 1000;
  
  const rawProc = parseFloat(inp.procPrice) || 0;
  const baseProcPerKg = inp.procUnit === "INR/MT" ? rawProc / 1000 : rawProc;
  
  let adjustedBaseRate = baseProcPerKg;
  let specAdjPerKg = 0;
  if (inp.specAdjEnabled) {
    const amt = parseFloat(inp.specAdjAmount) || 0;
    const delta = inp.specAdjBasis === "percent" ? baseProcPerKg * (amt / 100) : amt;
    specAdjPerKg = inp.specAdjMode === "premium" ? delta : -delta;
    adjustedBaseRate = baseProcPerKg + specAdjPerKg;
  }
  
  // Adjust base procurement by wastage/loss factor
  const lossPctVal = parseFloat(inp.lossPct) || 0;
  const clampedLoss = Math.min(Math.max(lossPctVal, 0), 99.9);
  const procPerKg = adjustedBaseRate / (1 - clampedLoss / 100);

  let freightPerKg = 0;
  let flatRateNeedsVolume = false;
  const freightLegCosts = (inp.freightLegs || []).map((leg) => {
    const rawAmt = parseFloat(leg.amount) || 0;
    let legPerKg = 0;
    if (leg.rate === "Per Ton") legPerKg = rawAmt / 1000;
    else if (leg.rate === "Per kg") legPerKg = rawAmt;
    else legPerKg = volumeKg > 0 ? rawAmt / volumeKg : 0;
    
    if (leg.rate === "Flat Rate" && rawAmt > 0 && volumeKg === 0) {
      flatRateNeedsVolume = true;
    }
    
    return {
      id: leg.id,
      perKg: legPerKg,
      total: legPerKg * volumeKg,
    };
  });
  
  freightPerKg = freightLegCosts.reduce((acc, curr) => acc + curr.perKg, 0);

  const rawPack = parseFloat(inp.packagingRate) || 0;
  let packPerKg = 0;
  if (inp.packagingEnabled) {
    if (inp.packagingBasis === "Per Quintal") packPerKg = rawPack / 100;
    else if (inp.packagingBasis === "Per 50kg bag") packPerKg = rawPack / 50;
    else if (inp.packagingBasis === "Custom") {
      const div = parseFloat(inp.packagingCustomDivisor) || 1;
      packPerKg = rawPack / div;
    }
  }

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
  const totalSpecAdjustment = specAdjPerKg * volumeKg;
  const totalSubtotal = subtotalPerKg * volumeKg;
  const totalMargin = marginPerKg * volumeKg;
  const grandTotal = sellingPerKg * volumeKg;

  const cap = parseFloat(inp.buyerCap) || 0;
  const exceedsCap = cap > 0 && sellingPerKg > cap;
  const marginPct = subtotalPerKg > 0 ? (marginPerKg / subtotalPerKg) * 100 : 0;

  return {
    volumeMT, volumeKg, baseProcPerKg, specAdjPerKg, procPerKg, freightPerKg, packPerKg,
    subtotalPerKg, marginPerKg, sellingPerKg,
    totalProcurement, totalFreight, totalPackaging, totalSpecAdjustment,
    totalSubtotal, totalMargin, grandTotal, exceedsCap, marginPct,
    flatRateNeedsVolume, freightLegCosts
  };
}

// ── micro components ──────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-bold text-slate-500 block mb-1.5 select-none">
      {children}
    </span>
  );
}

function StyledSelect({ value, onChange, options, className = "" }: {
  value: string; onChange: (v: string) => void; options: string[]; className?: string;
}) {
  return (
    <div className={`relative flex-shrink-0 w-fit ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-[12px] font-semibold rounded-lg px-3 py-[8px] pr-7 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 focus:border-emerald-400 transition-all cursor-pointer"
      >
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
    </div>
  );
}

function NumInput({ value, onChange, placeholder = "0.00", alert = false, locked = false }: {
  value: string; onChange: (v: string) => void; placeholder?: string; alert?: boolean; locked?: boolean;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full text-[13px] font-medium rounded-lg px-3 py-[8px] focus:outline-none focus:ring-2 transition-all placeholder:text-slate-300
        ${alert
          ? "bg-amber-50 border border-amber-300 ring-1 ring-amber-200 text-amber-900 focus:ring-amber-300"
          : locked
          ? "bg-slate-50 border border-slate-200 text-slate-400 cursor-not-allowed select-none"
          : "bg-white border border-slate-200 focus:ring-emerald-400/50 focus:border-emerald-400 text-slate-800 hover:border-slate-300"
        }`}
    />
  );
}

// ── Accordion Card Item ───────────────────────────────────────────────────────

function AccordionCard({
  icon,
  title,
  subtitle,
  isOpen,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden transition-all duration-200">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors cursor-pointer text-left select-none"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100/60 flex items-center justify-center flex-shrink-0">
            {icon}
          </div>
          <div>
            <h3 className="text-[13px] font-bold text-slate-800 leading-tight">{title}</h3>
            {subtitle && <p className="text-[11px] text-slate-400 font-medium mt-0.5">{subtitle}</p>}
          </div>
        </div>
        <div className="text-slate-400 hover:text-slate-600 transition-colors">
          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
          >
            <div className="px-4 pb-4 pt-1 border-t border-slate-100 bg-white">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── defaults ──────────────────────────────────────────────────────────────────

const DEMO: Inputs = {
  mode: "standard",
  commodity: "Rice",
  customCommodity: "",
  volume: "100", volumeUnit: "MT",
  customUnitLabel: "bag",
  customUnitKgFactor: "50",
  procPrice: "18.80", procUnit: "INR/kg",
  lossPct: "2",
  freightLegs: [
    { id: "leg-1", label: "Mundra Port to Factory", preset: "Mundra Port to Factory", mode: "FOR", rate: "Per Ton", amount: "1800" }
  ],
  packagingEnabled: true, packagingRate: "120", packagingBasis: "Per Quintal",
  packagingCustomDivisor: "100",
  specAdjEnabled: false, specAdjMode: "premium", specAdjBasis: "percent", specAdjAmount: "",
  targetMargin: "1.40", targetSellingPrice: "", buyerCap: "22",
};

// ── App Component ─────────────────────────────────────────────────────────────

export default function App() {
  const [inp, setInp] = useState<Inputs>(DEMO);
  const [saveState, setSaveState] = useState<"idle" | "saved">("idle");
  const [dealName, setDealName] = useState("");
  const [currency, setCurrency] = useState<"INR" | "USD" | "EUR">("INR");
  const [liveRates, setLiveRates] = useState({ USD: 83.5, EUR: 91.0 });
  const [fxStatus, setFxStatus] = useState<"live" | "manual" | "failed">("live");
  const [showFxModal, setShowFxModal] = useState(false);
  const [fxRate, setFxRate] = useState<number>(1.0);
  const [savedDeals, setSavedDeals] = useState<SavedDeal[]>([]);
  const [copiedQuote, setCopiedQuote] = useState(false);

  // Accordion state
  const [openAccordions, setOpenAccordions] = useState<{ [key: string]: boolean }>({
    volume: false,
    freight: false,
    packaging: false,
    quality: false,
    margin: false,
  });

  const toggleAccordion = (key: string) => {
    setOpenAccordions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const currentRefId = `BBE-${new Date().getFullYear()}-${String(savedDeals.length + 1).padStart(4, "0")}`;

  // Load saved deals on mount
  useEffect(() => {
    try {
      const deals = localStorage.getItem("trade_matrix_deals");
      if (deals) setSavedDeals(JSON.parse(deals));
    } catch (e) {
      console.warn("Failed to load saved deals:", e);
    }
  }, []);

  // Fetch live exchange rates on mount and every 60s
  useEffect(() => {
    const fetchRates = () => {
      fetch("https://open.er-api.com/v6/latest/USD")
        .then((res) => res.json())
        .then((data) => {
          if (data && data.rates && data.rates.INR) {
            const usdToInr = data.rates.INR;
            const eurToInr = data.rates.INR / (data.rates.EUR || 0.92);
            setLiveRates((prev) => ({
              ...prev,
              USD: Number(usdToInr.toFixed(2)),
              EUR: Number(eurToInr.toFixed(2)),
            }));
            if (fxStatus !== "manual") setFxStatus("live");
          } else {
            setFxStatus("failed");
          }
        })
        .catch((err) => {
          console.error("Error fetching rates:", err);
          setFxStatus("failed");
        });
    };

    fetchRates();
    const interval = setInterval(fetchRates, 60000);
    return () => clearInterval(interval);
  }, [fxStatus]);

  useEffect(() => {
    if (currency === "USD") setFxRate(liveRates.USD);
    else if (currency === "EUR") setFxRate(liveRates.EUR);
    else setFxRate(1.0);
  }, [currency, liveRates]);

  function set<K extends keyof Inputs>(k: K, v: Inputs[K]) {
    setInp((p) => ({ ...p, [k]: v }));
  }

  function updateFreightLeg(index: number, key: keyof FreightLeg, value: string) {
    setInp((p) => {
      const nextLegs = [...p.freightLegs];
      const leg = { ...nextLegs[index], [key]: value };
      
      if (key === "preset" && value !== "Custom") {
        const preset = FREIGHT_PRESETS[value];
        if (preset) {
          leg.mode = preset.mode;
          leg.rate = preset.rate;
          leg.amount = preset.amount;
        }
      }
      nextLegs[index] = leg;
      return { ...p, freightLegs: nextLegs };
    });
  }

  const result = useMemo(() => calculate(inp), [inp]);
  const commName = inp.commodity === "Other" ? inp.customCommodity || "Commodity" : inp.commodity;

  // Sensitivity matrix calculation
  const sensitivityOffsets = [-0.1, -0.05, 0, 0.05, 0.1];
  const sensitivityData = useMemo(() => {
    return sensitivityOffsets.map((offset) => {
      const rawProc = parseFloat(inp.procPrice) || 0;
      const modifiedProcPrice = (rawProc * (1 + offset)).toFixed(2);
      const tempInp = { ...inp, procPrice: modifiedProcPrice };
      const tempRes = calculate(tempInp);
      return {
        labelStr: offset === 0 ? "• Now" : (offset > 0 ? `+${(offset * 100).toFixed(0)}%` : `${(offset * 100).toFixed(0)}%`),
        procPrice: modifiedProcPrice,
        subtotalPerKg: tempRes.subtotalPerKg,
        sellingPerKg: tempRes.sellingPerKg,
        marginPerKg: tempRes.marginPerKg,
        marginPct: tempRes.marginPct,
        isCurrent: offset === 0,
      };
    });
  }, [inp]);

  function handleSave() {
    const defaultName = `${commName} ${fmt(result.volumeMT, 1)} MT @ ₹${fmt(result.sellingPerKg, 2)}/kg`;
    const finalName = dealName.trim() || defaultName;
    const newDeal = {
      id: typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      refId: currentRefId,
      name: finalName,
      timestamp: Date.now(),
      inputs: inp,
    };
    const updated = [newDeal, ...savedDeals];
    setSavedDeals(updated);
    try {
      localStorage.setItem("trade_matrix_deals", JSON.stringify(updated));
    } catch (e) {
      console.warn("Failed to save deal:", e);
    }
    setSaveState("saved");
    setDealName("");
    setTimeout(() => setSaveState("idle"), 2000);
  }

  function handleCopyQuote() {
    const quoteText = 
`📊 TRADE MATRIX SUMMARY
Commodity: ${commName} (${fmt(result.volumeMT, 1)} MT)
---------------------------------
Procurement Rate: ${fmtCurrency(result.procPerKg, currency, fxRate)}/kg
Wastage / Loss: ${inp.lossPct || 0}%
Freight Cost: ${fmtCurrency(result.freightPerKg, currency, fxRate)}/kg
Packaging: ${inp.packagingEnabled ? fmtCurrency(result.packPerKg, currency, fxRate) + "/kg" : "N/A"}
---------------------------------
Total Cost: ${fmtCurrency(result.subtotalPerKg, currency, fxRate)}/kg
Selling Price: ${fmtCurrency(result.sellingPerKg, currency, fxRate)}/kg
Grand Total: ${fmtCurrencyShort(result.grandTotal, currency, fxRate)}
Net Profit: ${fmtCurrency(result.marginPerKg, currency, fxRate)}/kg (${fmt(result.marginPct, 1)}% margin)`;

    navigator.clipboard.writeText(quoteText);
    setCopiedQuote(true);
    setTimeout(() => setCopiedQuote(false), 2500);
  }

  function exportCSV() {
    const headers = ["Reference ID", "Component", "Unit Basis", `Rate/kg (${currency})`, `Total (${currency})`];
    const rows = [
      [currentRefId, `${commName} Procurement`, inp.procUnit, (result.procPerKg / fxRate).toFixed(4), (result.totalProcurement / fxRate).toFixed(2)],
      [currentRefId, "Freight & Logistics", "Legs", (result.freightPerKg / fxRate).toFixed(4), (result.totalFreight / fxRate).toFixed(2)],
      [currentRefId, "Packaging", inp.packagingEnabled ? inp.packagingBasis : "OFF", (result.packPerKg / fxRate).toFixed(4), (result.totalPackaging / fxRate).toFixed(2)],
      [currentRefId, "Cost Subtotal", "—", (result.subtotalPerKg / fxRate).toFixed(4), (result.totalSubtotal / fxRate).toFixed(2)],
      [currentRefId, "Profit / Margin", inp.mode === "reverse" ? "Calculated" : "Fixed", (result.marginPerKg / fxRate).toFixed(4), (result.totalMargin / fxRate).toFixed(2)],
      [currentRefId, "Selling Price", "—", (result.sellingPerKg / fxRate).toFixed(4), (result.grandTotal / fxRate).toFixed(2)]
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

  // Cost Composition Percentages
  const totalCostStack = result.subtotalPerKg + (result.marginPerKg > 0 ? result.marginPerKg : 0) || 1;
  const procPct = Math.round((result.procPerKg / totalCostStack) * 100);
  const logPct = Math.round((result.freightPerKg / totalCostStack) * 100);
  const packPct = Math.round((result.packPerKg / totalCostStack) * 100);
  const marginPctVal = result.marginPerKg > 0 ? Math.round((result.marginPerKg / totalCostStack) * 100) : 0;

  const diffCap = result.sellingPerKg - (parseFloat(inp.buyerCap) || 0);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800" style={{ fontFamily: "Inter, sans-serif" }}>

      {/* ── HEADER BAR ────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-slate-200/80 sticky top-0 z-40 shadow-xs">
        <div className="max-w-[1360px] mx-auto px-6 h-14 flex items-center justify-between gap-4">
          
          {/* Logo & Branding */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center text-white shadow-xs shadow-emerald-200">
              <Activity className="w-4 h-4" strokeWidth={2.5} />
            </div>
            <span className="font-extrabold text-[16px] tracking-tight text-slate-900">TradeMatrix</span>
          </div>

          {/* FX Rates Badge (Interactive for Live & Manual mode) */}
          <div className="relative">
            <button
              onClick={() => setShowFxModal(!showFxModal)}
              title="Click to view or edit exchange rates manually"
              className={`hidden md:flex items-center gap-2 border rounded-full px-3 py-1 text-[11px] font-mono shadow-2xs transition-all cursor-pointer hover:bg-slate-100 ${
                fxStatus === "live"
                  ? "bg-slate-50 border-slate-200/80"
                  : fxStatus === "manual"
                  ? "bg-blue-50 border-blue-200 text-blue-900"
                  : "bg-amber-50 border-amber-200 text-amber-900"
              }`}
            >
              <span className="relative flex h-2 w-2">
                {fxStatus === "live" ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </>
                ) : fxStatus === "manual" ? (
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                ) : (
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                )}
              </span>
              <span className="font-sans font-bold text-slate-500 text-[10.5px]">
                {fxStatus === "live" ? "Live FX:" : fxStatus === "manual" ? "Manual FX:" : "Manual (Offline):"}
              </span>
              <span className="font-semibold text-slate-800">₹1 = ${(1 / liveRates.USD).toFixed(4)}</span>
              <span className="text-slate-300">·</span>
              <span className="font-semibold text-slate-800">₹1 = €{(1 / liveRates.EUR).toFixed(4)}</span>
              <span className="text-slate-300">|</span>
              <span className="text-slate-400 text-[10px]">($1 = ₹{liveRates.USD})</span>
            </button>

            {/* FX Manual Rates Popover Modal */}
            <AnimatePresence>
              {showFxModal && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="absolute left-0 mt-2 w-72 bg-white rounded-xl border border-slate-200 shadow-xl p-4 z-50 text-[12px]"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
                    <span className="font-bold text-slate-800">Exchange Rates & Mode</span>
                    <button
                      onClick={() => setShowFxModal(false)}
                      className="text-slate-400 hover:text-slate-600 font-bold"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px] font-semibold">
                      <button
                        onClick={() => setFxStatus("live")}
                        className={`flex-1 py-1 rounded-md transition-all cursor-pointer ${
                          fxStatus === "live" ? "bg-white text-slate-800 shadow-2xs" : "text-slate-500"
                        }`}
                      >
                        Live (API)
                      </button>
                      <button
                        onClick={() => setFxStatus("manual")}
                        className={`flex-1 py-1 rounded-md transition-all cursor-pointer ${
                          fxStatus === "manual" || fxStatus === "failed" ? "bg-white text-slate-800 shadow-2xs" : "text-slate-500"
                        }`}
                      >
                        Manual Override
                      </button>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <label className="text-[11px] font-bold text-slate-500 block mb-1">1 USD ($) in INR (₹)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={liveRates.USD}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 1;
                            setLiveRates((prev) => ({ ...prev, USD: val }));
                            setFxStatus("manual");
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 font-mono font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        />
                        <span className="text-[10px] text-slate-400 font-mono">
                          Equiv: ₹1 = ${(1 / (liveRates.USD || 1)).toFixed(4)} USD
                        </span>
                      </div>

                      <div>
                        <label className="text-[11px] font-bold text-slate-500 block mb-1">1 EUR (€) in INR (₹)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={liveRates.EUR}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 1;
                            setLiveRates((prev) => ({ ...prev, EUR: val }));
                            setFxStatus("manual");
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 font-mono font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        />
                        <span className="text-[10px] text-slate-400 font-mono">
                          Equiv: ₹1 = €{(1 / (liveRates.EUR || 1)).toFixed(4)} EUR
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => setShowFxModal(false)}
                      className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-1.5 rounded-lg text-[12px] transition-colors cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-3">
            
            {/* Cost-Plus vs Target-Price Engine Toggle */}
            <div className="bg-slate-100 p-0.5 rounded-lg flex items-center border border-slate-200/80 text-[12px] font-semibold">
              <button
                onClick={() => set("mode", "standard")}
                className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                  inp.mode === "standard"
                    ? "bg-white text-slate-800 shadow-xs border border-slate-200/60"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Cost-Plus
              </button>
              <button
                onClick={() => set("mode", "reverse")}
                className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                  inp.mode === "reverse"
                    ? "bg-white text-slate-800 shadow-xs border border-slate-200/60"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Target-Price
              </button>
            </div>

            {/* Currency Pill Toggle */}
            <div className="bg-slate-100 p-0.5 rounded-lg flex items-center border border-slate-200/80 text-[11px] font-bold">
              {(["INR", "USD", "EUR"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                    currency === c
                      ? "bg-white text-slate-900 shadow-xs border border-slate-200/60"
                      : "text-slate-400 hover:text-slate-700"
                  }`}
                >
                  <span className="text-[9px] opacity-60 mr-1">{c === "INR" ? "IN" : c === "USD" ? "US" : "EU"}</span>
                  {c}
                </button>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1 border-l border-slate-200 pl-3">
              <button
                onClick={handleSave}
                title="Save Deal"
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4" />
              </button>
              <button
                onClick={handleCopyQuote}
                title="Share / Copy Quote"
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
              >
                {copiedQuote ? <Check className="w-4 h-4 text-emerald-600" /> : <Share2 className="w-4 h-4" />}
              </button>
              <button
                onClick={exportCSV}
                title="Export CSV"
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>

          </div>
        </div>
      </header>

      {/* ── TOP ALERT BANNER (If Buyer Cap Breached) ─────────────────────────── */}
      <AnimatePresence>
        {result.exceedsCap && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-amber-500 text-white font-semibold text-[13px] px-6 py-2.5 flex items-center justify-start gap-2 shadow-xs"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>
              Selling price exceeds buyer cap by {fmtCurrency(diffCap, currency, fxRate)}/kg
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MAIN WORKSPACE CONTAINER ─────────────────────────────────────────── */}
      <main className="max-w-[1360px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[480px_1fr] gap-6 items-start">

          {/* ════════════════════════════════════════════════════════════════
              LEFT COLUMN — ACCORDION INPUTS & COST COMPOSITION
          ════════════════════════════════════════════════════════════════ */}
          <aside className="flex flex-col gap-3">

            {/* 1. Commodity & Volume */}
            <AccordionCard
              icon={<Wheat className="w-4 h-4" />}
              title="Commodity & Volume"
              subtitle={`${inp.volume || "0"} ${inp.volumeUnit} of ${commName}`}
              isOpen={openAccordions.volume}
              onToggle={() => toggleAccordion("volume")}
            >
              <div className="space-y-3 pt-1">
                <div>
                  <FieldLabel>Commodity</FieldLabel>
                  <StyledSelect
                    value={inp.commodity}
                    onChange={(v) => set("commodity", v)}
                    options={["Rice", "Wheat", "Sugar", "Pulses", "Cotton", "Metals", "Chemicals", "Other"]}
                    className="w-full"
                  />
                </div>

                {inp.commodity === "Other" && (
                  <div>
                    <FieldLabel>Custom Commodity Name</FieldLabel>
                    <input
                      type="text"
                      value={inp.customCommodity}
                      onChange={(e) => set("customCommodity", e.target.value)}
                      placeholder="e.g. Soybeans"
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <FieldLabel>Volume</FieldLabel>
                    <NumInput value={inp.volume} onChange={(v) => set("volume", v)} placeholder="100" />
                  </div>
                  <div>
                    <FieldLabel>Unit</FieldLabel>
                    <StyledSelect
                      value={inp.volumeUnit}
                      onChange={(v) => set("volumeUnit", v as Inputs["volumeUnit"])}
                      options={["MT", "kg", "Quintal", "Custom"]}
                      className="w-full"
                    />
                  </div>
                </div>

                <div>
                  <FieldLabel>Procurement Rate ({inp.procUnit})</FieldLabel>
                  <div className="flex gap-2">
                    <NumInput value={inp.procPrice} onChange={(v) => set("procPrice", v)} placeholder="18.80" />
                    <StyledSelect
                      value={inp.procUnit}
                      onChange={(v) => set("procUnit", v as Inputs["procUnit"])}
                      options={["INR/kg", "INR/MT"]}
                    />
                  </div>
                </div>

                <div>
                  <FieldLabel>Wastage / Moisture Loss (%)</FieldLabel>
                  <NumInput value={inp.lossPct} onChange={(v) => set("lossPct", v)} placeholder="2.0" />
                </div>
              </div>
            </AccordionCard>

            {/* 2. Freight & Logistics */}
            <AccordionCard
              icon={<Truck className="w-4 h-4" />}
              title="Freight & Logistics"
              subtitle={`${inp.freightLegs.length} leg${inp.freightLegs.length > 1 ? "s" : ""} · ${fmtCurrency(result.freightPerKg, currency, fxRate)}/kg`}
              isOpen={openAccordions.freight}
              onToggle={() => toggleAccordion("freight")}
            >
              <div className="space-y-3 pt-1">
                {inp.freightLegs.map((leg, index) => (
                  <div key={leg.id} className="p-3 bg-slate-50 border border-slate-200/80 rounded-lg space-y-2 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-500 uppercase">Leg #{index + 1}</span>
                      {inp.freightLegs.length > 1 && (
                        <button
                          onClick={() => set("freightLegs", inp.freightLegs.filter((l) => l.id !== leg.id))}
                          className="text-red-500 hover:text-red-700 text-[11px] font-semibold flex items-center gap-0.5 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      )}
                    </div>
                    <div>
                      <FieldLabel>Leg Name</FieldLabel>
                      <input
                        type="text"
                        value={leg.label}
                        onChange={(e) => updateFreightLeg(index, "label", e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-[12px] font-medium"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <FieldLabel>Rate Basis</FieldLabel>
                        <StyledSelect
                          value={leg.rate}
                          onChange={(v) => updateFreightLeg(index, "rate", v as FreightLeg["rate"])}
                          options={["Per Ton", "Per kg", "Flat Rate"]}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <FieldLabel>Amount</FieldLabel>
                        <NumInput value={leg.amount} onChange={(v) => updateFreightLeg(index, "amount", v)} placeholder="1800" />
                      </div>
                    </div>
                  </div>
                ))}

                {inp.freightLegs.length < 3 && (
                  <button
                    onClick={() => set("freightLegs", [...inp.freightLegs, {
                      id: `leg-${Date.now()}`,
                      label: `Leg ${inp.freightLegs.length + 1}`,
                      preset: "Custom",
                      mode: "FOR",
                      rate: "Per Ton",
                      amount: "0",
                    }])}
                    className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[12px] font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    + Add Logistics Leg
                  </button>
                )}
              </div>
            </AccordionCard>

            {/* 3. Packaging */}
            <AccordionCard
              icon={<Package className="w-4 h-4" />}
              title="Packaging"
              subtitle={inp.packagingEnabled ? `${fmtCurrency(result.packPerKg, currency, fxRate)}/kg effective` : "Disabled"}
              isOpen={openAccordions.packaging}
              onToggle={() => toggleAccordion("packaging")}
            >
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-slate-700">Enable Packaging</span>
                  <button
                    onClick={() => set("packagingEnabled", !inp.packagingEnabled)}
                    className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${inp.packagingEnabled ? "bg-emerald-500" : "bg-slate-300"}`}
                  >
                    <span className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.75 transition-transform ${inp.packagingEnabled ? "right-0.75" : "left-0.75"}`} />
                  </button>
                </div>
                {inp.packagingEnabled && (
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <FieldLabel>Rate Basis</FieldLabel>
                    <StyledSelect
                      value={inp.packagingBasis}
                      onChange={(v) => set("packagingBasis", v as Inputs["packagingBasis"])}
                      options={["Per Quintal", "Per 50kg bag", "Custom"]}
                      className="w-full"
                    />
                    <FieldLabel>Rate (INR)</FieldLabel>
                    <NumInput value={inp.packagingRate} onChange={(v) => set("packagingRate", v)} placeholder="120" />
                  </div>
                )}
              </div>
            </AccordionCard>

            {/* 4. Quality Adjustment */}
            <AccordionCard
              icon={<Settings2 className="w-4 h-4" />}
              title="Quality Adjustment"
              subtitle={inp.specAdjEnabled ? `${inp.specAdjMode === "premium" ? "+" : "-"}${fmtCurrency(result.specAdjPerKg, currency, fxRate)}/kg` : "Disabled"}
              isOpen={openAccordions.quality}
              onToggle={() => toggleAccordion("quality")}
            >
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-slate-700">Enable Quality Adjustment</span>
                  <button
                    onClick={() => set("specAdjEnabled", !inp.specAdjEnabled)}
                    className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${inp.specAdjEnabled ? "bg-emerald-500" : "bg-slate-300"}`}
                  >
                    <span className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.75 transition-transform ${inp.specAdjEnabled ? "right-0.75" : "left-0.75"}`} />
                  </button>
                </div>
                {inp.specAdjEnabled && (
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <FieldLabel>Mode</FieldLabel>
                        <StyledSelect
                          value={inp.specAdjMode}
                          onChange={(v) => set("specAdjMode", v as Inputs["specAdjMode"])}
                          options={["premium", "discount"]}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <FieldLabel>Basis</FieldLabel>
                        <StyledSelect
                          value={inp.specAdjBasis}
                          onChange={(v) => set("specAdjBasis", v as Inputs["specAdjBasis"])}
                          options={["percent", "flat"]}
                          className="w-full"
                        />
                      </div>
                    </div>
                    <FieldLabel>Amount</FieldLabel>
                    <NumInput value={inp.specAdjAmount} onChange={(v) => set("specAdjAmount", v)} placeholder="2.50" />
                  </div>
                )}
              </div>
            </AccordionCard>

            {/* 5. Profit Margin */}
            <AccordionCard
              icon={<TrendingUp className="w-4 h-4" />}
              title="Profit Margin"
              subtitle={inp.mode === "reverse" ? `Target ${fmtCurrency(parseFloat(inp.targetSellingPrice) || 0, currency, fxRate)}/kg` : `${fmtCurrency(parseFloat(inp.targetMargin) || 0, currency, fxRate)}/kg margin`}
              isOpen={openAccordions.margin}
              onToggle={() => toggleAccordion("margin")}
            >
              <div className="space-y-3 pt-1">
                {inp.mode === "reverse" ? (
                  <div>
                    <FieldLabel>Target Selling Price (INR/kg)</FieldLabel>
                    <NumInput value={inp.targetSellingPrice} onChange={(v) => set("targetSellingPrice", v)} placeholder="23.08" />
                  </div>
                ) : (
                  <div>
                    <FieldLabel>Target Profit Margin (INR/kg)</FieldLabel>
                    <NumInput value={inp.targetMargin} onChange={(v) => set("targetMargin", v)} placeholder="1.40" />
                  </div>
                )}
                <div>
                  <FieldLabel>Buyer Price Cap Limit (INR/kg)</FieldLabel>
                  <NumInput value={inp.buyerCap} onChange={(v) => set("buyerCap", v)} placeholder="22.00" alert={result.exceedsCap} />
                </div>
              </div>
            </AccordionCard>

            {/* ── COST COMPOSITION CARD ───────────────────────────────────────── */}
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-3">
              <h3 className="text-[13px] font-bold text-slate-800">Cost Composition</h3>

              <div className="space-y-2.5 text-[12px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-[#1E293B]" />
                    <span className="font-medium text-slate-600">Procurement</span>
                  </div>
                  <div className="font-mono text-slate-700 font-semibold space-x-3">
                    <span>{fmtCurrency(result.procPerKg, currency, fxRate)}</span>
                    <span className="text-slate-400 text-[11px]">{procPct}%</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-[#3B82F6]" />
                    <span className="font-medium text-slate-600">Logistics</span>
                  </div>
                  <div className="font-mono text-slate-700 font-semibold space-x-3">
                    <span>{fmtCurrency(result.freightPerKg, currency, fxRate)}</span>
                    <span className="text-slate-400 text-[11px]">{logPct}%</span>
                  </div>
                </div>

                {inp.packagingEnabled && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-[#A855F7]" />
                      <span className="font-medium text-slate-600">Packaging</span>
                    </div>
                    <div className="font-mono text-slate-700 font-semibold space-x-3">
                      <span>{fmtCurrency(result.packPerKg, currency, fxRate)}</span>
                      <span className="text-slate-400 text-[11px]">{packPct}%</span>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-[#10B981]" />
                    <span className="font-medium text-slate-600">Margin</span>
                  </div>
                  <div className="font-mono text-slate-700 font-semibold space-x-3">
                    <span>{fmtCurrency(result.marginPerKg, currency, fxRate)}</span>
                    <span className="text-slate-400 text-[11px]">{marginPctVal}%</span>
                  </div>
                </div>
              </div>

              {/* Horizontal Multi-Segment Progress Bar */}
              <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden flex gap-0.5 pt-0.5">
                <div style={{ width: `${procPct}%` }} className="bg-[#1E293B] h-full rounded-l-full" />
                <div style={{ width: `${logPct}%` }} className="bg-[#3B82F6] h-full" />
                {inp.packagingEnabled && <div style={{ width: `${packPct}%` }} className="bg-[#A855F7] h-full" />}
                <div style={{ width: `${marginPctVal}%` }} className="bg-[#10B981] h-full rounded-r-full" />
              </div>
            </div>

          </aside>

          {/* ════════════════════════════════════════════════════════════════
              RIGHT COLUMN — HERO SUMMARY, COMMERCIAL LEDGER, SENSITIVITY
          ════════════════════════════════════════════════════════════════ */}
          <div className="flex flex-col gap-5">

            {/* ── 1. HERO DEAL SUMMARY CARD ──────────────────────────────────── */}
            <div className={`bg-white rounded-xl border p-5 shadow-xs transition-all relative overflow-hidden ${
              result.exceedsCap ? "border-amber-300 ring-2 ring-amber-200/50" : "border-slate-200/90"
            }`}>
              
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                <div>
                  <span className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                    {commName} - {fmt(result.volumeMT, 0)} MT - IN {currency}
                  </span>
                  <h2 className="text-[16px] font-extrabold text-slate-800 leading-tight">Deal Summary</h2>
                </div>

                {result.exceedsCap && (
                  <span className="px-2.5 py-0.5 bg-amber-50 text-amber-600 border border-amber-200/80 text-[11px] font-bold rounded-full flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Cap Breached
                  </span>
                )}
              </div>

              {/* 4 Metric Columns */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">COST / KG</span>
                  <span className="font-mono text-[22px] font-bold text-slate-900 block leading-none">
                    {fmtCurrency(result.subtotalPerKg, currency, fxRate)}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">SELLING / KG</span>
                  <span className="font-mono text-[22px] font-bold text-amber-600 block leading-none">
                    {fmtCurrency(result.sellingPerKg, currency, fxRate)}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">PROFIT / KG</span>
                  <span className="font-mono text-[22px] font-bold text-emerald-600 block leading-none">
                    {fmtCurrency(result.marginPerKg, currency, fxRate)}
                  </span>
                  <span className="text-[11px] font-medium text-emerald-600 mt-1 block">
                    {fmt(result.marginPct, 1)}% margin
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">DEAL VALUE</span>
                  <span className="font-mono text-[22px] font-bold text-slate-900 block leading-none">
                    {fmtCurrencyShort(result.grandTotal, currency, fxRate)}
                  </span>
                </div>
              </div>
            </div>

            {/* ── 2. COMMERCIAL LEDGER TABLE ──────────────────────────────────── */}
            <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs">
              <div className="mb-4">
                <h3 className="text-[14px] font-bold text-slate-800">Commercial Ledger</h3>
                <p className="text-[11px] text-slate-400 font-medium">Per-unit and aggregate breakdown</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12.5px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="pb-2.5">LINE ITEM</th>
                      <th className="pb-2.5 text-right">PER KG</th>
                      <th className="pb-2.5 text-right">PER MT</th>
                      <th className="pb-2.5 text-right">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    
                    {/* Procurement */}
                    <tr>
                      <td className="py-2.5 font-sans font-medium text-slate-700">Procurement</td>
                      <td className="py-2.5 text-right text-slate-700">{fmtCurrency(result.procPerKg, currency, fxRate)}</td>
                      <td className="py-2.5 text-right text-slate-500">{fmtCurrency(result.procPerKg * 1000, currency, fxRate)}</td>
                      <td className="py-2.5 text-right text-slate-700">{fmtCurrencyShort(result.totalProcurement, currency, fxRate)}</td>
                    </tr>

                    {/* Quality Adjustment */}
                    {inp.specAdjEnabled && (
                      <tr>
                        <td className="py-2.5 font-sans font-medium text-slate-700">Quality Adjustment</td>
                        <td className="py-2.5 text-right text-slate-700">{fmtCurrency(result.specAdjPerKg, currency, fxRate)}</td>
                        <td className="py-2.5 text-right text-slate-500">{fmtCurrency(result.specAdjPerKg * 1000, currency, fxRate)}</td>
                        <td className="py-2.5 text-right text-slate-700">{fmtCurrencyShort(result.totalSpecAdjustment, currency, fxRate)}</td>
                      </tr>
                    )}

                    {/* Freight & Logistics */}
                    <tr>
                      <td className="py-2.5 font-sans font-medium text-slate-700">Freight & Logistics</td>
                      <td className="py-2.5 text-right text-slate-700">{fmtCurrency(result.freightPerKg, currency, fxRate)}</td>
                      <td className="py-2.5 text-right text-slate-500">{fmtCurrency(result.freightPerKg * 1000, currency, fxRate)}</td>
                      <td className="py-2.5 text-right text-slate-700">{fmtCurrencyShort(result.totalFreight, currency, fxRate)}</td>
                    </tr>

                    {/* Packaging */}
                    {inp.packagingEnabled && (
                      <tr>
                        <td className="py-2.5 font-sans font-medium text-slate-700">Packaging</td>
                        <td className="py-2.5 text-right text-slate-700">{fmtCurrency(result.packPerKg, currency, fxRate)}</td>
                        <td className="py-2.5 text-right text-slate-500">{fmtCurrency(result.packPerKg * 1000, currency, fxRate)}</td>
                        <td className="py-2.5 text-right text-slate-700">{fmtCurrencyShort(result.totalPackaging, currency, fxRate)}</td>
                      </tr>
                    )}

                    {/* Cost Subtotal */}
                    <tr className="font-bold bg-slate-50/50">
                      <td className="py-2.5 font-sans text-slate-800">Cost Subtotal</td>
                      <td className="py-2.5 text-right text-slate-900">{fmtCurrency(result.subtotalPerKg, currency, fxRate)}</td>
                      <td className="py-2.5 text-right text-slate-700">{fmtCurrency(result.subtotalPerKg * 1000, currency, fxRate)}</td>
                      <td className="py-2.5 text-right text-slate-900">{fmtCurrencyShort(result.totalSubtotal, currency, fxRate)}</td>
                    </tr>

                    {/* Profit / Margin */}
                    <tr className="font-bold">
                      <td className="py-2.5 font-sans text-emerald-600">Profit / Margin</td>
                      <td className="py-2.5 text-right text-emerald-600">{fmtCurrency(result.marginPerKg, currency, fxRate)}</td>
                      <td className="py-2.5 text-right text-emerald-600">{fmtCurrency(result.marginPerKg * 1000, currency, fxRate)}</td>
                      <td className="py-2.5 text-right text-emerald-600">{fmtCurrencyShort(result.totalMargin, currency, fxRate)}</td>
                    </tr>

                    {/* Selling Price */}
                    <tr className="font-bold text-[13px] bg-slate-50">
                      <td className="py-3 font-sans text-amber-600">Selling Price</td>
                      <td className="py-3 text-right text-amber-600">{fmtCurrency(result.sellingPerKg, currency, fxRate)}</td>
                      <td className="py-3 text-right text-slate-700">{fmtCurrency(result.sellingPerKg * 1000, currency, fxRate)}</td>
                      <td className="py-3 text-right text-amber-600">{fmtCurrencyShort(result.grandTotal, currency, fxRate)}</td>
                    </tr>

                  </tbody>
                </table>
              </div>
            </div>

            {/* ── 3. SENSITIVITY ANALYSIS CARD ───────────────────────────────── */}
            <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs">
              <div className="mb-4">
                <h3 className="text-[14px] font-bold text-slate-800">Sensitivity Analysis</h3>
                <p className="text-[11px] text-slate-400 font-medium">Profit at ±10% procurement variance</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px] border-collapse font-mono">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="pb-2">VARIANCE</th>
                      <th className="pb-2 text-right">PROC. RATE</th>
                      <th className="pb-2 text-right">TOTAL COST</th>
                      <th className="pb-2 text-right">SELL PRICE</th>
                      <th className="pb-2 text-right">PROFIT/KG</th>
                      <th className="pb-2 text-right">MARGIN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sensitivityData.map((row) => (
                      <tr key={row.labelStr} className={row.isCurrent ? "bg-slate-50 font-bold" : ""}>
                        <td className={`py-2 ${row.isCurrent ? "text-slate-900" : "text-slate-500"}`}>{row.labelStr}</td>
                        <td className="py-2 text-right text-slate-600">{fmtCurrency(parseFloat(row.procPrice), currency, fxRate)}</td>
                        <td className="py-2 text-right text-slate-600">{fmtCurrency(row.subtotalPerKg, currency, fxRate)}</td>
                        <td className="py-2 text-right text-slate-800">{fmtCurrency(row.sellingPerKg, currency, fxRate)}</td>
                        <td className="py-2 text-right text-emerald-600 font-semibold">{fmtCurrency(row.marginPerKg, currency, fxRate)}</td>
                        <td className="py-2 text-right text-emerald-600 font-semibold">{fmt(row.marginPct, 1)}%</td>
                      </tr>
                    ))}
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
