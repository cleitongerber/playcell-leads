import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { v2trpc } from "@/lib/v2trpc";
import {
  forwardRef,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

export type LeadEvidenceUploaderHandle = {
  openFilePicker: () => void;
};

export function readEvidenceFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? result.split(",", 2)[1] : "";
      if (!base64) {
        reject(new Error("Não foi possível ler o arquivo"));
        return;
      }
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Shared private-storage upload surface. The target timeline event is always
 * explicit so an attachment cannot accidentally satisfy another operation.
 */
export const LeadEvidenceUploader = forwardRef<
  LeadEvidenceUploaderHandle,
  {
    leadId: number;
    timelineEventId: number;
    onUploaded: () => void;
    successMessage?: string;
    failureMessage?: string;
    showPickerButton?: boolean;
  }
>(function LeadEvidenceUploader(
  {
    leadId,
    timelineEventId,
    onUploaded,
    successMessage = "Evidência anexada ao evento operacional.",
    failureMessage,
    showPickerButton = true,
  },
  ref
) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isReading, setIsReading] = useState(false);
  const upload = v2trpc.evidences.upload.useMutation({
    onSuccess: () => {
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      onUploaded();
      toast.success(successMessage);
    },
  });
  const openFilePicker = () => {
    if (isReading || upload.isPending) return;
    inputRef.current?.click();
  };
  useImperativeHandle(ref, () => ({ openFilePicker }), [
    isReading,
    upload.isPending,
  ]);
  const send = async () => {
    if (!file || isReading || upload.isPending) return;
    setIsReading(true);
    try {
      await upload.mutateAsync({
        leadId,
        timelineEventId,
        fileName: file.name,
        mimeType: file.type,
        base64: await readEvidenceFileAsBase64(file),
      });
    } catch (error) {
      toast.error(
        failureMessage ??
          (error instanceof Error
            ? error.message
            : "Não foi possível ler o arquivo")
      );
    } finally {
      setIsReading(false);
    }
  };

  const input = (
    <input
      ref={inputRef}
      id={inputId}
      type="file"
      className="sr-only"
      aria-label="Selecionar evidência"
      accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
      onChange={event => setFile(event.target.files?.[0] ?? null)}
    />
  );

  if (!file && !showPickerButton) return input;

  return (
    <div className="mt-3 grid gap-2 rounded-md border border-dashed border-border bg-muted/25 p-3">
      {input}
      <Label htmlFor={inputId} className="text-sm font-medium">
        Evidência
      </Label>
      {file ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 truncate text-sm" aria-live="polite">
            Arquivo selecionado: <strong>{file.name}</strong>
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isReading || upload.isPending}
            onClick={openFilePicker}
          >
            Trocar arquivo
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isReading || upload.isPending}
            onClick={send}
          >
            {isReading || upload.isPending ? "Enviando…" : "Enviar evidência"}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isReading || upload.isPending}
          onClick={openFilePicker}
        >
          Selecionar arquivo
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Arquivos permitidos: PNG, JPG, WEBP ou PDF. O envio é privado e fica
        vinculado somente a este evento.
      </p>
    </div>
  );
});
