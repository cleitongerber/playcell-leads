import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";

export default function Pdvs() {
  const [form, setForm] = useState({ name: "", code: "", city: "", region: "", leadTarget: "", conversionTarget: "" });
  const query = trpc.pdvs.list.useQuery({ includeInactive: true });
  const utils = trpc.useUtils();
  const save = trpc.pdvs.save.useMutation({ onSuccess: () => { toast.success("PDV salvo"); setForm({ name: "", code: "", city: "", region: "", leadTarget: "", conversionTarget: "" }); utils.pdvs.list.invalidate(); }, onError: (error) => toast.error(error.message) });
  const toggle = trpc.pdvs.setActive.useMutation({ onSuccess: () => utils.pdvs.list.invalidate(), onError: (error) => toast.error(error.message) });
  const change = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <DashboardLayout><div className="mx-auto max-w-5xl space-y-6"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#6da768]">Administração</p><h1 className="mt-2 text-3xl font-semibold text-[#102b35]">PDVs</h1><p className="mt-2 text-sm text-muted-foreground">Cadastre e mantenha os pontos de venda sem depender de valores fixos no sistema.</p></div><div className="grid gap-6 lg:grid-cols-[.8fr_1.2fr]"><Card><CardHeader><CardTitle>Novo PDV</CardTitle></CardHeader><CardContent className="space-y-3"><Input value={form.name} onChange={(e) => change("name", e.target.value)} placeholder="Nome do PDV" /><Input value={form.code} onChange={(e) => change("code", e.target.value)} placeholder="Código" /><Input value={form.city} onChange={(e) => change("city", e.target.value)} placeholder="Cidade" /><Input value={form.region} onChange={(e) => change("region", e.target.value)} placeholder="Região" /><div className="grid grid-cols-2 gap-3"><Input type="number" value={form.leadTarget} onChange={(e) => change("leadTarget", e.target.value)} placeholder="Meta de leads" /><Input type="number" value={form.conversionTarget} onChange={(e) => change("conversionTarget", e.target.value)} placeholder="Meta conversão" /></div><Button className="w-full" disabled={!form.name || !form.code || save.isPending} onClick={() => save.mutate({ name: form.name, code: form.code, city: form.city || undefined, region: form.region || undefined, leadTarget: form.leadTarget ? Number(form.leadTarget) : undefined, conversionTarget: form.conversionTarget ? Number(form.conversionTarget) : undefined })}>Salvar PDV</Button></CardContent></Card><Card><CardHeader><CardTitle>PDVs cadastrados</CardTitle></CardHeader><CardContent className="space-y-3">{query.data?.map((pdv) => <div key={pdv.id} className="flex items-center justify-between rounded-xl border p-4"><div><p className="font-semibold">{pdv.name}</p><p className="text-xs text-muted-foreground">{pdv.code} · {pdv.city || "Cidade não informada"} · {pdv.isActive ? "Ativo" : "Inativo"}</p></div><Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: pdv.id, isActive: !pdv.isActive })}>{pdv.isActive ? "Inativar" : "Ativar"}</Button></div>)}</CardContent></Card></div></div></DashboardLayout>;
}
