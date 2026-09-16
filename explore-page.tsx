"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { GripVertical, Plus, Save, Table2, Trash2, X } from "lucide-react";
import { api, useApi } from "@/lib/client";
import { PRESETS, resolvePreset, type DatePreset } from "@/lib/dates";
import { fmtDateRange } from "@/lib/format";
import type { ColumnMeta, Condition, Metric, QueryContext, QueryResult, WidgetConfig } from "@/lib/widget-types";
import { Button, ErrorBox, Field, Input, Modal, Segmented, Select, Spinner, Toggle, useToast } from "@/components/ui";
import { WidgetBody } from "@/components/dashboard/WidgetCard";
import { DateRangePicker, DimensionFilter } from "@/components/dashboard/FilterBar";

type Dataset = {
  id: string; slug: string; name: string; columns: ColumnMeta[]; status: string;
  settings: { dateColumn?: string | null; keyColumn?: string | null; exclusions?: { id: string; label: string; values: string[]; defaultOn: boolean }[] };
};
type Layout = { id: string; name: string; dataset_id: string; config: SavedLayout; visibility: string; owner_id: string; owner_name: string };
type Dash = { id: string; name: string };

/** A field is either a dimension (rows/columns/filters) or a measure (values). */
type Field = { id: string; label: string; kind: "dim" | "measure"; column?: string; grain?: "day" | "week" | "month" | "quarter" | "year"; metric?: Metric };
type Zone = "rows" | "cols" | "filters" | "values";
type SavedLayout = { rows?: string; cols?: string; values?: string; filters?: string[]; preset?: DatePreset; custom?: { from?: string; to?: string } };

const timeGrains: { id: NonNullable<Field["grain"]>; label: string }[] = [
  { id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" }, { id: "year", label: "Year" },
];

function buildFields(ds: Dataset): Field[] {
  const out: Field[] = [];
  const dateCol = ds.settings?.dateColumn;
  if (dateCol) for (const g of timeGrains) out.push({ id: `date:${g.id}`, label: g.label, kind: "dim", column: dateCol, grain: g.id });
  for (const c of ds.columns) {
    if (c.type === "text" && c.name !== dateCol) out.push({ id: `dim:${c.name}`, label: c.label, kind: "dim", column: c.name });
    else if ((c.type === "date" || c.type === "timestamp") && c.name !== dateCol) out.push({ id: `dim:${c.name}`, label: c.label, kind: "dim", column: c.name });
  }
  const key = ds.settings?.keyColumn || ds.columns.find((c) => /player|user|customer/i.test(c.name))?.name;
  if (key) out.push({ id: "m:count_key", label: `Distinct ${ds.columns.find((c) => c.name === key)?.label || key}`, kind: "measure",
    metric: { id: "m", label: "Distinct", agg: "count_distinct", column: key } });
  out.push({ id: "m:rows", label: "Row count", kind: "measure", metric: { id: "m", label: "Rows", agg: "count" } });
  for (const c of ds.columns) {
    if (c.type !== "number") continue;
    out.push({ id: `m:sum:${c.name}`, label: `${c.label} (sum)`, kind: "measure",
      metric: { id: "m", label: c.label, agg: "sum", column: c.name, format: /ftd|deposit|ggr|ngr|cost|withdraw|bet|amount|revenue/i.test(c.name) ? "currency" : "number" } });
    if (key) out.push({ id: `m:who:${c.name}`, label: `Players with ${c.label} > 0`, kind: "measure",
      metric: { id: "m", label: `${c.label} players`, agg: "count_distinct", column: key, where: [{ column: c.name, op: "gt", value: 0 }] } });
  }
  return out;
}

export default function ExplorePage() {
  return <Suspense fallback={<Spinner />}><Explore /></Suspense>;
}

function Explore() {
  const toast = useToast();
  const datasets = useApi<{ datasets: Dataset[] }>("/api/datasets");
  const layouts = useApi<{ layouts: Layout[] }>("/api/layouts");
  const dashboards = useApi<{ dashboards: Dash[] }>("/api/dashboards");
  const [dsId, setDsId] = useState("");
  const [rows, setRows] = useState<string | null>(null);
  const [cols, setCols] = useState<string | null>(null);
  const [values, setValues] = useState<string | null>(null);
  const [filters, setFilters] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [preset, setPreset] = useState<DatePreset>("last90");
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [excl, setExcl] = useState<string[] | null>(null);
  const [res, setRes] = useState<QueryResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<Field | null>(null);
  const [over, setOver] = useState<Zone | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const ready = useMemo(() => (datasets.data?.datasets || []).filter((d) => d.status !== "empty"), [datasets.data]);
  const ds = ready.find((d) => d.id === dsId);
  const fields = useMemo(() => (ds ? buildFields(ds) : []), [ds]);
  const byId = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);

  useEffect(() => {
    if (!dsId && ready[0]) setDsId(ready[0].id);
  }, [ready, dsId]);
  useEffect(() => {
    if (!ds || rows || cols || values) return;
    const f = buildFields(ds);
    setRows(f.find((x) => x.id === "date:month")?.id || f.find((x) => x.kind === "dim")?.id || null);
    setValues(f.find((x) => x.kind === "measure")?.id || null);
  }, [ds, rows, cols, values]);

  const activeExcl = excl ?? (ds?.settings?.exclusions || []).filter((e) => e.defaultOn).map((e) => e.id);
  const range = resolvePreset(preset, custom);

  const config: WidgetConfig | null = useMemo(() => {
    if (!ds || !rows || !values) return null;
    const rowF = byId.get(rows), colF = cols ? byId.get(cols) : null, valF = byId.get(values);
    if (!rowF?.column || !valF?.metric) return null;
    return {
      kind: colF?.column ? "pivot" : "table",
      datasetId: ds.id,
      metrics: [{ ...valF.metric, label: valF.label }],
      dimension: { column: rowF.column, grain: rowF.grain || "auto" },
      breakdown: colF?.column ? { column: colF.column, limit: 25 } : null,
      sort: colF?.column ? null : { by: rowF.grain ? "dimension" : "metric", dir: rowF.grain ? "asc" : "desc" },
      limit: 200,
    };
  }, [ds, rows, cols, values, byId]);

  const context: QueryContext = useMemo(() => ({
    from: range.from, to: range.to,
    filters: Object.entries(selected).filter(([, v]) => v.length).map(([column, value]) => ({ column, op: "in" as const, value })) as Condition[],
    exclusions: activeExcl,
  }), [range.from, range.to, selected, activeExcl]);

  const run = useCallback(async () => {
    if (!config) return;
    setBusy(true);
    try {
      const r = await api<QueryResult>("/api/query", { body: { config, context } });
      setRes(r);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [config, context]);

  useEffect(() => {
    const t = setTimeout(run, 250);
    return () => clearTimeout(t);
  }, [run]);

  const drop = (zone: Zone) => {
    const f = dragging;
    setOver(null);
    setDragging(null);
    if (!f) return;
    if (zone === "values") {
      if (f.kind !== "measure") return toast("Values take a number field, e.g. a sum or a player count", "bad");
      return setValues(f.id);
    }
    if (f.kind !== "dim") return toast("Rows, columns and filters take a dimension, not a measure", "bad");
    if (zone === "rows") setRows(f.id);
    else if (zone === "cols") setCols(f.id);
    else if (zone === "filters" && f.column && !filters.includes(f.id)) setFilters([...filters, f.id]);
  };

  const applyLayout = (l: Layout) => {
    if (l.dataset_id !== dsId) setDsId(l.dataset_id);
    const c = l.config || {};
    setRows(c.rows ?? null);
    setCols(c.cols ?? null);
    setValues(c.values ?? null);
    setFilters(c.filters ?? []);
    setSelected({});
    if (c.preset) setPreset(c.preset);
    if (c.custom) setCustom(c.custom);
  };

  // Placing a field without dragging (touch screens, and anyone who'd rather click).
  const place = (f: Field, zone: Zone) => {
    if (zone === "values") return setValues(f.id);
    if (zone === "rows") return setRows(f.id);
    if (zone === "cols") return setCols(f.id);
    if (zone === "filters" && f.column && !filters.includes(f.id)) setFilters([...filters, f.id]);
  };

  const fieldChip = (f: Field) => (
    <div key={f.id} draggable onDragStart={() => setDragging(f)} onDragEnd={() => { setDragging(null); setOver(null); }}
      className="group flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-[13px] cursor-grab active:cursor-grabbing hover:border-line-strong bg-surface">
      <GripVertical className="size-3.5 text-muted shrink-0" />
      <span className="truncate">{f.label}</span>
      <span className="ml-auto flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {(f.kind === "measure" ? ([["values", "V", "Use as the value"]] as const)
          : ([["rows", "R", "Put in Rows"], ["cols", "C", "Put in Columns"], ["filters", "F", "Add as a filter"]] as const)
        ).map(([zone, short, title]) => (
          <button key={zone} title={title} aria-label={`${title}: ${f.label}`} onClick={() => place(f, zone)}
            className="size-5 grid place-items-center rounded text-[10px] font-semibold text-muted hover:bg-accent-soft hover:text-accent">
            {short}
          </button>
        ))}
      </span>
    </div>
  );

  const slot = (zone: Zone, label: string, fieldId: string | null, onClear?: () => void) => (
    <div onDragOver={(e) => { e.preventDefault(); setOver(zone); }} onDragLeave={() => setOver(null)} onDrop={() => drop(zone)}
      className={`rounded-lg border p-2.5 min-h-[68px] transition-colors ${over === zone ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted font-medium mb-1.5">{label}</div>
      {fieldId ? (
        <div className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1.5 text-[13px]">
          <GripVertical className="size-3.5 text-muted" />
          <span className="truncate">{byId.get(fieldId)?.label || fieldId}</span>
          {onClear && <button onClick={onClear} className="ml-auto text-muted hover:text-bad" aria-label={`Clear ${label}`}><X className="size-3.5" /></button>}
        </div>
      ) : <div className="text-xs text-muted px-1 py-1.5">drop a field here</div>}
    </div>
  );

  if (datasets.loading && !datasets.data) return <Spinner />;
  if (!ready.length) return <ErrorBox>No dataset has data yet. Load one on the Data page first.</ErrorBox>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-base font-semibold tracking-tight">Explore</h1>
          <p className="hidden sm:block text-xs text-muted truncate">Drag a field into Rows, Columns, Filters or Values.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ready.length > 1 && (
            <Select value={dsId} onChange={(e) => { setDsId(e.target.value); setRows(null); setCols(null); setValues(null); setFilters([]); setSelected({}); }} className="max-w-56">
              {ready.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          )}
          <DateRangePicker preset={preset} custom={custom} onChange={(p, c) => { setPreset(p); if (c) setCustom(c); }} />
          <Button size="sm" icon={<Save className="size-3.5" />} onClick={() => setSaveOpen(true)}>Save layout</Button>
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAddOpen(true)} disabled={!config}>Add to dashboard</Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[240px_minmax(0,1fr)] gap-4 items-start">
        <aside className="space-y-4">
          <div className="card p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted font-medium mb-2">Fields</div>
            <div className="max-h-[300px] overflow-y-auto pr-1 space-y-1">
              {fields.filter((f) => f.kind === "dim").map(fieldChip)}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-muted font-medium mt-3 mb-2">Values</div>
            <div className="max-h-[240px] overflow-y-auto pr-1 space-y-1">
              {fields.filter((f) => f.kind === "measure").map(fieldChip)}
            </div>
          </div>

          {(layouts.data?.layouts || []).length > 0 && (
            <div className="card p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted font-medium mb-2">Saved layouts</div>
              <div className="space-y-1">
                {layouts.data!.layouts.map((l) => (
                  <div key={l.id} className="flex items-center gap-1 text-[13px]">
                    <button onClick={() => applyLayout(l)} className="flex-1 text-left rounded-md px-2 py-1.5 hover:bg-surface-2 truncate">{l.name}</button>
                    <button aria-label={`Delete ${l.name}`} className="p-1 text-muted hover:text-bad"
                      onClick={async () => { if (confirm(`Delete layout "${l.name}"?`)) { await api(`/api/layouts/${l.id}`, { method: "DELETE" }); layouts.reload(); } }}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section className="space-y-4 min-w-0">
          <div className="card p-3">
            <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
              <div onDragOver={(e) => { e.preventDefault(); setOver("filters"); }} onDragLeave={() => setOver(null)} onDrop={() => drop("filters")}
                className={`rounded-lg border p-2.5 min-h-[68px] ${over === "filters" ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}>
                <div className="text-[11px] uppercase tracking-wide text-muted font-medium mb-1.5">Filters</div>
                {filters.length === 0 ? <div className="text-xs text-muted px-1 py-1.5">drop a field here</div> : (
                  <div className="flex flex-wrap gap-1.5">
                    {filters.map((fid) => {
                      const f = byId.get(fid);
                      if (!f?.column || !ds) return null;
                      return (
                        <span key={fid} className="flex items-center gap-1">
                          <DimensionFilter f={{ datasetId: ds.id, column: f.column, label: f.label }}
                            selected={selected[f.column] || []} onChange={(v) => setSelected({ ...selected, [f.column!]: v })} />
                          <button className="text-muted hover:text-bad" aria-label={`Remove ${f.label}`}
                            onClick={() => { setFilters(filters.filter((x) => x !== fid)); setSelected({ ...selected, [f.column!]: [] }); }}>
                            <X className="size-3.5" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              {slot("cols", "Columns", cols, () => setCols(null))}
              {slot("rows", "Rows", rows)}
              {slot("values", "Values", values)}
            </div>
            {(ds?.settings?.exclusions || []).length > 0 && (
              <div className="flex flex-wrap items-center gap-3 mt-2.5 pt-2.5 border-t border-line">
                {(ds!.settings.exclusions || []).map((e) => (
                  <Toggle key={e.id} checked={activeExcl.includes(e.id)} label={e.label}
                    onChange={(on) => setExcl(on ? [...activeExcl, e.id] : activeExcl.filter((i) => i !== e.id))} />
                ))}
              </div>
            )}
          </div>

          <div className="card p-4" style={{ background: "var(--chart-surface)" }}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="min-w-0">
                <h2 className="font-medium text-[14px] truncate">
                  {byId.get(rows || "")?.label || "Rows"}{cols ? ` by ${byId.get(cols)?.label}` : ""} · {byId.get(values || "")?.label || "Value"}
                </h2>
                <div className="text-xs text-muted">{fmtDateRange(range.from, range.to)}</div>
              </div>
              {busy && <Spinner />}
            </div>
            {err ? <ErrorBox>{err}</ErrorBox> : res && config ? (
              <WidgetBody res={res} config={config} dimensionLabel={byId.get(rows || "")?.label} columnLabel={cols ? byId.get(cols)?.label : undefined} />
            ) : <div className="h-40 grid place-items-center text-sm text-muted"><Table2 className="size-5 mr-2" /> Drop a field into Rows and Values</div>}
          </div>
        </section>
      </div>

      {saveOpen && ds && (
        <SaveLayout datasetId={ds.id} config={{ rows: rows || undefined, cols: cols || undefined, values: values || undefined, filters, preset, custom }}
          onClose={() => setSaveOpen(false)} onSaved={() => { setSaveOpen(false); layouts.reload(); toast("Layout saved"); }} />
      )}
      {addOpen && config && (
        <AddToDashboard config={config} dashboards={dashboards.data?.dashboards || []}
          title={`${byId.get(rows || "")?.label || ""}${cols ? ` × ${byId.get(cols)?.label}` : ""} — ${byId.get(values || "")?.label || ""}`}
          onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); toast("Added to the dashboard"); }} />
      )}
    </div>
  );
}

function SaveLayout({ datasetId, config, onClose, onSaved }: { datasetId: string; config: SavedLayout; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState("team");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal open onClose={onClose} title="Save layout"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await api("/api/layouts", { body: { name, datasetId, config, visibility } });
            onSaved();
          } catch (e) {
            toast((e as Error).message, "bad");
            setBusy(false);
          }
        }}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Month × affiliate type" autoFocus /></Field>
        <Field label="Who can use it">
          <Segmented value={visibility} onChange={setVisibility} options={[{ id: "team", label: "Team" }, { id: "private", label: "Only me" }]} />
        </Field>
      </div>
    </Modal>
  );
}

function AddToDashboard({ config, dashboards, title, onClose, onDone }: { config: WidgetConfig; dashboards: Dash[]; title: string; onClose: () => void; onDone: () => void }) {
  const [id, setId] = useState(dashboards[0]?.id || "");
  const [name, setName] = useState(title);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal open onClose={onClose} title="Add to dashboard"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!id || !name.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await api(`/api/dashboards/${id}/widgets`, { body: { title: name, width: 4, config } });
            onDone();
          } catch (e) {
            toast((e as Error).message, "bad");
            setBusy(false);
          }
        }}>Add</Button></>}>
      <div className="space-y-3">
        <Field label="Dashboard">
          <Select value={id} onChange={(e) => setId(e.target.value)}>
            {dashboards.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Widget title"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
