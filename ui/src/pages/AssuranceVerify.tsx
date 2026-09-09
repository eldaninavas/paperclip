import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "@/lib/router";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { assuranceApi } from "@/api/assurance";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function AssuranceVerify() {
  const params = useParams<{ publicId?: string }>();
  const [value, setValue] = useState(params.publicId ?? "");
  const [submitted, setSubmitted] = useState(params.publicId ?? "");
  const query = useQuery({ queryKey: ["public-assurance", submitted], queryFn: () => assuranceApi.verify(submitted, "qr"), enabled: Boolean(submitted), retry: false });
  const upload = useMutation({ mutationFn: assuranceApi.verifyManifest });
  const result = upload.data ?? query.data;
  const error = upload.error ?? query.error;
  const valid = result?.found && result.integrity === "valid";
  return (
    <main className="min-h-screen bg-background px-4 py-12 text-foreground"><div className="mx-auto max-w-2xl space-y-6"><div className="text-center"><div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="size-6" /></div><h1 className="mt-4 text-2xl font-semibold">Verificar Assurance</h1><p className="mt-2 text-sm text-muted-foreground">Comprueba la integridad criptográfica de un dossier público de Foundation.</p></div><form className="flex gap-2 rounded-lg border border-border bg-card p-4" onSubmit={(event) => { event.preventDefault(); upload.reset(); setSubmitted(value.trim()); }}><Input aria-label="Identificador público" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Identificador público" /><Button type="submit" disabled={!value.trim()}>Verificar</Button></form><label className="block cursor-pointer rounded-lg border border-dashed border-border bg-card p-4 text-center text-sm text-muted-foreground">O selecciona un manifest.json descargado<Input className="mt-3" type="file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setSubmitted(""); upload.mutate(JSON.parse(await file.text()) as Record<string, unknown>); }} /></label>{query.isFetching || upload.isPending ? <p className="text-center text-sm text-muted-foreground">Verificando…</p> : null}{result ? <section className="rounded-lg border border-border bg-card p-6"><div className="flex items-start gap-3">{valid ? <CheckCircle2 className="size-6 text-emerald-500" /> : <AlertTriangle className="size-6 text-destructive" />}<div><h2 className="font-semibold">{valid ? "Integridad válida" : result.found ? "Integridad alterada" : "Dossier no encontrado"}</h2>{result.title ? <p className="mt-1 text-sm text-muted-foreground">{result.title}</p> : null}</div></div>{result.manifestSha256 ? <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">SHA-256</dt><dd className="break-all font-mono text-xs">{result.manifestSha256}</dd></div><div><dt className="text-muted-foreground">Estado</dt><dd>{result.status}</dd></div><div><dt className="text-muted-foreground">Firma</dt><dd>{result.signatureStatus}</dd></div><div><dt className="text-muted-foreground">Sello de tiempo</dt><dd>{result.timestampStatus}</dd></div></dl> : null}<p className="mt-5 text-xs leading-5 text-muted-foreground">Esta comprobación acredita integridad técnica y procedencia dentro de Foundation. No constituye por sí sola certificación legal, notarial ni regulatoria.</p></section> : null}{error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error.message}</p> : null}</div></main>
  );
}
