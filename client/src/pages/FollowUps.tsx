import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { CalendarClock, ChevronRight, Phone } from "lucide-react";
import { useLocation } from "wouter";

const statusLabel: Record<string, string> = { new: "Novo", assigned: "Assumido", contacted: "Contatado", no_answer: "Sem resposta", interested: "Interessado", proposal: "Proposta", scheduled: "Agendado", converted: "Convertido", callback: "Retorno futuro" };

function dueLabel(value: Date) {
  const date = new Date(value);
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function FollowUps() {
  const [, setLocation] = useLocation();
  const query = trpc.leads.followUps.useQuery();
  const now = new Date();
  const overdue = (query.data ?? []).filter((item) => new Date(item.dueAt) < now);
  const upcoming = (query.data ?? []).filter((item) => new Date(item.dueAt) >= now);
  const renderItem = (item: NonNullable<typeof query.data>[number]) => <button key={item.id} onClick={() => setLocation(`/leads?leadId=${item.leadId}`)} className="flex w-full items-center gap-4 border-t border-[#edf2ee] px-5 py-4 text-left transition hover:bg-[#f7fbf7]"><div className="rounded-xl bg-[#edf8eb] p-2.5 text-[#4b8349]"><CalendarClock className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="truncate font-semibold text-[#1d3d45]">{item.leadName}</p><p className="mt-1 text-sm text-muted-foreground"><Phone className="mr-1 inline h-3.5 w-3.5" />{item.leadPhone} · {item.leadStore}</p>{item.note && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{item.note}</p>}</div><div className="hidden text-right sm:block"><p className="text-sm font-semibold text-[#1d3d45]">{dueLabel(item.dueAt)}</p><Badge variant="outline" className="mt-1.5 rounded-full">{statusLabel[item.leadStatus] ?? item.leadStatus}</Badge></div><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /></button>;
  return <DashboardLayout><div className="mx-auto max-w-5xl space-y-6"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><div className="mb-2 text-[11px] font-semibold uppercase tracking-[.18em] text-[#6da768]">Operação / agenda</div><h1 className="text-3xl font-semibold tracking-[-.04em] text-[#102b35]">Meus follow-ups</h1><p className="mt-2 text-sm text-muted-foreground">Acompanhe os retornos que você agendou e retome o atendimento com um toque.</p></div><Button variant="outline" onClick={() => query.refetch()} className="rounded-xl">Atualizar</Button></div>{query.isLoading ? <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">Carregando agenda...</CardContent></Card> : <><Card className="overflow-hidden border-[#f0d7c0]"><CardHeader className="bg-[#fff9f3]"><CardTitle className="text-lg text-[#9c5c4d]">Vencidos · {overdue.length}</CardTitle></CardHeader><CardContent className="p-0">{overdue.length ? overdue.map(renderItem) : <p className="p-6 text-sm text-muted-foreground">Nenhum follow-up vencido.</p>}</CardContent></Card><Card className="overflow-hidden border-0 bg-white/80 shadow-[0_10px_35px_-25px_rgba(16,43,53,.4)]"><CardHeader><CardTitle className="text-lg">Próximos agendamentos · {upcoming.length}</CardTitle></CardHeader><CardContent className="p-0">{upcoming.length ? upcoming.map(renderItem) : <p className="p-8 text-center text-sm text-muted-foreground">Você ainda não possui follow-ups agendados.</p>}</CardContent></Card></>}</div></DashboardLayout>;
}
