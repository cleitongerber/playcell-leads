import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";

export type FollowUpCompletionChoice =
  | "attempt"
  | "treatment"
  | "without_contact";

const choices: Array<{
  value: FollowUpCompletionChoice;
  title: string;
  description: string;
}> = [
  {
    value: "attempt",
    title: "Registrei uma tentativa de contato",
    description: "Use quando houve esforço de contato, sem interação efetiva.",
  },
  {
    value: "treatment",
    title: "Houve interação com o cliente",
    description: "Use quando houve conversa, resposta ou negociação relevante.",
  },
  {
    value: "without_contact",
    title: "Concluir sem contato",
    description: "Use somente quando o retorno não exige uma nova interação.",
  },
];

export function FollowUpCompletionDialog({
  open,
  onOpenChange,
  leadName,
  pending,
  onChooseOperationalAction,
  onCompleteWithoutContact,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadName: string;
  pending: boolean;
  onChooseOperationalAction: (choice: "attempt" | "treatment") => void;
  onCompleteWithoutContact: (reason: string) => void;
}) {
  const [choice, setChoice] = useState<FollowUpCompletionChoice | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) {
      setChoice(null);
      setReason("");
    }
  }, [open]);

  const submit = () => {
    if (choice === "attempt" || choice === "treatment") {
      onChooseOperationalAction(choice);
      return;
    }
    if (choice === "without_contact" && reason.trim())
      onCompleteWithoutContact(reason.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Concluir follow-up</DialogTitle>
          <DialogDescription>
            O que aconteceu neste retorno de {leadName}? A conclusão precisa
            deixar um registro auditável no histórico do Lead.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {choices.map(item => (
            <label
              key={item.value}
              className="flex cursor-pointer gap-3 rounded-md border p-3 transition-colors has-[:checked]:border-brand-secondary has-[:checked]:bg-brand-accent/5"
            >
              <input
                type="radio"
                name="follow-up-completion-choice"
                value={item.value}
                checked={choice === item.value}
                onChange={() => setChoice(item.value)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">{item.title}</span>
                <span className="block text-sm text-muted-foreground">
                  {item.description}
                </span>
              </span>
            </label>
          ))}
        </div>
        {choice === "without_contact" && (
          <div className="space-y-1.5">
            <Label htmlFor="follow-up-completion-reason">
              Motivo da conclusão
            </Label>
            <Textarea
              id="follow-up-completion-reason"
              value={reason}
              required
              onChange={event => setReason(event.target.value)}
              placeholder="Explique por que este follow-up está sendo concluído sem uma nova tentativa ou tratativa."
            />
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Voltar
          </Button>
          <Button
            type="button"
            disabled={
              !choice ||
              pending ||
              (choice === "without_contact" && !reason.trim())
            }
            onClick={submit}
          >
            {pending
              ? "Concluindo…"
              : choice === "attempt"
                ? "Registrar tentativa"
                : choice === "treatment"
                  ? "Registrar tratativa"
                  : "Concluir follow-up"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
