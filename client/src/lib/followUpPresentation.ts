const followUpStatusLabels: Record<string, string> = {
  pending: "Pendente",
  completed: "Concluído",
  cancelled: "Cancelado",
};

export function followUpStatusLabel(
  status: string,
  derivedStatus?: string | null
) {
  if (derivedStatus === "overdue") return "Vencido";
  return followUpStatusLabels[status] ?? status;
}
