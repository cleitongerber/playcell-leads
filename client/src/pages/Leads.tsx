import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Check, ChevronRight, MessageCircle, Phone, Search, ShieldCheck, UserRound, X } from "lucide-react";
import { useMemo, useState } from "react";

const statusLabels: Record<string, string> = { new: "Novo", assigned: "Assumido", contacted: "Contatado", no_answer: "Sem resposta", interested: "Interessado", proposal: "Proposta", scheduled: "Agendado", converted: "Convertido", not_interested: "Sem interesse", invalid: "Número inválido", callback: "Retorno futuro" };
const statusStyles: Record<string, string> = { new: "bg-[#eef3f0] text-[#557069]", assigned: "bg-[#e7f2f5] text-[#277287]", contacted: "bg-[#e7f2f5] text-[#277287]", no_answer: "bg-[#fff3d9] text-[#ad7215]", interested: "bg-[#eaf7df] text-[#4b8349]", proposal: "bg-[#eaf7df] text-[#4b8349]", scheduled: "bg-[#eee9fb] text-[#7354a5]", converted: "bg-[#dff6e7] text-[#27734a]", not_interested: "bg-[#f6ece8] text-[#9c5c4d]", invalid: "bg-[#f6ece8] text-[#9c5c4d]", callback: "bg-[#fff3d9] text-[#ad7215]" };

function cleanPhone(phone: string) { const digits = phone.replace(/\D/g, ""); return digits.startsWith("55") ? digits : `55${digits}`; }
const normalizeDataKey = (key: string) => key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const dataFieldPriority = (key: string) => {
  const normalized = normalizeDataKey(key);
  if (["nome", "name", "cliente"].includes(normalized)) return 0;
  if (["telefone", "phone", "celular", "whatsapp"].includes(normalized)) return 1;
  if (normalized.includes("endereco") || normalized === "logradouro" || normalized === "rua") return 2;
  if (normalized === "cpf" || normalized === "cpfcnpj" || normalized === "documento") return 3;
  return 10;
};

function ExtraDataPanel({ data }: { data?: string | null }) {
  if (!data) return null;
  let values: Record<string, unknown> = {};
  try { values = JSON.parse(data) as Record<string, unknown>; } catch { return null; }
  const entries = Object.entries(values).filter(([, value]) => value !== "" && value !== null && value !== undefined).sort(([firstKey], [secondKey]) => dataFieldPriority(firstKey) - dataFieldPriority(secondKey) || firstKey.localeCompare(secondKey));
  if (!entries.length) return null;
  return <div className="rounded-2xl border border-[#e5eee7] bg-[#f8fbf8] p-4"><div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold text-[#1d3d45]">Informações da planilha</p><span className="text-[11px] text-muted-foreground">{entries.length} campos</span></div><div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">{entries.map(([key, value]) => <div key={key} className="min-w-0"><p className="truncate text-[10px] font-semibold uppercase tracking-[.1em] text-[#6da768]">{key.replace(/[_-]+/g, " ")}</p><p className="mt-1 break-words text-sm text-[#557069]">{String(value)}</p></div>)}</div></div>;
}

export default function Leads() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [store, setStore] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [nextFollowUp, setNextFollowUp] = useState("");
  const pdvsQuery = trpc.pdvs.list.useQuery(undefined, { enabled: Boolean(user) });
  const stores = (pdvsQuery.data ?? []).map((pdv) => pdv.name);
  const filters = useMemo(() => ({ search: search || undefined, store: store === "all" ? undefined : store, status: status === "all" ? undefined : status as any }), [search, store, status]);
  const query = trpc.leads.list.useQuery(filters, { enabled: Boolean(user) });
  const leads = query.data ?? [];
  const selected = leads.find((lead) => lead.id === selectedId) ?? (leads[0] ?? null);
  const utils = trpc.useUtils();
  const assume = trpc.leads.assume.useMutation({ onSuccess: () => { toast.success("Lead assumido e carteirizado para você"); utils.leads.list.invalidate(); }, onError: (error) => toast.error(error.message) });
  const update = trpc.leads.updateTreatment.useMutation({ onSuccess: () => { toast.success("Atendimento atualizado"); setNote(""); utils.leads.list.invalidate(); }, onError: (error) => toast.error(error.message) });

  const selectLead = (id: number) => { setSelectedId(id); const lead = leads.find((item) => item.id === id); setNote(lead?.lastNote ?? ""); };
  const openChannel = (channel: "whatsapp" | "phone") => {
    if (!selected) return;
    if (!selected.assignedTo && user?.role !== "admin") { toast.error("Assuma o lead antes de iniciar o contato"); return; }
    const phone = cleanPhone(selected.phone);
    if (channel === "whatsapp") window.open(`https://wa.me/${phone}?text=${encodeURIComponent(`Olá, ${selected.name}! Aqui é da Playcell. Temos uma oportunidade especial para você. Posso te apresentar?`)}`, "_blank", "noopener,noreferrer");
    else window.open(`tel:+${phone}`, "_self");
    update.mutate({ leadId: selected.id, status: "contacted", channel });
  };
  const saveTreatment = () => { if (!selected) return; update.mutate({ leadId: selected.id, status: selected.status as any, note, nextFollowUpAt: nextFollowUp || undefined }); };
  const changeStatus = (value: string) => { if (!selected) return; update.mutate({ leadId: selected.id, status: value as any, note, nextFollowUpAt: nextFollowUp || undefined }); };

  return <DashboardLayout><div className="mx-auto max-w-[1440px] space-y-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-2 text-[11px] font-semibold uppercase tracking-[.18em] text-[#6da768]">Operação / carteira</div><h1 className="text-3xl font-semibold tracking-[-.04em] text-[#102b35]">Trabalhar leads</h1><p className="mt-2 text-sm text-muted-foreground">Assuma o próximo lead disponível, faça o contato e registre o desfecho.</p></div><div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-medium text-[#557069] shadow-sm"><ShieldCheck className="h-4 w-4 text-[#6da768]" /> {user?.role === "admin" ? "Visão administrativa" : "Minha carteira"}</div></div>
    <div className="grid gap-5 xl:grid-cols-[minmax(380px,.95fr)_minmax(520px,1.35fr)]"><Card className="overflow-hidden border-0 bg-white/80 shadow-[0_10px_35px_-25px_rgba(16,43,53,.4)]"><CardHeader className="border-b border-[#e8eeed] px-5 py-5"><div className="flex items-center justify-between"><div><CardTitle className="text-lg tracking-[-.02em]">Fila de leads</CardTitle><p className="mt-1 text-xs text-muted-foreground">{leads.length} leads encontrados</p></div><Badge className="rounded-full bg-[#eaf7df] text-[#4b8349] hover:bg-[#eaf7df]">{query.isLoading ? "..." : "Atualizada"}</Badge></div><div className="mt-4 flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou telefone" className="h-10 rounded-xl border-[#dce7e1] bg-[#fbfdfb] pl-9" /></div><Select value={status} onValueChange={setStatus}><SelectTrigger className="h-10 w-[132px] rounded-xl border-[#dce7e1] bg-[#fbfdfb]"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">Todos os status</SelectItem>{Object.entries(statusLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div><Select value={store} onValueChange={setStore}><SelectTrigger className="mt-2 h-10 rounded-xl border-[#dce7e1] bg-[#fbfdfb]"><SelectValue placeholder="Todas as lojas" /></SelectTrigger><SelectContent><SelectItem value="all">Todas as lojas</SelectItem>{stores.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></CardHeader><CardContent className="max-h-[650px] space-y-2 overflow-y-auto p-3">{leads.length === 0 && !query.isLoading ? <div className="rounded-2xl bg-[#f5faf5] p-6 text-center text-sm leading-6 text-muted-foreground">Nenhum lead encontrado. Admins podem importar uma base em “Importar base”.</div> : leads.map((lead) => <button key={lead.id} onClick={() => selectLead(lead.id)} className={`w-full rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm ${selected?.id === lead.id ? "border-[#9bd88f] bg-[#f4fbf0]" : "border-transparent bg-[#fafcfb] hover:border-[#dceadf]"}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate font-semibold text-[#1d3d45]">{lead.name}</p><span className={`h-2 w-2 shrink-0 rounded-full ${lead.priority === "high" ? "bg-[#e66e53]" : lead.priority === "medium" ? "bg-[#d7aa42]" : "bg-[#91b88b]"}`} /></div><p className="mt-1 text-xs text-muted-foreground">{lead.phone} · {lead.store}</p></div><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /></div><div className="mt-3 flex items-center justify-between"><span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${statusStyles[lead.status]}`}>{statusLabels[lead.status]}</span>{lead.segment && <span className="max-w-[145px] truncate text-[11px] text-muted-foreground">{lead.segment}</span>}</div></button>)}</CardContent></Card>

      <Card className="border-0 bg-white/80 shadow-[0_10px_35px_-25px_rgba(16,43,53,.4)]"><CardHeader className="border-b border-[#e8eeed] px-6 py-5"><div className="flex items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.15em] text-[#6da768]"><UserRound className="h-3.5 w-3.5" /> Ficha de atendimento</div><CardTitle className="text-2xl tracking-[-.03em] text-[#102b35]">{selected?.name ?? "Selecione um lead"}</CardTitle>{selected && <p className="mt-1 text-sm text-muted-foreground">{selected.phone} · {selected.store} · {selected.segment || "Segmento não informado"}</p>}</div>{selected && <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusStyles[selected.status]}`}>{statusLabels[selected.status]}</span>}</div></CardHeader>{selected ? <CardContent className="space-y-6 p-6"><div className="grid gap-3 sm:grid-cols-2"><Button onClick={() => openChannel("whatsapp")} className="h-12 rounded-xl bg-[#58b86b] font-semibold text-white hover:bg-[#4fa961]"><MessageCircle className="mr-2 h-5 w-5" /> Abrir WhatsApp</Button><Button onClick={() => openChannel("phone")} variant="outline" className="h-12 rounded-xl border-[#cfe1d3] bg-[#f6fbf5] font-semibold text-[#3e7a45] hover:bg-[#edf8eb]"><Phone className="mr-2 h-5 w-5" /> Ligar para o lead</Button></div>{!selected.assignedTo && user?.role !== "admin" ? <div className="flex items-start gap-3 rounded-2xl border border-[#f1dca8] bg-[#fff8e9] p-4 text-sm leading-6 text-[#80672d]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />Este lead ainda está disponível. Clique em assumir para colocá-lo na sua carteira.</div> : <div className="flex items-center gap-2 rounded-2xl border border-[#d7ead8] bg-[#f3faf1] p-4 text-sm text-[#4b754d]"><Check className="h-4 w-4" />Lead carteirizado. O vendedor responsável permanece com o tratamento até a finalização.</div>}
        <ExtraDataPanel data={selected.extraData} /><div><label className="mb-2 block text-sm font-semibold text-[#1d3d45]">Palitagem do atendimento</label><Select value={selected.status} onValueChange={changeStatus}><SelectTrigger className="h-12 rounded-xl border-[#dce7e1] bg-[#fbfdfb]"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(statusLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div><div><label className="mb-2 block text-sm font-semibold text-[#1d3d45]">Observação do atendimento</label><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Registre o que foi conversado e o próximo passo..." className="min-h-[125px] resize-none rounded-xl border-[#dce7e1] bg-[#fbfdfb]" /></div><div><label className="mb-2 block text-sm font-semibold text-[#1d3d45]">Próximo follow-up</label><Input type="datetime-local" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} className="h-11 rounded-xl border-[#dce7e1] bg-[#fbfdfb]" /></div><div className="flex flex-col gap-3 border-t border-[#e8eeed] pt-5 sm:flex-row sm:items-center sm:justify-between"><Button onClick={saveTreatment} disabled={update.isPending} className="h-11 rounded-xl bg-[#102b35] px-6 text-white hover:bg-[#173b47]">Salvar tratamento</Button>{selected.status === "new" && <Button onClick={() => assume.mutate({ id: selected.id })} disabled={assume.isPending} variant="outline" className="h-11 rounded-xl border-[#cfe1d3] text-[#3e7a45]">Assumir este lead</Button>}</div></CardContent> : <CardContent className="flex min-h-[450px] items-center justify-center p-6 text-center text-muted-foreground"><div><X className="mx-auto mb-3 h-8 w-8 text-[#b4c9bb]" /><p>Selecione um lead na fila para iniciar o atendimento.</p></div></CardContent>}</Card></div></div></DashboardLayout>;
}
