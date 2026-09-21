import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { ArrowUpRight, CalendarCheck2, CheckCircle2, Clock3, LayoutDashboard, PhoneCall, Target, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";

const statusLabels: Record<string, string> = {
  new: "Novo",
  assigned: "Assumido",
  contacted: "Contatado",
  no_answer: "Sem resposta",
  interested: "Interessado",
  proposal: "Proposta",
  scheduled: "Agendado",
  converted: "Convertido",
  not_interested: "Sem interesse",
  invalid: "Inválido",
  callback: "Retorno",
};

export default function Home() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isManager = user?.role === "admin" || user?.role === "supervisor";
  const [campaignId, setCampaignId] = useState("all");
  const [pdvId, setPdvId] = useState("all");
  const [sellerId, setSellerId] = useState("all");
  const leadsQuery = trpc.leads.list.useQuery(undefined, { enabled: Boolean(user) });
  const dashboardFilters = trpc.leads.dashboardFilters.useQuery(undefined, { enabled: isManager });
  const dashboardInput = useMemo(() => ({ campaignId: campaignId === "all" ? undefined : Number(campaignId), pdvId: pdvId === "all" ? undefined : Number(pdvId), sellerId: sellerId === "all" ? undefined : Number(sellerId) }), [campaignId, pdvId, sellerId]);
  const dashboardQuery = trpc.leads.dashboard.useQuery(dashboardInput, { enabled: isManager });
  const stats = isManager ? dashboardQuery.data : undefined;
  const leads = leadsQuery.data ?? [];
  const sellerStats = {
    total: leads.length,
    inTreatment: leads.filter((lead) => ["assigned", "contacted", "interested", "proposal", "callback"].includes(lead.status)).length,
    scheduled: leads.filter((lead) => lead.status === "scheduled").length,
    converted: leads.filter((lead) => lead.status === "converted").length,
  };
  const cards = isManager
    ? [
        { label: "Leads na operação", value: stats?.total ?? 0, detail: "Base disponível no sistema", icon: UsersRound, tone: "mint" },
        { label: "Novos para tratamento", value: stats?.newLeads ?? 0, detail: "Aguardando assunção", icon: Target, tone: "amber" },
        { label: "Em tratamento", value: stats?.inTreatment ?? 0, detail: "Interesse, proposta ou retorno", icon: Clock3, tone: "blue" },
        { label: "Convertidos", value: stats?.converted ?? 0, detail: "Vendas atribuídas à base", icon: CheckCircle2, tone: "violet" },
      ]
    : [
        { label: "Minha carteira", value: sellerStats.total, detail: "Leads visíveis para você", icon: UsersRound, tone: "mint" },
        { label: "Em tratamento", value: sellerStats.inTreatment, detail: "Com próximo passo", icon: Clock3, tone: "blue" },
        { label: "Agendados", value: sellerStats.scheduled, detail: "Prontos para conversão", icon: CalendarCheck2, tone: "amber" },
        { label: "Convertidos", value: sellerStats.converted, detail: "Resultado da carteira", icon: CheckCircle2, tone: "violet" },
      ];

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1440px] space-y-8">
        <section className="relative overflow-hidden rounded-[28px] bg-[#102b35] px-7 py-8 text-white shadow-[0_20px_60px_-28px_rgba(16,43,53,.65)] sm:px-10">
          <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full bg-[#baf17d]/15 blur-3xl" />
          <div className="absolute bottom-[-90px] right-24 h-52 w-52 rounded-full bg-[#55c3d5]/20 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="max-w-2xl">
              <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.18em] text-[#baf17d]">
                <span className="h-2 w-2 rounded-full bg-[#baf17d] shadow-[0_0_14px_#baf17d]" /> Central de leads
              </div>
              <h1 className="max-w-xl text-3xl font-semibold tracking-[-.04em] sm:text-4xl">Transforme cada contato em um próximo passo claro.</h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-white/65">Assuma leads, registre a abordagem por WhatsApp ou telefone e mantenha sua carteira em movimento até a conversão.</p>
            </div>
            <div className="flex shrink-0 gap-3">
              <Link href="/leads"><Button className="h-11 rounded-xl bg-[#baf17d] px-5 font-semibold text-[#102b35] hover:bg-[#c9f89a]"><PhoneCall className="mr-2 h-4 w-4" /> Trabalhar leads</Button></Link>
              {isAdmin && <Link href="/import"><Button variant="outline" className="h-11 rounded-xl border-white/20 bg-white/5 px-5 text-white hover:bg-white/10 hover:text-white">Importar base <ArrowUpRight className="ml-2 h-4 w-4" /></Button></Link>}
            </div>
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;
            const colors: Record<string, string> = { mint: "bg-[#e9f8de] text-[#3e7a45]", amber: "bg-[#fff3d9] text-[#ad7215]", blue: "bg-[#e5f5f8] text-[#217488]", violet: "bg-[#eee9fb] text-[#7354a5]" };
            return <Card key={card.label} className="border-0 bg-white/80 shadow-[0_10px_35px_-25px_rgba(16,43,53,.4)]"><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-medium uppercase tracking-[.12em] text-muted-foreground">{card.label}</p><p className="mt-3 text-3xl font-semibold tracking-[-.04em] text-[#102b35]">{card.value}</p><p className="mt-1 text-xs text-muted-foreground">{card.detail}</p></div><div className={`rounded-2xl p-3 ${colors[card.tone]}`}><Icon className="h-5 w-5" /></div></div></CardContent></Card>;
          })}
        </div>

        {isManager && <Card className="border-0 bg-white/80 shadow-[0_10px_35px_-25px_rgba(16,43,53,.4)]"><CardContent className="grid gap-3 p-4 md:grid-cols-3"><div><p className="mb-1.5 text-xs font-semibold uppercase tracking-[.1em] text-muted-foreground">Campanha</p><Select value={campaignId} onValueChange={setCampaignId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas as campanhas</SelectItem>{dashboardFilters.data?.campaigns.map((campaign) => <SelectItem key={campaign.id} value={String(campaign.id)}>{campaign.name}</SelectItem>)}</SelectContent></Select></div><div><p className="mb-1.5 text-xs font-semibold uppercase tracking-[.1em] text-muted-foreground">PDV</p><Select value={pdvId} onValueChange={setPdvId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os PDVs</SelectItem>{dashboardFilters.data?.pdvs.map((pdv) => <SelectItem key={pdv.id} value={String(pdv.id)}>{pdv.name}</SelectItem>)}</SelectContent></Select></div><div><p className="mb-1.5 text-xs font-semibold uppercase tracking-[.1em] text-muted-foreground">Vendedor</p><Select value={sellerId} onValueChange={setSellerId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os vendedores</SelectItem>{dashboardFilters.data?.sellers.map((seller) => <SelectItem key={seller.id} value={String(seller.id)}>{seller.name}</SelectItem>)}</SelectContent></Select></div></CardContent></Card>}

        <div className="grid gap-6 xl:grid-cols-[1.35fr_.9fr]">
          <Card className="border-0 bg-white/80 shadow-[0_10px_35px_-25px_rgba(16,43,53,.4)]">
            <CardHeader className="flex flex-row items-center justify-between border-b border-[#e8eeed] px-6 py-5"><div><CardTitle className="text-lg tracking-[-.02em]">Distribuição por PDV</CardTitle><p className="mt-1 text-sm text-muted-foreground">Os indicadores acompanham os filtros selecionados acima.</p></div><Badge variant="outline" className="rounded-full border-[#d5e5dc] bg-[#f6fbf5] text-[#3e7a45]">Gestão comercial</Badge></CardHeader>
            <CardContent className="p-6">{isManager ? <div className="space-y-5">{(stats?.byStore ?? []).map((row) => { const rate = row.total ? Math.round((row.converted / row.total) * 100) : 0; return <div key={row.store}><div className="mb-2 flex items-center justify-between text-sm"><span className="font-semibold text-[#1d3d45]">{row.store}</span><span className="text-muted-foreground">{row.total} leads · {row.converted} convertidos</span></div><div className="h-2 overflow-hidden rounded-full bg-[#edf1ed]"><div className="h-full rounded-full bg-[#80c47d]" style={{ width: `${Math.max(rate, row.total ? 8 : 0)}%` }} /></div><div className="mt-1 text-xs text-muted-foreground">{rate}% de conversão registrada</div></div>; })}</div> : <div className="rounded-2xl bg-[#f5faf5] p-5 text-sm leading-6 text-[#557069]">Sua carteira será exibida aqui com o avanço por loja assim que os leads forem assumidos e tratados.</div>}</CardContent>
          </Card>
          <Card className="border-0 bg-[#f8f3e9] shadow-[0_10px_35px_-25px_rgba(16,43,53,.35)]"><CardHeader><CardTitle className="flex items-center gap-2 text-lg tracking-[-.02em] text-[#473d31]"><LayoutDashboard className="h-5 w-5 text-[#b87928]" /> Próxima rotina</CardTitle></CardHeader><CardContent className="space-y-4"><div className="rounded-2xl bg-white/70 p-4"><p className="text-xs font-semibold uppercase tracking-[.12em] text-[#b87928]">Terça a quinta</p><p className="mt-2 text-sm leading-6 text-[#6e5f4c]">Cada vendedor trabalha a fila de leads, realiza os disparos e registra o status do atendimento.</p></div><div className="rounded-2xl bg-white/70 p-4"><p className="text-xs font-semibold uppercase tracking-[.12em] text-[#b87928]">Sexta-feira</p><p className="mt-2 text-sm leading-6 text-[#6e5f4c]">Dia de fechamento, agendamentos, retornos e recuperação de oportunidades.</p></div><Link href="/leads"><Button variant="outline" className="w-full rounded-xl border-[#dfcfb4] bg-transparent text-[#6e5f4c] hover:bg-white">Abrir carteira <ArrowUpRight className="ml-2 h-4 w-4" /></Button></Link></CardContent></Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
