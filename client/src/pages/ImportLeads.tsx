import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import * as XLSX from "xlsx";
import { CheckCircle2, FileSpreadsheet, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type PreviewRow = { name: string; phone: string; email?: string; store: string; cpf: string; address: string; segment?: string; priority?: "high" | "medium" | "low"; source?: string; extraData: string; original: Record<string, string> };
const normalize = (value: unknown) => String(value ?? "").trim();
const normalizedKey = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const pick = (row: Record<string, string>, aliases: string[]) => { const key = Object.keys(row).find((candidate) => aliases.includes(normalizedKey(candidate))); return key ? normalize(row[key]) : ""; };
const onlyDigits = (value: string) => value.replace(/\D/g, "");
const buildAddress = (row: Record<string, string>) => {
  const street = pick(row, ["endereco", "logradouro", "rua", "address"]);
  const number = pick(row, ["numero", "num", "nro"]);
  const complement = pick(row, ["complemento", "comp"]);
  const neighborhood = pick(row, ["bairro", "district"]);
  const city = pick(row, ["cidade", "municipio", "city"]);
  const zip = pick(row, ["cep", "zipcode"]);
  const firstLine = [street, number && number !== "0" ? number : "", complement].filter(Boolean).join(", ");
  return [firstLine, neighborhood, city, zip].filter(Boolean).join(" · ");
};

export default function ImportLeads() {
  const { user } = useAuth();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [rejected, setRejected] = useState(0);
  const [defaultStore, setDefaultStore] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const pdvsQuery = trpc.pdvs.list.useQuery(undefined, { enabled: user?.role === "admin" });
  const campaignsQuery = trpc.campaigns.list.useQuery(undefined, { enabled: user?.role === "admin" });
  const availableCampaigns = (campaignsQuery.data ?? []).filter((item) => !item.isFrozen);
  const campaign = availableCampaigns.find((item) => item.id === Number(campaignId));
  const pdvs = (campaign?.pdvs ?? []).filter((pdv) => pdv.isActive);
  useEffect(() => {
    if (!campaignId && availableCampaigns[0]) setCampaignId(String(availableCampaigns[0].id));
    if (campaignId && !availableCampaigns.some((item) => item.id === Number(campaignId))) setCampaignId(availableCampaigns[0] ? String(availableCampaigns[0].id) : "");
  }, [campaignId, availableCampaigns]);
  useEffect(() => {
    if (pdvs.length && !pdvs.some((pdv) => pdv.name === defaultStore)) setDefaultStore(pdvs[0].name);
    if (!pdvs.length) setDefaultStore("");
  }, [campaignId, defaultStore, pdvs]);
  const importMutation = trpc.leads.import.useMutation({ onSuccess: (result) => { toast.success(`${result.inserted} novos, ${result.updated} atualizados, ${result.duplicates} duplicados e ${result.invalid} inválidos.`); setRows([]); setRejected(0); setFileName(""); }, onError: (error) => toast.error(error.message) });
  const handleFile = async (file?: File) => {
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const parsed = json.map((rawRow) => {
        const original = Object.fromEntries(Object.entries(rawRow).map(([key, value]) => [key, normalize(value)]));
        const name = pick(original, ["nome", "name", "cliente", "client", "nomecompleto"]);
        const phoneValue = pick(original, ["telefone", "phone", "celular", "whatsapp", "fone", "telefone1", "celular1"]);
        const ddd = onlyDigits(pick(original, ["ddd", "codigoddd", "areacode"]));
        const rawPhone = onlyDigits(phoneValue);
        const phone = ddd && rawPhone.length <= 9 && !rawPhone.startsWith("55") ? `${ddd}${rawPhone}` : rawPhone;
        const address = buildAddress(original);
        const cpf = pick(original, ["cpf", "cpfcnpj", "documento"]);
        const enriched = { ...original, ...(cpf ? { "CPF": cpf } : {}), ...(address ? { "Endereço completo": address } : {}) };
        return { name, phone, email: pick(original, ["email", "emailprincipal", "e-mail"]), store: pick(original, ["loja", "store", "pdv", "pontodevenda"]), cpf, address, segment: pick(original, ["segmento", "segment", "oferta"]), priority: (pick(original, ["prioridade", "priority"]) || "medium") as PreviewRow["priority"], source: pick(original, ["origem", "source"]) || file.name, extraData: JSON.stringify(enriched), original: enriched } satisfies PreviewRow;
      });
      const validRows = parsed.filter((row) => row.name && row.phone.length >= 10);
      setRows(validRows); setRejected(parsed.length - validRows.length); setFileName(file.name);
      if (!validRows.length) toast.error("Não encontrei nome e telefone válidos. Telefone pode estar em uma coluna única ou em DDD + TELEFONE.");
    } catch { toast.error("Não foi possível ler o arquivo. Use CSV, XLS ou XLSX."); }
  };
  const downloadTemplate = () => { const worksheet = XLSX.utils.json_to_sheet([{ nome: "Maria da Silva", ddd: "49", telefone: "999999999", cpf: "000.000.000-00", logradouro: "Rua Exemplo", numero: "100", cidade: "Videira", cep: "89560000" }]); const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, "Leads"); XLSX.writeFile(workbook, "modelo-importacao-leads.xlsx"); };
  if (user?.role !== "admin") return <DashboardLayout><div className="mx-auto max-w-2xl rounded-3xl bg-white p-10 text-center shadow-sm"><h1 className="text-2xl font-semibold text-[#102b35]">Acesso administrativo</h1><p className="mt-3 text-sm text-muted-foreground">A importação da base está disponível apenas para administradores.</p></div></DashboardLayout>;
  return <DashboardLayout><div className="mx-auto max-w-[1200px] space-y-6"><div><div className="mb-2 text-[11px] font-semibold uppercase tracking-[.18em] text-[#6da768]">Administração / base</div><h1 className="text-3xl font-semibold tracking-[-.04em] text-[#102b35]">Importar leads</h1><p className="mt-2 text-sm text-muted-foreground">Escolha a campanha primeiro. Somente os PDVs autorizados nela poderão receber esta base.</p></div><div className="grid gap-5 lg:grid-cols-[.75fr_1.25fr]"><Card className="border-0 bg-white/80 shadow-[0_10px_35px_-25px_rgba(16,43,53,.4)]"><CardHeader><CardTitle className="text-lg">1. Campanha e arquivo</CardTitle></CardHeader><CardContent className="space-y-5"><div><label className="mb-2 block text-sm font-semibold text-[#1d3d45]">Campanha</label><Select value={campaignId} onValueChange={setCampaignId}><SelectTrigger className="h-11 rounded-xl border-[#dce7e1]"><SelectValue placeholder="Selecione a campanha" /></SelectTrigger><SelectContent>{availableCampaigns.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select><p className="mt-2 text-xs text-muted-foreground">Campanhas congeladas não aparecem aqui. Crie ou descongele uma campanha no menu Administração.</p></div><label className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-[#b9d7bd] bg-[#f6fbf5] p-6 text-center transition hover:border-[#74b878] hover:bg-[#f0faed]"><UploadCloud className="mb-4 h-9 w-9 text-[#6da768]" /><span className="font-semibold text-[#3e7a45]">Clique para selecionar CSV ou Excel</span><span className="mt-2 text-xs text-muted-foreground">Nome e telefone são obrigatórios. Aceita telefone único ou DDD + telefone.</span><input type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} /></label>{fileName && <div className="space-y-2 rounded-2xl bg-[#edf8eb] p-3 text-sm text-[#4b754d]"><div className="flex items-center gap-3"><FileSpreadsheet className="h-5 w-5" /><span className="min-w-0 flex-1 truncate">{fileName}</span><Badge className="bg-[#dff2d8] text-[#4b8349] hover:bg-[#dff2d8]">{rows.length} válidos</Badge></div>{rejected > 0 && <p className="text-xs text-[#9c5c4d]">{rejected} linha(s) sem nome ou telefone válido não serão importadas.</p>}</div>}<div><label className="mb-2 block text-sm font-semibold text-[#1d3d45]">PDV padrão</label><Select value={defaultStore} onValueChange={setDefaultStore} disabled={!campaignId}><SelectTrigger className="h-11 rounded-xl border-[#dce7e1]"><SelectValue placeholder="Selecione o PDV" /></SelectTrigger><SelectContent>{pdvs.map((pdv) => <SelectItem key={pdv.id} value={pdv.name}>{pdv.name}</SelectItem>)}</SelectContent></Select><p className="mt-2 text-xs text-muted-foreground">Usado para toda linha que não possuir uma coluna de PDV.</p></div><Button variant="outline" onClick={downloadTemplate} className="w-full rounded-xl border-[#cfe1d3] text-[#3e7a45]">Baixar modelo de planilha</Button></CardContent></Card><Card className="border-0 bg-white/80 shadow-[0_10px_35px_-25px_rgba(16,43,53,.4)]"><CardHeader><CardTitle className="text-lg">2. Revisar e importar</CardTitle><p className="mt-1 text-sm text-muted-foreground">Nome, telefone, endereço e CPF aparecem primeiro. Os outros campos também ficam na ficha.</p></CardHeader><CardContent>{rows.length === 0 ? <div className="flex min-h-[330px] items-center justify-center rounded-3xl bg-[#fafcfb] text-center text-sm text-muted-foreground"><div><FileSpreadsheet className="mx-auto mb-3 h-8 w-8 text-[#b4c9bb]" /><p>A pré-visualização aparecerá aqui.</p></div></div> : <><div className="overflow-hidden rounded-2xl border border-[#e5eee7]"><div className="max-h-[360px] overflow-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="sticky top-0 bg-[#f5faf5] text-xs uppercase tracking-[.08em] text-[#557069]"><tr><th className="px-4 py-3">Nome</th><th className="px-4 py-3">Telefone</th><th className="px-4 py-3">CPF</th><th className="px-4 py-3">Endereço</th><th className="px-4 py-3">PDV</th></tr></thead><tbody>{rows.slice(0, 50).map((row, index) => <tr key={`${row.phone}-${index}`} className="border-t border-[#edf2ee]"><td className="px-4 py-3 font-medium text-[#1d3d45]">{row.name}</td><td className="px-4 py-3 text-muted-foreground">{row.phone}</td><td className="px-4 py-3 text-muted-foreground">{row.cpf || "—"}</td><td className="max-w-[260px] truncate px-4 py-3 text-muted-foreground">{row.address || "—"}</td><td className="px-4 py-3 text-muted-foreground">{row.store || defaultStore || "Selecione o PDV"}</td></tr>)}</tbody></table></div></div><Button onClick={() => importMutation.mutate({ fileName, campaignId: Number(campaignId), rows: rows.map(({ original, cpf, address, store, ...row }) => ({ ...row, store: store || defaultStore })) })} disabled={importMutation.isPending || !defaultStore || !campaignId} className="mt-5 h-12 w-full rounded-xl bg-[#102b35] text-white hover:bg-[#173b47]"><CheckCircle2 className="mr-2 h-5 w-5" /> Confirmar importação de {rows.length} leads</Button></>}</CardContent></Card></div></div></DashboardLayout>;
}
